-- 0047_emi_advanced.sql
-- Advanced installment (EMI) sales — brand shop only, DB-enforced role access.
-- Idempotent / safe to re-run: functions are dropped by name, tables, columns,
-- indexes, triggers and policies all use IF NOT EXISTS / IF EXISTS.
--
-- EMI roles        : owner, manager, purchase_officer, salesman, accountant
-- EMI plan writers : owner, manager, purchase_officer, accountant

-- ============================================================
-- 1) Reconcile previously created function signatures
-- ============================================================
DROP FUNCTION IF EXISTS public.is_brand_shop;
DROP FUNCTION IF EXISTS public.emi_due_date;
DROP FUNCTION IF EXISTS public.create_emi_contract;
DROP FUNCTION IF EXISTS public.create_emi_sale_full;
DROP FUNCTION IF EXISTS public._emi_allocate;
DROP FUNCTION IF EXISTS public.receive_emi_payment;
DROP FUNCTION IF EXISTS public.refresh_emi_overdue;
DROP FUNCTION IF EXISTS public.settle_emi_early;
DROP FUNCTION IF EXISTS public.emi_summary;

-- ============================================================
-- 2) Schema: contract meta columns + sale finance charge
-- ============================================================
ALTER TABLE public.sales_emi ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id);
ALTER TABLE public.sales_emi ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id);
ALTER TABLE public.sales_emi ADD COLUMN IF NOT EXISTS emi_no text;
ALTER TABLE public.sales_emi ADD COLUMN IF NOT EXISTS settled_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (settled_amount >= 0);
ALTER TABLE public.sales_emi ADD COLUMN IF NOT EXISTS waived_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (waived_amount >= 0);
ALTER TABLE public.sales_emi ADD COLUMN IF NOT EXISTS closed_by uuid;
ALTER TABLE public.sales_emi ADD COLUMN IF NOT EXISTS notes text;

-- backfill from the related sale
UPDATE public.sales_emi e
   SET branch_id = s.branch_id, customer_id = s.customer_id
  FROM public.sales s
 WHERE s.id = e.sale_id AND (e.branch_id IS NULL OR e.customer_id IS NULL);

-- contract numbers for pre-existing contracts
UPDATE public.sales_emi e
   SET emi_no = x.n
  FROM (
    SELECT id,
           'EMI-' || lpad(row_number() OVER (PARTITION BY business_id ORDER BY created_at, id)::text, 6, '0') AS n
      FROM public.sales_emi
     WHERE emi_no IS NULL
  ) x
 WHERE e.id = x.id;

CREATE INDEX IF NOT EXISTS idx_sales_emi_no ON public.sales_emi(business_id, emi_no);
CREATE INDEX IF NOT EXISTS idx_sales_emi_branch ON public.sales_emi(branch_id);

-- allow the 'cancelled' status
ALTER TABLE public.sales_emi DROP CONSTRAINT IF EXISTS sales_emi_status_check;
ALTER TABLE public.sales_emi ADD CONSTRAINT sales_emi_status_check
  CHECK (status IN ('active','closed','early_settled','defaulted','cancelled'));

-- finance charges live on the sale so customer_due() / A/R stay one source of truth
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS finance_charge numeric(14,2) NOT NULL DEFAULT 0 CHECK (finance_charge >= 0);

-- ============================================================
-- 3) emi_payments: collection history (cash, settlement, waiver)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.emi_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  emi_id uuid NOT NULL REFERENCES public.sales_emi(id) ON DELETE CASCADE,
  installment_id uuid REFERENCES public.emi_installments(id) ON DELETE SET NULL,
  branch_id uuid REFERENCES public.branches(id),
  customer_id uuid REFERENCES public.customers(id),
  sale_id uuid REFERENCES public.sales(id),
  account_id uuid REFERENCES public.money_accounts(id),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  kind text NOT NULL DEFAULT 'installment' CHECK (kind IN ('installment','settlement','waiver')),
  method public.payment_method NOT NULL DEFAULT 'cash',
  paid_on date NOT NULL DEFAULT current_date,
  txn_ref text,
  note text,
  customer_payment_id uuid REFERENCES public.customer_payments(id),
  money_txn_id uuid REFERENCES public.money_transactions(id),
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emi_payments_biz ON public.emi_payments(business_id, paid_on);
CREATE INDEX IF NOT EXISTS idx_emi_payments_emi ON public.emi_payments(emi_id, paid_on);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_emi_payments') THEN
    CREATE TRIGGER audit_emi_payments AFTER INSERT OR UPDATE OR DELETE ON public.emi_payments
      FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  END IF;
END $$;

-- ============================================================
-- 4) Helpers + finance account seeding
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_brand_shop(_branch uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT b.kind = 'branch' FROM public.branches b WHERE b.id = _branch), false);
$$;
REVOKE ALL ON FUNCTION public.is_brand_shop(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_brand_shop(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.emi_due_date(_start date, _due_day integer, _n integer)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT (
    date_trunc('month', _start) + make_interval(months => _n)
    + make_interval(days =>
        LEAST(_due_day,
              EXTRACT(DAY FROM (date_trunc('month', _start) + make_interval(months => _n) + interval '1 month - 1 day'))::int)
        - 1)
  )::date;
$$;
REVOKE ALL ON FUNCTION public.emi_due_date(date, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emi_due_date(date, integer, integer) TO authenticated;

-- accounts used by the EMI postings (already seeded by seed_finance, this makes it safe)
INSERT INTO public.accounts(business_id, code, name, type)
SELECT id, '4090', 'Sales Discount', 'revenue' FROM public.businesses
ON CONFLICT (business_id, code) DO NOTHING;

INSERT INTO public.accounts(business_id, code, name, type)
SELECT id, '4900', 'Other Income', 'revenue' FROM public.businesses
ON CONFLICT (business_id, code) DO NOTHING;

-- ============================================================
-- 5) create_sale — purchase_officer allowed, EMI flag skips the
--    credit limit and forces a brand shop branch
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_sale(_biz uuid, _data jsonb)
RETURNS uuid language plpgsql security definer set search_path = public as $$
declare
  v_sid uuid; v_branch uuid := (_data->>'branch_id')::uuid; v_cust uuid := nullif(_data->>'customer_id','')::uuid;
  v_date date := coalesce((_data->>'sale_date')::date, current_date);
  v_disc numeric(14,2) := coalesce((_data->>'discount')::numeric,0);
  v_tax numeric(14,2) := coalesce((_data->>'tax')::numeric,0);
  v_override boolean := coalesce((_data->>'override_credit')::boolean,false);
  v_emi boolean := lower(coalesce(_data->>'emi','')) in ('true','1','yes','on');
  v_is_mgr boolean := has_biz_role(_biz, array['owner','manager']::member_role[]);
  v_sub numeric(14,2) := 0; v_total numeric(14,2); v_paid numeric(14,2) := 0; v_due numeric(14,2);
  v_cogs numeric(14,2) := 0; v_mob numeric(14,2) := 0; v_acc numeric(14,2) := 0;
  v_cname text; v_limit numeric; v_ctype customer_type; v_level price_level := 'retail'; v_curdue numeric;
  it jsonb; pm jsonb; v_var uuid; v_qty int; v_price numeric(14,2); v_serial boolean; v_min numeric; v_warr int;
  v_ids jsonb; v_imei uuid; v_cost numeric(14,2); v_item uuid; v_stock int; v_avg numeric(14,2);
  v_seq int; v_no text; v_j uuid; v_t uuid; v_led uuid; v_amt numeric(14,2); v_lines jsonb := '[]'::jsonb; v_over boolean := false;
begin
  if not has_biz_role(_biz, array['owner','manager','salesman','branch_manager','accountant','purchase_officer']::member_role[]) then
    raise exception 'You do not have permission to create sales.'; end if;
  if not exists(select 1 from branches where id=v_branch and business_id=_biz and status='active') then raise exception 'Invalid branch.'; end if;
  if v_emi and not is_brand_shop(v_branch) then
    raise exception 'Installment (EMI) sales can only be created from a brand shop branch.'; end if;
  if v_cust is not null then
    select name, credit_limit, type, price_level into v_cname, v_limit, v_ctype, v_level from customers where id=v_cust and business_id=_biz;
    if v_cname is null then raise exception 'Invalid customer.'; end if;
    if exists(select 1 from customers where id=v_cust and status='inactive') then raise exception 'Customer is inactive.'; end if;
  else v_cname := 'Walk-in customer'; end if;
  if jsonb_array_length(coalesce(_data->'items','[]'::jsonb)) = 0 then raise exception 'Add at least one product.'; end if;
  if v_disc < 0 or v_tax < 0 then raise exception 'Amounts cannot be negative.'; end if;

  for pm in select * from jsonb_array_elements(coalesce(_data->'payments','[]'::jsonb)) loop
    v_amt := coalesce((pm->>'amount')::numeric,0);
    if v_amt < 0 then raise exception 'Invalid payment amount.'; end if;
    v_paid := v_paid + v_amt;
  end loop;

  perform pg_advisory_xact_lock(hashtext('sale_no_' || _biz::text));
  select coalesce(max(nullif(regexp_replace(invoice_no,'\D','','g'),'')::int),0)+1 into v_seq from sales where business_id=_biz;
  v_no := 'INV-' || lpad(v_seq::text, 6, '0');
  insert into sales(business_id, branch_id, customer_id, invoice_no, sale_date, price_level, notes)
    values (_biz, v_branch, v_cust, v_no, v_date, coalesce(v_level,'retail'), nullif(_data->>'notes','')) returning id into v_sid;

  for it in select * from jsonb_array_elements(_data->'items') loop
    v_var := (it->>'variant_id')::uuid; v_qty := (it->>'qty')::int; v_price := (it->>'price')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be at least 1.'; end if;
    if v_price is null or v_price < 0 then raise exception 'Invalid price.'; end if;
    select c.is_serialized, pv.min_price, pv.warranty_months into v_serial, v_min, v_warr
      from product_variants pv join products p on p.id=pv.product_id join categories c on c.id=p.category_id
      where pv.id=v_var and pv.business_id=_biz;
    if not found then raise exception 'Invalid product.'; end if;
    if v_price < v_min and not v_is_mgr then raise exception 'Price ৳% is below the minimum selling price ৳%. Manager approval required.', v_price, v_min; end if;

    select qty, avg_cost into v_stock, v_avg from stock where branch_id=v_branch and variant_id=v_var for update;
    if coalesce(v_stock,0) < v_qty then raise exception 'Insufficient stock (available %).', coalesce(v_stock,0); end if;

    v_ids := coalesce(it->'imei_ids','[]'::jsonb);
    if v_serial then
      if jsonb_array_length(v_ids) <> v_qty then raise exception 'Select % IMEI(s) for this product.', v_qty; end if;
      for v_imei in select (x #>> '{}')::uuid from jsonb_array_elements(v_ids) x loop
        select cost into v_cost from product_imeis where id=v_imei and business_id=_biz and variant_id=v_var
          and branch_id=v_branch and status='IN_STOCK' for update;
        if not found then raise exception 'An IMEI is not available in stock at this branch.'; end if;
        insert into sale_items(business_id, sale_id, variant_id, imei_id, qty, price, line_total, unit_cost, warranty_months)
          values (_biz, v_sid, v_var, v_imei, 1, v_price, v_price, v_cost, v_warr) returning id into v_item;
        update product_imeis set status='SOLD', sale_item_id=v_item where id=v_imei;
        insert into stock_movements(business_id,branch_id,variant_id,imei_id,qty_change,unit_cost,ref_type,ref_id)
          values (_biz,v_branch,v_var,v_imei,-1,v_cost,'sale',v_sid);
        v_cogs := v_cogs + v_cost; v_mob := v_mob + v_price;
      end loop;
    else
      if jsonb_array_length(v_ids) > 0 then raise exception 'This product is not IMEI-tracked.'; end if;
      insert into sale_items(business_id, sale_id, variant_id, qty, price, line_total, unit_cost, warranty_months)
        values (_biz, v_sid, v_var, v_qty, v_price, round(v_qty*v_price,2), v_avg, v_warr);
      insert into stock_movements(business_id,branch_id,variant_id,qty_change,unit_cost,ref_type,ref_id)
        values (_biz,v_branch,v_var,-v_qty,v_avg,'sale',v_sid);
      v_cogs := v_cogs + round(v_qty*v_avg,2); v_acc := v_acc + round(v_qty*v_price,2);
    end if;
    update stock set qty = qty - v_qty, updated_at = now() where branch_id=v_branch and variant_id=v_var;
    v_sub := v_sub + round(v_qty*v_price,2);
  end loop;

  v_total := v_sub - v_disc + v_tax;
  if v_total < 0 then raise exception 'Discount is larger than the sale amount.'; end if;
  if v_paid > v_total then raise exception 'Payment (৳%) exceeds invoice total (৳%).', v_paid, v_total; end if;
  v_due := v_total - v_paid;
  if v_due > 0 and v_cust is null then raise exception 'Walk-in sales must be fully paid. Select a customer to sell on credit.'; end if;
  if v_disc > 0 and v_sub > 0 and v_disc / v_sub > 0.10 and not v_is_mgr then raise exception 'Discount above 10%% needs manager approval.'; end if;

  if v_due > 0 and not v_emi then
    v_curdue := customer_due(v_cust);
    if v_curdue + v_due > coalesce(v_limit,0) then
      if not v_override then raise exception 'CREDIT_LIMIT: Credit limit exceeded. Limit ৳%, current due ৳%, this sale adds ৳%. Manager approval required.', v_limit, v_curdue, v_due; end if;
      if not v_is_mgr then raise exception 'Only an owner or manager can override the credit limit.'; end if;
      v_over := true;
    end if;
  end if;

  update sales set subtotal=v_sub, discount=v_disc, tax=v_tax, total=v_total, paid=v_paid, due=v_due, cogs=v_cogs,
    credit_override_by = case when v_over then auth.uid() end where id=v_sid;
  if v_over then
    insert into audit_logs(business_id,user_id,module,action,record_id,new_value)
    values (_biz, auth.uid(), 'sales', 'credit_override', v_sid, jsonb_build_object('invoice',v_no,'limit',v_limit,'due_before',v_curdue,'added',v_due));
  end if;

  -- revenue journal
  v_lines := jsonb_build_array(jl(acct(_biz,'1100'), v_total, 0));
  if v_mob > 0 then v_lines := v_lines || jsonb_build_array(jl(acct(_biz,'4010'),0,v_mob)); end if;
  if v_acc > 0 then v_lines := v_lines || jsonb_build_array(jl(acct(_biz,'4020'),0,v_acc)); end if;
  if v_disc > 0 then v_lines := v_lines || jsonb_build_array(jl(acct(_biz,'4090'),v_disc,0)); end if;
  if v_tax > 0 then v_lines := v_lines || jsonb_build_array(jl(acct(_biz,'2100'),0,v_tax)); end if;
  if v_total > 0 then perform post_journal(_biz, v_date, 'sale', v_sid, 'Sale ' || v_no || ' to ' || v_cname, v_lines); end if;
  if v_cogs > 0 then
    perform post_journal(_biz, v_date, 'cogs', v_sid, 'Cost of goods for ' || v_no,
      jsonb_build_array(jl(acct(_biz,'5010'),v_cogs,0), jl(acct(_biz,'1200'),0,v_cogs)));
  end if;

  for pm in select * from jsonb_array_elements(coalesce(_data->'payments','[]'::jsonb)) loop
    v_amt := coalesce((pm->>'amount')::numeric,0);
    continue when v_amt <= 0;
    select ledger_account_id into v_led from money_accounts where id=(pm->>'account_id')::uuid and business_id=_biz and status='active';
    if v_led is null then raise exception 'Select the account that received the payment.'; end if;
    v_j := post_journal(_biz, v_date, 'customer_payment', v_sid, 'Receipt for ' || v_no,
      jsonb_build_array(jl(v_led,v_amt,0), jl(acct(_biz,'1100'),0,v_amt)));
    insert into money_transactions(business_id,account_id,txn_date,direction,amount,kind,method,txn_ref,note,ref_type,ref_id,journal_entry_id)
      values (_biz,(pm->>'account_id')::uuid,v_date,'in',v_amt,'sale_receipt',coalesce(nullif(pm->>'method','')::payment_method,'cash'),
              nullif(pm->>'txn_ref',''),'Receipt for ' || v_no,'sale',v_sid,v_j) returning id into v_t;
    insert into customer_payments(business_id,customer_id,sale_id,account_id,amount,method,txn_ref,paid_on,money_txn_id,journal_entry_id)
      values (_biz,v_cust,v_sid,(pm->>'account_id')::uuid,v_amt,coalesce(nullif(pm->>'method','')::payment_method,'cash'),nullif(pm->>'txn_ref',''),v_date,v_t,v_j);
  end loop;
  return v_sid;
end $$;
REVOKE ALL ON FUNCTION public.create_sale(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale(uuid, jsonb) TO authenticated;

-- ============================================================
-- 6) create_emi_contract — contract + installment schedule for a sale
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_emi_contract(_biz uuid, _sale uuid, _emi jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
  v_plan public.emi_plans%ROWTYPE;
  v_eid uuid; v_no text; v_seq int;
  v_dp numeric(14,2); v_total numeric(14,2); v_sched numeric(14,2);
  v_fc numeric(14,2); v_int numeric(14,2); v_fee numeric(14,2); v_prin numeric(14,2);
  v_ten integer; v_monthly numeric(14,2); v_last numeric(14,2);
  v_start date; v_day integer; i integer;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager','purchase_officer','salesman','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission to create installment contracts.';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = _sale AND business_id = _biz;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid sale.'; END IF;
  IF v_sale.status <> 'posted' THEN RAISE EXCEPTION 'Only posted sales can be put on installments.'; END IF;
  IF NOT public.is_brand_shop(v_sale.branch_id) THEN
    RAISE EXCEPTION 'Installment (EMI) sales are only allowed from a brand shop branch.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sales_emi WHERE business_id = _biz AND sale_id = _sale) THEN
    RAISE EXCEPTION 'This sale already has an installment contract.';
  END IF;

  IF nullif(_emi->>'plan_id','') IS NOT NULL THEN
    SELECT * INTO v_plan FROM public.emi_plans WHERE id = (_emi->>'plan_id')::uuid AND business_id = _biz;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid installment plan.'; END IF;
    IF v_plan.status <> 'active' THEN RAISE EXCEPTION 'This installment plan is not active.'; END IF;
  END IF;

  v_ten := COALESCE(NULLIF(_emi->>'tenure','')::integer, v_plan.tenure_months);
  IF COALESCE(v_ten, 0) <= 0 THEN RAISE EXCEPTION 'Invalid tenure.'; END IF;

  v_dp := ROUND(COALESCE(NULLIF(_emi->>'downpayment','')::numeric, v_sale.paid, 0), 2);
  IF v_dp < 0 OR v_dp >= ROUND(v_sale.total, 2) THEN
    RAISE EXCEPTION 'Downpayment must be less than the invoice total.';
  END IF;

  -- finance charge = flat interest + processing fee (already agreed with the customer)
  v_int := ROUND(
    COALESCE(
      NULLIF(_emi->>'interest','')::numeric,
      CASE WHEN COALESCE(v_plan.interest_rate, 0) > 0
           THEN ROUND((v_sale.total - v_dp) * v_plan.interest_rate / 100 * (v_ten / 12.0), 2)
      END,
      0), 2);
  v_fee := ROUND(COALESCE(NULLIF(_emi->>'processing_fee','')::numeric, v_plan.processing_fee, 0), 2);
  IF v_int < 0 OR v_fee < 0 THEN RAISE EXCEPTION 'Invalid finance charge.'; END IF;
  v_fc := ROUND(v_int + v_fee, 2);

  IF v_fc > 0 AND ROUND(COALESCE(v_sale.finance_charge, 0), 2) = 0 THEN
    -- fold the finance charge into the sale so A/R, customer due and reports agree
    UPDATE public.sales SET finance_charge = v_fc, total = total + v_fc, due = due + v_fc WHERE id = v_sale.id;
    PERFORM public.post_journal(_biz, COALESCE(v_sale.sale_date, current_date), 'emi_finance', v_sale.id,
      'Finance charge for ' || COALESCE(v_sale.invoice_no, ''),
      jsonb_build_array(public.jl(public.acct(_biz, '1100'), v_fc, 0), public.jl(public.acct(_biz, '4900'), 0, v_fc)));
    v_sale.total := ROUND(v_sale.total + v_fc, 2);
  ELSIF ROUND(COALESCE(v_sale.finance_charge, 0), 2) <> v_fc THEN
    RAISE EXCEPTION 'Finance charge (৳%) does not match the sale finance charge (৳%).', v_fc, COALESCE(v_sale.finance_charge, 0);
  END IF;

  v_total := ROUND(v_sale.total, 2);
  v_sched := ROUND(v_total - v_dp, 2);          -- installments always sum to this
  IF v_sched <= 0 THEN RAISE EXCEPTION 'Downpayment must be less than the invoice total.'; END IF;
  v_prin := ROUND(v_sched - v_fc, 2);           -- principal = goods - downpayment
  IF v_prin <= 0 THEN RAISE EXCEPTION 'Downpayment leaves nothing to finance.'; END IF;

  v_monthly := ROUND(COALESCE(NULLIF(_emi->>'monthly_amount','')::numeric, ROUND(v_sched / v_ten, 2)), 2);
  v_last := ROUND(v_sched - v_monthly * (v_ten - 1), 2);
  IF v_monthly <= 0 OR v_last <= 0 THEN
    v_monthly := ROUND(v_sched / v_ten, 2);
    v_last := ROUND(v_sched - v_monthly * (v_ten - 1), 2);
    IF v_monthly <= 0 OR v_last <= 0 THEN
      RAISE EXCEPTION 'Could not build the installment schedule.';
    END IF;
  END IF;

  v_start := COALESCE(NULLIF(_emi->>'start_date','')::date, v_sale.sale_date, current_date);
  v_day := COALESCE(NULLIF(_emi->>'due_day','')::integer, EXTRACT(DAY FROM v_start)::integer, 5);
  IF v_day < 1 OR v_day > 31 THEN RAISE EXCEPTION 'Due day must be between 1 and 31.'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('emi_no_' || _biz::text));
  SELECT COALESCE(MAX(NULLIF(regexp_replace(emi_no, '\D', '', 'g'), '')::int), 0) + 1 INTO v_seq
    FROM public.sales_emi WHERE business_id = _biz;
  v_no := 'EMI-' || lpad(v_seq::text, 6, '0');

  INSERT INTO public.sales_emi(
      business_id, sale_id, plan_id, branch_id, customer_id, emi_no,
      total_amount, downpayment, financed_amount, interest_amount, processing_fee,
      tenure_months, monthly_amount, start_date, due_day, status, notes)
    VALUES (_biz, _sale, v_plan.id, v_sale.branch_id, v_sale.customer_id, v_no,
            v_total, v_dp, v_prin, v_int, v_fee, v_ten, v_monthly, v_start, v_day, 'active',
            nullif(_emi->>'notes',''))
    RETURNING id INTO v_eid;

  FOR i IN 1..v_ten LOOP
    INSERT INTO public.emi_installments(business_id, emi_id, installment_no, due_date, amount, balance, status)
      VALUES (_biz, v_eid, i, public.emi_due_date(v_start, v_day, i),
              CASE WHEN i = v_ten THEN v_last ELSE v_monthly END,
              CASE WHEN i = v_ten THEN v_last ELSE v_monthly END,
              'due');
  END LOOP;

  RETURN v_eid;
END $$;
REVOKE ALL ON FUNCTION public.create_emi_contract(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_emi_contract(uuid, uuid, jsonb) TO authenticated;

-- ============================================================
-- 7) _emi_allocate — FIFO allocation of money over installments
-- ============================================================
CREATE OR REPLACE FUNCTION public._emi_allocate(
  _biz uuid, _emi uuid, _amount numeric, _account uuid, _date date, _method public.payment_method,
  _txn_ref text, _note text, _payment uuid, _journal uuid, _money uuid,
  _kind text DEFAULT 'installment', _from uuid DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rem numeric := ROUND(COALESCE(_amount, 0), 2);
  v_paid numeric := 0;
  r record; v_pay numeric; v_first uuid := NULL; v_out numeric;
BEGIN
  IF v_rem <= 0 THEN RETURN 0; END IF;

  FOR r IN
    SELECT id, balance FROM public.emi_installments
     WHERE emi_id = _emi AND business_id = _biz AND balance > 0.005
       AND (_from IS NULL OR id = _from)
     ORDER BY installment_no
       FOR UPDATE
  LOOP
    v_pay := ROUND(LEAST(v_rem, r.balance), 2);
    IF v_pay <= 0 THEN CONTINUE; END IF;
    IF v_first IS NULL THEN v_first := r.id; END IF;
    UPDATE public.emi_installments
       SET paid_amount = paid_amount + v_pay,
           balance = ROUND(balance - v_pay, 2),
           status = CASE WHEN ROUND(balance - v_pay, 2) <= 0.005 THEN 'paid'
                         WHEN paid_amount + v_pay > 0 THEN 'partially_paid'
                         ELSE status END,
           paid_at = COALESCE(paid_at, now()),
           payment_id = COALESCE(payment_id, _payment),
           updated_at = now()
     WHERE id = r.id;
    v_rem := ROUND(v_rem - v_pay, 2);
    v_paid := ROUND(v_paid + v_pay, 2);
    EXIT WHEN v_rem <= 0.005;
  END LOOP;

  IF v_paid > 0 THEN
    INSERT INTO public.emi_payments(
        business_id, emi_id, installment_id, branch_id, customer_id, sale_id, account_id,
        amount, kind, method, paid_on, txn_ref, note,
        customer_payment_id, money_txn_id, journal_entry_id)
      SELECT _biz, _emi, v_first, e.branch_id, e.customer_id, e.sale_id, _account,
             v_paid, COALESCE(_kind, 'installment'), COALESCE(_method, 'cash'),
             COALESCE(_date, current_date), NULLIF(_txn_ref, ''), NULLIF(_note, ''),
             _payment, _money, _journal
        FROM public.sales_emi e
       WHERE e.id = _emi AND e.business_id = _biz;
  END IF;

  SELECT COALESCE(SUM(balance), 0) INTO v_out FROM public.emi_installments WHERE emi_id = _emi;
  IF v_out <= 0.005 THEN
    UPDATE public.sales_emi
       SET status = 'closed', closed_at = COALESCE(closed_at, now()),
           closed_by = COALESCE(closed_by, auth.uid()), updated_at = now()
     WHERE id = _emi AND status IN ('active', 'defaulted');
  END IF;

  RETURN v_paid;
END $$;
REVOKE ALL ON FUNCTION public._emi_allocate(uuid, uuid, numeric, uuid, date, public.payment_method, text, text, uuid, uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 8) create_emi_sale_full — sale + finance charge + contract in one call
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_emi_sale_full(_biz uuid, _data jsonb, _emi jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sid uuid; v_eid uuid; v_data jsonb;
  v_plan public.emi_plans%ROWTYPE;
  v_branch uuid := (_data->>'branch_id')::uuid;
  v_dp numeric(14,2) := ROUND(COALESCE((_emi->>'downpayment')::numeric, 0), 2);
  v_ten integer; v_rate numeric; v_fee numeric;
  v_sub numeric(14,2) := 0; v_disc numeric(14,2); v_tax numeric(14,2);
  v_goods numeric(14,2); v_fin numeric(14,2); v_int numeric(14,2);
  it jsonb;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager','purchase_officer','salesman','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission to create installment sales.';
  END IF;
  IF v_branch IS NULL OR NOT public.is_brand_shop(v_branch) THEN
    RAISE EXCEPTION 'Installment sales can only be created from a brand shop branch.';
  END IF;

  IF nullif(_emi->>'plan_id','') IS NOT NULL THEN
    SELECT * INTO v_plan FROM public.emi_plans WHERE id = (_emi->>'plan_id')::uuid AND business_id = _biz;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid installment plan.'; END IF;
    IF v_plan.status <> 'active' THEN RAISE EXCEPTION 'This installment plan is not active.'; END IF;
  END IF;

  v_ten := COALESCE(NULLIF(_emi->>'tenure','')::integer, v_plan.tenure_months);
  v_rate := COALESCE(NULLIF(_emi->>'interest_rate','')::numeric, v_plan.interest_rate, 0);
  v_fee := ROUND(COALESCE(NULLIF(_emi->>'processing_fee','')::numeric, v_plan.processing_fee, 0), 2);
  IF COALESCE(v_ten, 0) <= 0 THEN RAISE EXCEPTION 'Select an EMI plan with a valid tenure.'; END IF;
  IF jsonb_array_length(coalesce(_data->'items','[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Add at least one product.'; END IF;

  v_disc := COALESCE((_data->>'discount')::numeric, 0);
  v_tax := COALESCE((_data->>'tax')::numeric, 0);
  FOR it IN SELECT * FROM jsonb_array_elements(_data->'items') LOOP
    v_sub := v_sub + ROUND(COALESCE((it->>'qty')::int, 0) * COALESCE((it->>'price')::numeric, 0), 2);
  END LOOP;
  v_goods := ROUND(v_sub - v_disc + v_tax, 2);
  IF v_goods <= 0 THEN RAISE EXCEPTION 'Invalid sale amount.'; END IF;
  IF v_dp < 0 OR v_dp > v_goods THEN RAISE EXCEPTION 'Downpayment cannot be more than the sale amount.'; END IF;

  v_fin := ROUND(v_goods - v_dp, 2);
  IF v_fin <= 0 THEN RAISE EXCEPTION 'Downpayment covers the full amount — use a regular sale.'; END IF;
  v_int := ROUND(v_fin * v_rate / 100 * (v_ten / 12.0), 2);

  -- the sale itself (EMI flag skips the credit limit check)
  v_data := _data || jsonb_build_object('emi', true);
  v_sid := public.create_sale(_biz, v_data);

  -- contract + schedule (this folds interest + processing fee into the sale)
  v_eid := public.create_emi_contract(_biz, v_sid, jsonb_build_object(
    'plan_id', _emi->>'plan_id',
    'downpayment', v_dp,
    'start_date', _emi->>'start_date',
    'due_day', _emi->>'due_day',
    'tenure', v_ten,
    'interest', v_int,
    'processing_fee', v_fee,
    'notes', _emi->>'notes'
  ));

  RETURN jsonb_build_object('sale_id', v_sid, 'emi_id', v_eid);
END $$;
REVOKE ALL ON FUNCTION public.create_emi_sale_full(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_emi_sale_full(uuid, jsonb, jsonb) TO authenticated;

-- ============================================================
-- 9) receive_emi_payment — collect an installment
-- ============================================================
CREATE OR REPLACE FUNCTION public.receive_emi_payment(
  _biz uuid, _emi uuid, _amount numeric, _account uuid, _date date,
  _method public.payment_method, _txn_ref text, _note text, _installment uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emi public.sales_emi%ROWTYPE;
  v_out numeric; v_amt numeric; v_bal numeric;
  v_led uuid; v_j uuid; v_t uuid; v_p uuid; v_name text;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager','purchase_officer','salesman','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission to collect installments.';
  END IF;

  SELECT * INTO v_emi FROM public.sales_emi WHERE id = _emi AND business_id = _biz FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid installment plan.'; END IF;
  IF v_emi.status NOT IN ('active','defaulted') THEN
    RAISE EXCEPTION 'This installment contract is not active.';
  END IF;

  SELECT COALESCE(SUM(balance), 0) INTO v_out FROM public.emi_installments
   WHERE emi_id = _emi AND balance > 0.005;
  IF v_out <= 0 THEN RAISE EXCEPTION 'Nothing is outstanding on this contract.'; END IF;

  v_amt := ROUND(COALESCE(_amount, 0), 2);
  IF v_amt <= 0 THEN RAISE EXCEPTION 'Enter a valid amount.'; END IF;
  IF v_amt > v_out + 0.01 THEN
    RAISE EXCEPTION 'Amount (৳%) exceeds the outstanding balance (৳%).', v_amt, v_out;
  END IF;

  IF _installment IS NOT NULL THEN
    SELECT balance INTO v_bal FROM public.emi_installments
     WHERE id = _installment AND emi_id = _emi AND business_id = _biz FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid installment.'; END IF;
    IF v_amt > v_bal + 0.01 THEN RAISE EXCEPTION 'Amount exceeds this installment balance.'; END IF;
  END IF;

  SELECT ledger_account_id INTO v_led FROM public.money_accounts
   WHERE id = _account AND business_id = _biz AND status = 'active';
  IF v_led IS NULL THEN RAISE EXCEPTION 'Select the receiving account.'; END IF;
  SELECT name INTO v_name FROM public.customers WHERE id = v_emi.customer_id;

  v_j := public.post_journal(_biz, COALESCE(_date, current_date), 'emi_payment', _emi,
    'EMI installment from ' || COALESCE(v_name, 'customer'),
    jsonb_build_array(public.jl(v_led, v_amt, 0), public.jl(public.acct(_biz, '1100'), 0, v_amt)));

  INSERT INTO public.money_transactions(business_id, account_id, txn_date, direction, amount, kind, method, txn_ref, note, ref_type, ref_id, journal_entry_id)
    VALUES (_biz, _account, COALESCE(_date, current_date), 'in', v_amt, 'emi_collection',
            COALESCE(_method, 'cash'), NULLIF(_txn_ref, ''),
            COALESCE(NULLIF(_note, ''), 'EMI installment ' || COALESCE(v_emi.emi_no, '')),
            'emi', _emi, v_j)
  RETURNING id INTO v_t;

  INSERT INTO public.customer_payments(business_id, customer_id, sale_id, account_id, amount, method, txn_ref, paid_on, notes, money_txn_id, journal_entry_id)
    VALUES (_biz, v_emi.customer_id, v_emi.sale_id, _account, v_amt, COALESCE(_method, 'cash'),
            NULLIF(_txn_ref, ''), COALESCE(_date, current_date),
            COALESCE(NULLIF(_note, ''), 'EMI installment ' || COALESCE(v_emi.emi_no, '')), v_t, v_j)
  RETURNING id INTO v_p;

  PERFORM public._emi_allocate(_biz, _emi, v_amt, _account, COALESCE(_date, current_date),
    COALESCE(_method, 'cash'), _txn_ref, _note, v_p, v_j, v_t, 'installment', _installment);

  UPDATE public.sales_emi SET settled_amount = settled_amount + v_amt, updated_at = now() WHERE id = _emi;
  PERFORM public.refresh_emi_overdue(_biz);

  RETURN v_p;
END $$;
REVOKE ALL ON FUNCTION public.receive_emi_payment(uuid, uuid, numeric, uuid, date, public.payment_method, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_emi_payment(uuid, uuid, numeric, uuid, date, public.payment_method, text, text, uuid) TO authenticated;

-- ============================================================
-- 10) refresh_emi_overdue — due / overdue / defaulted bookkeeping
-- ============================================================
CREATE OR REPLACE FUNCTION public.refresh_emi_overdue(_biz uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_i integer := 0; v_c integer := 0;
BEGIN
  IF _biz IS NOT NULL THEN
    IF NOT public.has_biz_role(_biz, ARRAY['owner','manager','purchase_officer','salesman','accountant']::public.member_role[]) THEN
      RAISE EXCEPTION 'No permission.';
    END IF;
  ELSIF auth.uid() IS NOT NULL THEN
    -- unscoped refresh is reserved for the system (pg_cron / service role)
    RAISE EXCEPTION 'No permission.';
  END IF;

  UPDATE public.emi_installments i
     SET status = 'overdue', updated_at = now()
   WHERE i.balance > 0.005 AND i.due_date < current_date
     AND i.status IN ('due','partially_paid')
     AND (_biz IS NULL OR i.business_id = _biz);
  GET DIAGNOSTICS v_i = ROW_COUNT;

  UPDATE public.emi_installments i
     SET status = CASE WHEN i.paid_amount > 0 THEN 'partially_paid' ELSE 'due' END, updated_at = now()
   WHERE i.balance > 0.005 AND i.due_date >= current_date
     AND i.status = 'overdue'
     AND (_biz IS NULL OR i.business_id = _biz);

  UPDATE public.sales_emi e
     SET status = 'defaulted', updated_at = now()
   WHERE e.status = 'active'
     AND (_biz IS NULL OR e.business_id = _biz)
     AND EXISTS (SELECT 1 FROM public.emi_installments i
                  WHERE i.emi_id = e.id AND i.balance > 0.005 AND i.due_date < current_date - 30);
  GET DIAGNOSTICS v_c = ROW_COUNT;

  UPDATE public.sales_emi e
     SET status = 'active', updated_at = now()
   WHERE e.status = 'defaulted'
     AND (_biz IS NULL OR e.business_id = _biz)
     AND NOT EXISTS (SELECT 1 FROM public.emi_installments i
                      WHERE i.emi_id = e.id AND i.balance > 0.005 AND i.due_date < current_date - 30);

  RETURN jsonb_build_object('overdue_installments', v_i, 'defaulted_contracts', v_c);
END $$;
REVOKE ALL ON FUNCTION public.refresh_emi_overdue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_emi_overdue(uuid) TO authenticated;

-- ============================================================
-- 11) create_sales_emi — legacy signature, now delegates to the
--     contract builder (brand shop + role checks included)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_sales_emi(_biz uuid, _sale uuid, _plan uuid, _start_date date, _due_day int, _downpayment numeric, _tenure int, _monthly numeric, _financed numeric, _interest numeric, _processing numeric, _total numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.create_emi_contract(_biz, _sale, jsonb_build_object(
    'plan_id', _plan,
    'downpayment', _downpayment,
    'start_date', _start_date,
    'due_day', _due_day,
    'tenure', _tenure,
    'monthly_amount', _monthly,
    'interest', _interest,
    'processing_fee', _processing
  ));
END $$;
REVOKE ALL ON FUNCTION public.create_sales_emi(uuid, uuid, uuid, date, int, numeric, int, numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sales_emi(uuid, uuid, uuid, date, int, numeric, int, numeric, numeric, numeric, numeric, numeric) TO authenticated;

-- ============================================================
-- 12) Early settlement + summary + plan writer roles
-- ============================================================
CREATE OR REPLACE FUNCTION public.settle_emi_early(
  _biz uuid, _emi uuid, _amount numeric, _waive numeric, _account uuid, _date date,
  _method public.payment_method, _txn_ref text, _note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_emi public.sales_emi; v_out numeric; v_cash numeric; v_waive numeric; v_led uuid;
  v_j_coll uuid; v_t_coll uuid; v_pay_coll uuid; v_name text;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager','purchase_officer','salesman','accountant']::public.member_role[]) THEN RAISE EXCEPTION 'No permission.'; END IF;
  SELECT * INTO v_emi FROM public.sales_emi WHERE id=_emi AND business_id=_biz;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid installment plan.'; END IF;
  IF v_emi.status IN ('closed','early_settled','cancelled') THEN RAISE EXCEPTION 'This installment plan is not active.'; END IF;
  SELECT COALESCE(SUM(balance),0) INTO v_out FROM public.emi_installments WHERE emi_id=_emi;
  IF v_out <= 0 THEN RAISE EXCEPTION 'Outstanding balance is zero.'; END IF;
  v_waive := ROUND(COALESCE(_waive,0),2); IF v_waive < 0 THEN RAISE EXCEPTION 'Invalid waiver.'; END IF;
  IF v_waive > v_out THEN RAISE EXCEPTION 'Waiver exceeds outstanding.'; END IF;
  v_cash := ROUND(COALESCE(_amount, v_out - v_waive),2); IF v_cash < 0 THEN RAISE EXCEPTION 'Invalid amount.'; END IF;
  IF v_cash + v_waive > v_out + 0.01 THEN RAISE EXCEPTION 'Total exceeds outstanding.'; END IF;
  SELECT ledger_account_id INTO v_led FROM public.money_accounts WHERE id=_account AND business_id=_biz AND status='active';
  IF v_led IS NULL THEN RAISE EXCEPTION 'Select the receiving account.'; END IF;
  SELECT name INTO v_name FROM public.customers WHERE id=v_emi.customer_id;

  -- Collect cash if any
  IF v_cash > 0 THEN
    v_j_coll := public.post_journal(_biz, COALESCE(_date,current_date), 'emi_payment', _emi,
      'Early settlement from ' || COALESCE(v_name,'customer'),
      jsonb_build_array(public.jl(v_led,v_cash,0), public.jl(public.acct(_biz,'1100'),0,v_cash)));
    INSERT INTO public.money_transactions(business_id,account_id,txn_date,direction,amount,kind,method,txn_ref,note,ref_type,ref_id,journal_entry_id)
      VALUES (_biz,_account,COALESCE(_date,current_date),'in',v_cash,'emi_collection',COALESCE(_method,'cash'),
              NULLIF(_txn_ref,''),COALESCE(NULLIF(_note,''),'Early settlement '||COALESCE(v_emi.emi_no,'')),'emi',_emi,v_j_coll) RETURNING id INTO v_t_coll;
    INSERT INTO public.customer_payments(business_id,customer_id,sale_id,account_id,amount,method,txn_ref,paid_on,notes,money_txn_id,journal_entry_id)
      VALUES (_biz,v_emi.customer_id,v_emi.sale_id,_account,v_cash,COALESCE(_method,'cash'),NULLIF(_txn_ref,''),COALESCE(_date,current_date),
              COALESCE(NULLIF(_note,''),'Early settlement '||COALESCE(v_emi.emi_no,'')),v_t_coll,v_j_coll) RETURNING id INTO v_pay_coll;
    PERFORM public._emi_allocate(_biz,_emi,v_cash,_account,COALESCE(_date,current_date),COALESCE(_method,'cash'),_txn_ref,_note,v_pay_coll,v_j_coll,v_t_coll,'settlement');
  END IF;

  -- Waiver if any
  IF v_waive > 0 THEN
    PERFORM public.post_journal(_biz, COALESCE(_date,current_date), 'emi_waiver', _emi,
      'Early settlement waiver for ' || COALESCE(v_emi.emi_no,''),
      jsonb_build_array(public.jl(public.acct(_biz,'4090'),v_waive,0), public.jl(public.acct(_biz,'1100'),0,v_waive)));
    INSERT INTO public.customer_payments(business_id,customer_id,sale_id,account_id,amount,method,txn_ref,paid_on,notes,journal_entry_id)
      VALUES (_biz,v_emi.customer_id,v_emi.sale_id,_account,v_waive,'cash','',COALESCE(_date,current_date),
              'Early settlement waiver', NULL) RETURNING id INTO v_pay_coll; -- no money txn
    PERFORM public._emi_allocate(_biz,_emi,v_waive,_account,COALESCE(_date,current_date),COALESCE(_method,'cash'),_txn_ref,'Early settlement waiver',v_pay_coll,NULL,NULL,'waiver');
  END IF;

  UPDATE public.sales_emi SET settled_amount = settled_amount + v_cash, waived_amount = waived_amount + v_waive, status='early_settled', closed_at=now(), closed_by=auth.uid(), updated_at=now() WHERE id=_emi;
  RETURN jsonb_build_object('emi_id',_emi,'cash',v_cash,'waive',v_waive);
END $$;
REVOKE ALL ON FUNCTION public.settle_emi_early(uuid, uuid, numeric, numeric, uuid, date, public.payment_method, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_emi_early(uuid, uuid, numeric, numeric, uuid, date, public.payment_method, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.emi_summary(_biz uuid, _branch uuid DEFAULT null)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_cnt int; v_active int; v_fin numeric(14,2); v_dp numeric(14,2);
  v_coll numeric(14,2); v_out numeric(14,2); v_od numeric(14,2); v_odc int;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager','purchase_officer','salesman','accountant']::public.member_role[]) THEN RAISE EXCEPTION 'No permission.'; END IF;
  SELECT count(*), count(*) FILTER (WHERE status='active'), COALESCE(sum(financed_amount),0), COALESCE(sum(downpayment),0)
    INTO v_cnt, v_active, v_fin, v_dp
    FROM public.sales_emi WHERE business_id=_biz AND (_branch IS NULL OR branch_id=_branch);
  SELECT COALESCE(sum(p.amount),0) INTO v_coll
    FROM public.emi_payments p JOIN public.sales_emi e ON e.id=p.emi_id
    WHERE e.business_id=_biz AND p.kind <> 'waiver' AND (_branch IS NULL OR e.branch_id=_branch);
  SELECT COALESCE(sum(i.balance),0) INTO v_out
    FROM public.emi_installments i JOIN public.sales_emi e ON e.id=i.emi_id
    WHERE e.business_id=_biz AND (_branch IS NULL OR e.branch_id=_branch);
  SELECT COALESCE(sum(i.balance),0), count(*) INTO v_od, v_odc
    FROM public.emi_installments i JOIN public.sales_emi e ON e.id=i.emi_id
    WHERE e.business_id=_biz AND i.balance>0.005 AND i.due_date < current_date AND (_branch IS NULL OR e.branch_id=_branch);
  RETURN jsonb_build_object('contracts_total', v_cnt, 'active_contracts', v_active,
    'financed_total', v_fin, 'downpayment_total', v_dp, 'collected_total', v_coll,
    'outstanding_total', v_out, 'overdue_amount', v_od, 'overdue_count', v_odc);
END $$;
REVOKE ALL ON FUNCTION public.emi_summary(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emi_summary(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_emi_plan(_biz uuid, _id uuid DEFAULT NULL, _data jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid:=_id; v_name text:=NULLIF(_data->>'name',''); v_ten int:=COALESCE((_data->>'tenure_months')::int,0);
  v_rate numeric:=COALESCE((_data->>'interest_rate')::numeric,0); v_fee numeric:=COALESCE((_data->>'processing_fee')::numeric,0);
  v_dp numeric:=COALESCE((_data->>'downpayment_percent')::numeric,0); v_status public.record_status:=COALESCE(NULLIF(_data->>'status','')::public.record_status,'active');
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager','purchase_officer','accountant']::public.member_role[]) THEN RAISE EXCEPTION 'No permission.'; END IF;
  IF v_name IS NULL OR v_ten<=0 OR v_dp<0 OR v_dp>100 OR v_rate<0 OR v_fee<0 THEN RAISE EXCEPTION 'Invalid data.'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.emi_plans(business_id,name,tenure_months,interest_rate,processing_fee,downpayment_percent,status) VALUES(_biz,v_name,v_ten,v_rate,v_fee,v_dp,v_status) RETURNING id INTO v_id;
  ELSE
    UPDATE public.emi_plans SET name=v_name,tenure_months=v_ten,interest_rate=v_rate,processing_fee=v_fee,downpayment_percent=v_dp,status=v_status,updated_at=now() WHERE id=v_id AND business_id=_biz;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.save_emi_plan(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_emi_plan(uuid,uuid,jsonb) TO authenticated;

-- ============================================================
-- 13) RLS — only the five EMI roles can read or write
-- ============================================================
ALTER TABLE public.emi_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS emi_payments_read ON public.emi_payments;
DROP POLICY IF EXISTS emi_payments_write ON public.emi_payments;
CREATE POLICY emi_payments_read ON public.emi_payments FOR SELECT TO authenticated
  USING (public.has_biz_role(business_id, ARRAY['owner','manager','purchase_officer','salesman','accountant']::public.member_role[]));
CREATE POLICY emi_payments_write ON public.emi_payments FOR ALL TO authenticated
  USING (public.has_biz_role(business_id, ARRAY['owner','manager','purchase_officer','salesman','accountant']::public.member_role[]))
  WITH CHECK (public.has_biz_role(business_id, ARRAY['owner','manager','purchase_officer','salesman','accountant']::public.member_role[]));

DROP POLICY IF EXISTS emi_plans_read ON public.emi_plans;
DROP POLICY IF EXISTS emi_plans_write ON public.emi_plans;
CREATE POLICY emi_plans_read ON public.emi_plans FOR SELECT TO authenticated
  USING (public.has_biz_role(business_id, ARRAY['owner','manager','purchase_officer','salesman','accountant']::public.member_role[]));
CREATE POLICY emi_plans_write ON public.emi_plans FOR ALL TO authenticated
  USING (public.has_biz_role(business_id, ARRAY['owner','manager','purchase_officer','accountant']::public.member_role[]))
  WITH CHECK (public.has_biz_role(business_id, ARRAY['owner','manager','purchase_officer','accountant']::public.member_role[]));

DROP POLICY IF EXISTS sales_emi_read ON public.sales_emi;
DROP POLICY IF EXISTS sales_emi_write ON public.sales_emi;
CREATE POLICY sales_emi_read ON public.sales_emi FOR SELECT TO authenticated
  USING (public.has_biz_role(business_id, ARRAY['owner','manager','purchase_officer','salesman','accountant']::public.member_role[]));
CREATE POLICY sales_emi_write ON public.sales_emi FOR ALL TO authenticated
  USING (public.has_biz_role(business_id, ARRAY['owner','manager','purchase_officer','salesman','accountant']::public.member_role[]))
  WITH CHECK (public.has_biz_role(business_id, ARRAY['owner','manager','purchase_officer','salesman','accountant']::public.member_role[]));

DROP POLICY IF EXISTS emi_inst_read ON public.emi_installments;
DROP POLICY IF EXISTS emi_inst_write ON public.emi_installments;
CREATE POLICY emi_inst_read ON public.emi_installments FOR SELECT TO authenticated
  USING (public.has_biz_role(business_id, ARRAY['owner','manager','purchase_officer','salesman','accountant']::public.member_role[]));
CREATE POLICY emi_inst_write ON public.emi_installments FOR ALL TO authenticated
  USING (public.has_biz_role(business_id, ARRAY['owner','manager','purchase_officer','salesman','accountant']::public.member_role[]))
  WITH CHECK (public.has_biz_role(business_id, ARRAY['owner','manager','purchase_officer','salesman','accountant']::public.member_role[]));

GRANT SELECT,INSERT,UPDATE,DELETE ON public.emi_payments TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.emi_plans TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sales_emi TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.emi_installments TO authenticated;
