ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_business_id_id_unique UNIQUE (business_id, id);

ALTER TABLE public.journal_entries
  ADD CONSTRAINT journal_entries_business_id_id_unique UNIQUE (business_id, id),
  ADD COLUMN branch_id uuid REFERENCES public.branches(id);

ALTER TABLE public.money_accounts
  ADD CONSTRAINT money_accounts_business_id_id_unique UNIQUE (business_id, id);

ALTER TABLE public.money_transactions
  ADD COLUMN branch_id uuid REFERENCES public.branches(id);

ALTER TABLE public.finance_providers
  ADD COLUMN ledger_account_id uuid;

INSERT INTO public.accounts (business_id, code, name, type, is_system)
SELECT fp.business_id,
       'PF-' || upper(replace(fp.id::text, '-', '')),
       'Partner Finance Receivable - ' || fp.name,
       'asset',
       false
  FROM public.finance_providers fp
ON CONFLICT (business_id, code) DO NOTHING;

UPDATE public.finance_providers fp
   SET ledger_account_id = a.id
  FROM public.accounts a
 WHERE a.business_id = fp.business_id
   AND a.code = 'PF-' || upper(replace(fp.id::text, '-', ''))
   AND fp.ledger_account_id IS NULL;

ALTER TABLE public.finance_providers
  ALTER COLUMN ledger_account_id SET NOT NULL,
  ADD CONSTRAINT finance_providers_business_ledger_account_fkey
    FOREIGN KEY (business_id, ledger_account_id)
    REFERENCES public.accounts(business_id, id);

CREATE TABLE public.partner_finance_settings (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  maximum_downpayment_discount_rate numeric(5,2) NOT NULL DEFAULT 0
    CHECK (maximum_downpayment_discount_rate BETWEEN 0 AND 100),
  approval_required boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  updated_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER audit_partner_finance_settings
  AFTER INSERT OR UPDATE OR DELETE ON public.partner_finance_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

ALTER TABLE public.partner_finance_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_finance_settings_read ON public.partner_finance_settings
  FOR SELECT TO authenticated
  USING (public.is_member(business_id) AND public.has_module_access(business_id, 'sales', 'view'));
GRANT SELECT ON public.partner_finance_settings TO authenticated;
REVOKE ALL ON public.partner_finance_settings FROM PUBLIC, anon;

ALTER TABLE public.partner_financed_sales
  ADD COLUMN downpayment_type text NOT NULL DEFAULT 'fixed'
    CHECK (downpayment_type IN ('fixed','percentage')),
  ADD COLUMN downpayment_rate numeric(7,4)
    CHECK (downpayment_rate IS NULL OR downpayment_rate BETWEEN 0 AND 100),
  ADD COLUMN discount_type text NOT NULL DEFAULT 'fixed'
    CHECK (discount_type IN ('fixed','percentage')),
  ADD COLUMN discount_rate numeric(7,4)
    CHECK (discount_rate IS NULL OR discount_rate BETWEEN 0 AND 100),
  ADD COLUMN discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  ADD COLUMN net_downpayment numeric(14,2) NOT NULL DEFAULT 0 CHECK (net_downpayment >= 0),
  ADD COLUMN discount_approval_status text NOT NULL DEFAULT 'not_required'
    CHECK (discount_approval_status IN ('not_required','approved')),
  ADD COLUMN discount_approved_by uuid,
  ADD COLUMN discount_approved_at timestamptz,
  ADD COLUMN transaction_date date NOT NULL DEFAULT current_date,
  ADD COLUMN downpayment_account_id uuid REFERENCES public.money_accounts(id),
  ADD COLUMN partner_finance_account_id uuid,
  ADD COLUMN sale_journal_entry_id uuid,
  ADD COLUMN downpayment_journal_entry_id uuid,
  ADD COLUMN downpayment_money_transaction_id uuid REFERENCES public.money_transactions(id),
  ADD CONSTRAINT partner_financed_sales_approval_fields_check CHECK (
    (discount_approval_status = 'approved'
      AND discount_approved_by IS NOT NULL
      AND discount_approved_at IS NOT NULL)
    OR
    (discount_approval_status = 'not_required'
      AND discount_approved_by IS NULL
      AND discount_approved_at IS NULL)
  ),
  ADD CONSTRAINT partner_financed_sales_provider_account_fkey
    FOREIGN KEY (business_id, partner_finance_account_id)
    REFERENCES public.accounts(business_id, id),
  ADD CONSTRAINT partner_financed_sales_sale_journal_fkey
    FOREIGN KEY (business_id, sale_journal_entry_id)
    REFERENCES public.journal_entries(business_id, id),
  ADD CONSTRAINT partner_financed_sales_downpayment_journal_fkey
    FOREIGN KEY (business_id, downpayment_journal_entry_id)
    REFERENCES public.journal_entries(business_id, id);

UPDATE public.partner_financed_sales pfs
   SET net_downpayment = pfs.downpayment,
       partner_finance_account_id = fp.ledger_account_id,
       sale_journal_entry_id = (
         SELECT je.id
           FROM public.journal_entries je
          WHERE je.business_id = pfs.business_id
            AND je.ref_type = 'partner_finance_sale'
            AND je.ref_id = pfs.sale_id
          ORDER BY je.created_at
          LIMIT 1
       )
  FROM public.finance_providers fp
 WHERE fp.business_id = pfs.business_id
   AND fp.id = pfs.provider_id;

ALTER TABLE public.partner_financed_sales
  ALTER COLUMN partner_finance_account_id SET NOT NULL,
  ADD CONSTRAINT partner_financed_sales_downpayment_discount_check CHECK (
    discount_amount <= downpayment
    AND net_downpayment = downpayment - discount_amount
  ),
  ADD CONSTRAINT partner_financed_sales_downpayment_account_business_fkey
    FOREIGN KEY (business_id, downpayment_account_id)
    REFERENCES public.money_accounts(business_id, id);

CREATE UNIQUE INDEX partner_finance_journal_posting_once
  ON public.journal_entries (business_id, ref_type, ref_id)
  WHERE ref_type IN ('partner_finance_sale', 'partner_finance_cogs', 'partner_finance_downpayment')
    AND ref_id IS NOT NULL;

CREATE UNIQUE INDEX partner_finance_downpayment_money_once
  ON public.money_transactions (business_id, ref_type, ref_id)
  WHERE ref_type = 'partner_finance_downpayment' AND ref_id IS NOT NULL;

INSERT INTO public.accounts (business_id, code, name, type)
SELECT b.id, '4090', 'Sales Discount', 'revenue'
  FROM public.businesses b
ON CONFLICT (business_id, code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.save_finance_provider(
  _biz uuid, _id uuid, _name text, _legal_name text, _status public.record_status, _notes text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_code text;
  v_account uuid;
BEGIN
  IF NOT public.has_module_access(_biz, 'sales', 'view')
    OR NOT (public.has_module_access(_biz, 'sales', 'create') OR public.has_module_access(_biz, 'sales', 'edit'))
    OR NOT public.has_biz_role(_biz, ARRAY['owner','manager']::public.member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission to manage finance providers.';
  END IF;
  IF length(trim(COALESCE(_name, ''))) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Provider name must be between 1 and 100 characters.';
  END IF;
  IF _id IS NULL THEN
    INSERT INTO public.finance_providers(business_id,name,legal_name,status,notes)
    VALUES (_biz,trim(_name),NULLIF(trim(COALESCE(_legal_name,'')),''),COALESCE(_status,'active'),NULLIF(trim(COALESCE(_notes,'')),''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.finance_providers
       SET name=trim(_name), legal_name=NULLIF(trim(COALESCE(_legal_name,'')), ''),
           status=COALESCE(_status,'active'), notes=NULLIF(trim(COALESCE(_notes,'')), ''),
           updated_at=now()
     WHERE business_id=_biz AND id=_id
     RETURNING id, ledger_account_id INTO v_id, v_account;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Finance provider not found.'; END IF;
  END IF;

  v_code := 'PF-' || upper(replace(v_id::text, '-', ''));
  IF v_account IS NULL THEN
    INSERT INTO public.accounts(business_id,code,name,type,is_system)
    VALUES (_biz,v_code,'Partner Finance Receivable - ' || trim(_name),'asset',false)
    ON CONFLICT (business_id,code) DO UPDATE SET name=EXCLUDED.name
    RETURNING id INTO v_account;
    UPDATE public.finance_providers
       SET ledger_account_id=v_account
     WHERE business_id=_biz AND id=v_id;
  ELSE
    UPDATE public.accounts
       SET name='Partner Finance Receivable - ' || trim(_name)
     WHERE business_id=_biz AND id=v_account;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.save_partner_finance_discount_policy(
  _biz uuid,
  _maximum_downpayment_discount_rate numeric,
  _approval_required boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_module_access(_biz, 'sales', 'view')
    OR NOT (public.has_module_access(_biz, 'sales', 'create') OR public.has_module_access(_biz, 'sales', 'edit'))
    OR NOT public.has_biz_role(_biz, ARRAY['owner','manager']::public.member_role[]) THEN
    RAISE EXCEPTION 'Only an owner or manager with Sales access can configure the discount policy.';
  END IF;
  IF _maximum_downpayment_discount_rate IS NULL
    OR _maximum_downpayment_discount_rate < 0
    OR _maximum_downpayment_discount_rate > 100
    OR _approval_required IS NULL THEN
    RAISE EXCEPTION 'Discount limit must be between 0 and 100 percent and approval policy is required.';
  END IF;

  INSERT INTO public.partner_finance_settings(
    business_id, maximum_downpayment_discount_rate, approval_required, created_by, updated_by
  ) VALUES (
    _biz, ROUND(_maximum_downpayment_discount_rate, 2), _approval_required, auth.uid(), auth.uid()
  )
  ON CONFLICT (business_id) DO UPDATE
    SET maximum_downpayment_discount_rate = EXCLUDED.maximum_downpayment_discount_rate,
        approval_required = EXCLUDED.approval_required,
        updated_by = auth.uid(),
        updated_at = now();
END $$;

DROP FUNCTION public.create_partner_financed_sale(
  uuid,uuid,uuid,uuid,uuid,uuid,numeric,numeric,numeric,integer,numeric,numeric,text,text,date,text
);

CREATE FUNCTION public.create_partner_financed_sale(
  _biz uuid, _branch uuid, _customer uuid, _provider uuid, _variant uuid, _imei uuid,
  _sale_price numeric, _downpayment_value numeric, _downpayment_type text,
  _discount_value numeric, _discount_type text, _downpayment_account uuid,
  _expected_settlement numeric, _installment_count integer, _installment_amount numeric,
  _customer_total_repayment numeric, _application_reference text, _approval_reference text,
  _sale_date date, _notes text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale uuid;
  v_item uuid;
  v_finance_sale uuid;
  v_invoice text;
  v_seq integer;
  v_is_serial boolean;
  v_min numeric;
  v_warranty integer;
  v_cost numeric;
  v_qty integer;
  v_customer_name text;
  v_money_ledger uuid;
  v_provider_ledger uuid;
  v_sale_journal uuid;
  v_cogs_journal uuid;
  v_downpayment_journal uuid;
  v_money_txn uuid;
  v_downpayment numeric(14,2);
  v_downpayment_rate numeric(7,4);
  v_discount numeric(14,2);
  v_discount_rate numeric(7,4);
  v_effective_discount_rate numeric(7,4);
  v_net_downpayment numeric(14,2);
  v_financed numeric(14,2);
  v_price numeric(14,2) := ROUND(COALESCE(_sale_price,0),2);
  v_expected numeric(14,2) := ROUND(COALESCE(_expected_settlement,0),2);
  v_monthly numeric(14,2) := ROUND(COALESCE(_installment_amount,0),2);
  v_customer_total numeric(14,2) := ROUND(COALESCE(_customer_total_repayment,0),2);
  v_max_discount_rate numeric(5,2);
  v_approval_required boolean;
  v_approval_status text := 'not_required';
  v_is_approver boolean := public.has_biz_role(_biz, ARRAY['owner','manager']::public.member_role[]);
  v_date date := COALESCE(_sale_date,current_date);
BEGIN
  IF NOT public.has_module_access(_biz,'sales','view')
    OR NOT public.has_module_access(_biz,'sales','create')
    OR NOT public.has_biz_role(_biz,ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission to create a partner-financed sale.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id=_branch AND business_id=_biz AND status='active' AND kind='branch') THEN
    RAISE EXCEPTION 'Partner-financed sales are only allowed from an active brand shop.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.finance_providers WHERE id=_provider AND business_id=_biz AND status='active') THEN
    RAISE EXCEPTION 'Select an active finance provider.';
  END IF;
  SELECT name INTO v_customer_name FROM public.customers
   WHERE id=_customer AND business_id=_biz AND status='active';
  IF v_customer_name IS NULL THEN RAISE EXCEPTION 'Select an active customer.'; END IF;
  IF length(trim(COALESCE(_approval_reference,''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'A provider approval reference is required.';
  END IF;
  IF _imei IS NULL OR _variant IS NULL THEN RAISE EXCEPTION 'Select a phone and its IMEI.'; END IF;
  IF v_price <= 0 THEN RAISE EXCEPTION 'Total price must be greater than zero.'; END IF;
  IF _downpayment_type IS NULL OR _discount_type IS NULL
    OR _downpayment_type NOT IN ('fixed','percentage')
    OR _discount_type NOT IN ('fixed','percentage') THEN
    RAISE EXCEPTION 'Select a valid down payment and discount type.';
  END IF;
  IF _downpayment_value IS NULL OR _downpayment_value < 0 THEN
    RAISE EXCEPTION 'Down payment cannot be negative.';
  END IF;
  IF _downpayment_type='percentage' AND _downpayment_value>100 THEN
    RAISE EXCEPTION 'Down payment percentage must be between 0 and 100.';
  END IF;
  IF _discount_value IS NULL OR _discount_value < 0 THEN
    RAISE EXCEPTION 'Discount cannot be negative.';
  END IF;
  IF _discount_type='percentage' AND _discount_value>100 THEN
    RAISE EXCEPTION 'Discount percentage must be between 0 and 100.';
  END IF;

  v_downpayment_rate := CASE WHEN _downpayment_type='percentage' THEN ROUND(_downpayment_value,4) ELSE NULL END;
  v_downpayment := ROUND(
    CASE WHEN _downpayment_type='percentage'
      THEN v_price * _downpayment_value / 100
      ELSE _downpayment_value
    END, 2
  );
  v_discount_rate := CASE WHEN _discount_type='percentage' THEN ROUND(_discount_value,4) ELSE NULL END;
  v_discount := ROUND(
    CASE WHEN _discount_type='percentage'
      THEN v_downpayment * _discount_value / 100
      ELSE _discount_value
    END, 2
  );
  IF v_downpayment >= v_price THEN
    RAISE EXCEPTION 'Down payment must be less than the total price.';
  END IF;
  IF v_discount > v_downpayment THEN
    RAISE EXCEPTION 'Discount cannot exceed the down payment.';
  END IF;
  v_net_downpayment := ROUND(v_downpayment-v_discount,2);
  v_financed := ROUND(v_price-v_downpayment,2);
  v_effective_discount_rate := CASE WHEN v_downpayment>0
    THEN ROUND(v_discount/v_downpayment*100,4) ELSE 0 END;

  SELECT COALESCE(s.maximum_downpayment_discount_rate,0), COALESCE(s.approval_required,true)
    INTO v_max_discount_rate, v_approval_required
    FROM (SELECT 1) seed
    LEFT JOIN public.partner_finance_settings s ON s.business_id=_biz;
  IF v_approval_required AND v_discount>0 AND v_effective_discount_rate>v_max_discount_rate THEN
    IF NOT v_is_approver THEN
      RAISE EXCEPTION 'Discount exceeds the configured %%% limit. An owner or manager must approve it.',
        v_max_discount_rate;
    END IF;
    v_approval_status := 'approved';
  END IF;

  IF v_expected <= 0 OR COALESCE(_installment_count,0) <= 0
    OR v_monthly <= 0 OR v_customer_total < v_monthly THEN
    RAISE EXCEPTION 'Invalid sale or provider repayment terms.';
  END IF;
  IF v_customer_total < v_financed THEN
    RAISE EXCEPTION 'Customer repayment total cannot be less than the financed amount.';
  END IF;

  SELECT fp.ledger_account_id INTO v_provider_ledger
    FROM public.finance_providers fp
   WHERE fp.id=_provider AND fp.business_id=_biz AND fp.status='active';
  IF v_provider_ledger IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.accounts a
     WHERE a.id=v_provider_ledger AND a.business_id=_biz AND a.type='asset'
  ) THEN
    RAISE EXCEPTION 'The selected provider has no valid business receivable ledger account.';
  END IF;
  IF v_net_downpayment>0 THEN
    SELECT ma.ledger_account_id INTO v_money_ledger
      FROM public.money_accounts ma
      JOIN public.accounts a ON a.id=ma.ledger_account_id AND a.business_id=ma.business_id
     WHERE ma.id=_downpayment_account
       AND ma.business_id=_biz
       AND ma.status='active'
       AND ma.kind IN ('cash','bank')
       AND (ma.branch_id IS NULL OR ma.branch_id=_branch)
       AND a.type='asset'
     FOR UPDATE OF ma;
    IF v_money_ledger IS NULL THEN
      RAISE EXCEPTION 'Select an active cash or bank account available to this brand shop.';
    END IF;
  END IF;

  SELECT c.is_serialized,pv.min_price,pv.warranty_months
    INTO v_is_serial,v_min,v_warranty
    FROM public.product_variants pv
    JOIN public.products p ON p.id=pv.product_id AND p.business_id=_biz
    JOIN public.categories c ON c.id=p.category_id AND c.business_id=_biz
   WHERE pv.id=_variant AND pv.business_id=_biz;
  IF NOT FOUND OR NOT v_is_serial THEN RAISE EXCEPTION 'Select an IMEI-tracked phone.'; END IF;
  IF v_price < v_min AND NOT v_is_approver THEN
    RAISE EXCEPTION 'Price is below the minimum selling price. Manager approval required.';
  END IF;
  SELECT qty INTO v_qty FROM public.stock
   WHERE business_id=_biz AND branch_id=_branch AND variant_id=_variant FOR UPDATE;
  IF COALESCE(v_qty,0)<1 THEN RAISE EXCEPTION 'This phone is out of stock at the selected shop.'; END IF;
  SELECT cost INTO v_cost FROM public.product_imeis
   WHERE id=_imei AND business_id=_biz AND branch_id=_branch AND variant_id=_variant AND status='IN_STOCK'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The selected IMEI is not available at this shop.'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('sale_no_' || _biz::text));
  SELECT COALESCE(MAX(NULLIF(regexp_replace(invoice_no,'\D','','g'), '')::integer),0)+1
    INTO v_seq FROM public.sales WHERE business_id=_biz;
  v_invoice := 'INV-' || lpad(v_seq::text,6,'0');
  INSERT INTO public.sales(business_id,branch_id,customer_id,invoice_no,sale_date,subtotal,total,paid,due,cogs,status,notes,partner_financed)
  VALUES (_biz,_branch,_customer,v_invoice,v_date,v_price,v_price,0,0,v_cost,'posted',
          NULLIF(trim(COALESCE(_notes,'')),''),true)
  RETURNING id INTO v_sale;
  INSERT INTO public.sale_items(business_id,sale_id,variant_id,imei_id,qty,price,line_total,unit_cost,warranty_months)
  VALUES (_biz,v_sale,_variant,_imei,1,v_price,v_price,v_cost,COALESCE(v_warranty,0))
  RETURNING id INTO v_item;
  UPDATE public.product_imeis SET status='SOLD',sale_item_id=v_item WHERE id=_imei;
  UPDATE public.stock SET qty=qty-1,updated_at=now()
   WHERE business_id=_biz AND branch_id=_branch AND variant_id=_variant;
  INSERT INTO public.stock_movements(business_id,branch_id,variant_id,imei_id,qty_change,unit_cost,ref_type,ref_id)
  VALUES (_biz,_branch,_variant,_imei,-1,v_cost,'sale',v_sale);

  v_sale_journal := public.post_journal(
    _biz,v_date,'partner_finance_sale',v_sale,'Partner-financed sale ' || v_invoice,
    jsonb_build_array(
      public.jl(public.acct(_biz,'1100'),v_downpayment,0),
      public.jl(v_provider_ledger,v_financed,0),
      public.jl(public.acct(_biz,'4010'),0,v_price)
    )
  );
  UPDATE public.journal_entries SET branch_id=_branch
   WHERE business_id=_biz AND id=v_sale_journal;

  IF v_cost>0 THEN
    v_cogs_journal := public.post_journal(
      _biz,v_date,'partner_finance_cogs',v_sale,'Cost of goods for ' || v_invoice,
      jsonb_build_array(
        public.jl(public.acct(_biz,'5010'),v_cost,0),
        public.jl(public.acct(_biz,'1200'),0,v_cost)
      )
    );
    UPDATE public.journal_entries SET branch_id=_branch
     WHERE business_id=_biz AND id=v_cogs_journal;
  END IF;

  INSERT INTO public.partner_financed_sales(
    business_id,sale_id,provider_id,branch_id,customer_id,downpayment,financed_amount,
    expected_settlement,installment_count,installment_amount,customer_total_repayment,
    application_reference,approval_reference,notes,downpayment_type,downpayment_rate,
    discount_type,discount_rate,discount_amount,net_downpayment,discount_approval_status,
    discount_approved_by,discount_approved_at,transaction_date,downpayment_account_id,
    partner_finance_account_id,sale_journal_entry_id
  ) VALUES (
    _biz,v_sale,_provider,_branch,_customer,v_downpayment,v_financed,
    v_expected,_installment_count,v_monthly,v_customer_total,
    NULLIF(trim(COALESCE(_application_reference,'')),''),trim(_approval_reference),
    NULLIF(trim(COALESCE(_notes,'')),''),_downpayment_type,v_downpayment_rate,
    _discount_type,v_discount_rate,v_discount,v_net_downpayment,v_approval_status,
    CASE WHEN v_approval_status='approved' THEN auth.uid() END,
    CASE WHEN v_approval_status='approved' THEN now() END,
    v_date,CASE WHEN v_net_downpayment>0 THEN _downpayment_account END,
    v_provider_ledger,v_sale_journal
  ) RETURNING id INTO v_finance_sale;

  IF v_downpayment>0 THEN
    IF v_net_downpayment>0 THEN
      v_downpayment_journal := public.post_journal(
        _biz,v_date,'partner_finance_downpayment',v_finance_sale,
        'Down payment for ' || v_invoice,
        jsonb_build_array(
          public.jl(v_money_ledger,v_net_downpayment,0),
          public.jl(public.acct(_biz,'4090'),v_discount,0),
          public.jl(public.acct(_biz,'1100'),0,v_downpayment)
        )
      );
    ELSE
      v_downpayment_journal := public.post_journal(
        _biz,v_date,'partner_finance_downpayment',v_finance_sale,
        'Down payment for ' || v_invoice,
        jsonb_build_array(
          public.jl(public.acct(_biz,'4090'),v_discount,0),
          public.jl(public.acct(_biz,'1100'),0,v_downpayment)
        )
      );
    END IF;
    UPDATE public.journal_entries SET branch_id=_branch
     WHERE business_id=_biz AND id=v_downpayment_journal;
    IF v_net_downpayment>0 THEN
      INSERT INTO public.money_transactions(
        business_id,account_id,branch_id,txn_date,direction,amount,kind,method,
        note,ref_type,ref_id,journal_entry_id
      ) VALUES (
        _biz,_downpayment_account,_branch,v_date,'in',v_net_downpayment,
        'partner_finance_downpayment',
        (SELECT CASE ma.kind WHEN 'cash' THEN 'cash'::public.payment_method
                             WHEN 'bank' THEN 'bank'::public.payment_method
                             ELSE 'bkash'::public.payment_method END
           FROM public.money_accounts ma WHERE ma.id=_downpayment_account AND ma.business_id=_biz),
        'Net down payment for ' || v_invoice,
        'partner_finance_downpayment',v_finance_sale,v_downpayment_journal
      ) RETURNING id INTO v_money_txn;
    END IF;
    UPDATE public.partner_financed_sales
       SET downpayment_journal_entry_id=v_downpayment_journal,
           downpayment_money_transaction_id=v_money_txn
     WHERE business_id=_biz AND id=v_finance_sale;
  END IF;

  RETURN jsonb_build_object(
    'sale_id',v_sale,'agreement_id',v_finance_sale,'invoice_no',v_invoice,
    'downpayment',v_downpayment,'discount_amount',v_discount,
    'net_downpayment',v_net_downpayment,'financed_amount',v_financed,
    'discount_approval_status',v_approval_status
  );
END $$;

CREATE OR REPLACE FUNCTION public.partner_finance_snapshot(_biz uuid, _provider uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result jsonb;
  v_policy jsonb;
BEGIN
  IF NOT public.has_module_access(_biz,'sales','view') THEN RAISE EXCEPTION 'No permission.'; END IF;
  SELECT jsonb_build_object(
    'maximum_downpayment_discount_rate',COALESCE(s.maximum_downpayment_discount_rate,0),
    'approval_required',COALESCE(s.approval_required,true)
  ) INTO v_policy
  FROM (SELECT 1) seed
  LEFT JOIN public.partner_finance_settings s ON s.business_id=_biz;

  SELECT jsonb_build_object(
    'discount_policy',v_policy,
    'providers',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',fp.id,'name',fp.name,'legal_name',fp.legal_name,'status',fp.status,
        'notes',fp.notes,'ledger_account_id',fp.ledger_account_id
      ) ORDER BY fp.name)
      FROM public.finance_providers fp WHERE fp.business_id=_biz
    ),'[]'::jsonb),
    'sales',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',pfs.id,'sale_id',pfs.sale_id,'invoice_no',s.invoice_no,'sale_date',s.sale_date,
        'sale_price',s.total,'cogs',s.cogs,'provider_id',pfs.provider_id,'provider_name',fp.name,
        'branch_id',pfs.branch_id,'branch_name',b.name,'customer_id',pfs.customer_id,
        'customer_name',c.name,'customer_mobile',c.mobile,'downpayment',pfs.downpayment,
        'downpayment_type',pfs.downpayment_type,'downpayment_rate',pfs.downpayment_rate,
        'discount_type',pfs.discount_type,'discount_rate',pfs.discount_rate,
        'discount_amount',pfs.discount_amount,'net_downpayment',pfs.net_downpayment,
        'discount_approval_status',pfs.discount_approval_status,
        'discount_approved_by',pfs.discount_approved_by,'discount_approved_at',pfs.discount_approved_at,
        'discount_approved_by_name',approver.display_name,
        'downpayment_money_transaction_id',pfs.downpayment_money_transaction_id,
        'financed_amount',pfs.financed_amount,'expected_settlement',pfs.expected_settlement,
        'installment_count',pfs.installment_count,'installment_amount',pfs.installment_amount,
        'customer_total_repayment',pfs.customer_total_repayment,'application_reference',pfs.application_reference,
        'approval_reference',pfs.approval_reference,'status',pfs.status,'notes',pfs.notes,
        'settled_amount',COALESCE(st.settled_amount,0),'fee_total',COALESCE(st.fee_total,0),
        'outstanding_settlement',GREATEST(pfs.expected_settlement-COALESCE(st.settled_amount,0),0),
        'settlement_status',CASE WHEN COALESCE(st.settled_amount,0)>pfs.expected_settlement+0.01 THEN 'overpaid'
          WHEN COALESCE(st.settled_amount,0)>=pfs.expected_settlement-0.01 THEN 'settled'
          WHEN COALESCE(st.settled_amount,0)>0 THEN 'partial'
          ELSE 'pending' END)
        ORDER BY s.sale_date DESC,s.created_at DESC)
      FROM public.partner_financed_sales pfs
      JOIN public.sales s ON s.id=pfs.sale_id AND s.business_id=_biz
      JOIN public.finance_providers fp ON fp.id=pfs.provider_id AND fp.business_id=_biz
      JOIN public.branches b ON b.id=pfs.branch_id AND b.business_id=_biz
      JOIN public.customers c ON c.id=pfs.customer_id AND c.business_id=_biz
      LEFT JOIN public.business_members approver
        ON approver.business_id=pfs.business_id AND approver.user_id=pfs.discount_approved_by
      LEFT JOIN LATERAL (
        SELECT sum(l.net_amount) settled_amount,sum(l.fee_amount) fee_total
        FROM public.partner_settlement_lines l
        WHERE l.business_id=_biz AND l.financed_sale_id=pfs.id AND l.status='matched'
      ) st ON true
      WHERE pfs.business_id=_biz AND (_provider IS NULL OR pfs.provider_id=_provider)
    ),'[]'::jsonb),
    'settlements',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',l.id,'provider_id',l.provider_id,'provider_name',fp.name,'invoice_no',l.invoice_no,
        'external_reference',l.external_reference,'gross_amount',l.gross_amount,'fee_amount',l.fee_amount,
        'adjustment_amount',l.adjustment_amount,'net_amount',l.net_amount,'paid_on',l.paid_on,
        'status',l.status,'note',l.note,'sale_invoice',s.invoice_no,'branch_id',pfs.branch_id)
        ORDER BY l.paid_on DESC,l.created_at DESC)
      FROM public.partner_settlement_lines l
      JOIN public.finance_providers fp ON fp.id=l.provider_id AND fp.business_id=_biz
      LEFT JOIN public.partner_financed_sales pfs ON pfs.id=l.financed_sale_id AND pfs.business_id=_biz
      LEFT JOIN public.sales s ON s.id=pfs.sale_id AND s.business_id=_biz
      WHERE l.business_id=_biz AND (_provider IS NULL OR l.provider_id=_provider)
    ),'[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END $$;

DO $$
DECLARE
  v_definition text := pg_get_functiondef('public.access_rpc_allowed(uuid)'::regprocedure);
BEGIN
  IF position('save_partner_finance_discount_policy' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'Partner finance policy access rule already exists; inspect function definition.';
  END IF;
  v_definition := replace(
    v_definition,
    'WHEN ''save_finance_provider'' THEN ''sales''',
    'WHEN ''save_finance_provider'' THEN ''sales'' WHEN ''save_partner_finance_discount_policy'' THEN ''sales'''
  );
  v_definition := replace(
    v_definition,
    'WHEN v_rpc IN (''save_access_role'',''save_member_access'',''save_finance_provider'') THEN ''edit''',
    'WHEN v_rpc IN (''save_access_role'',''save_member_access'',''save_finance_provider'',''save_partner_finance_discount_policy'') THEN ''edit'''
  );
  v_definition := replace(
    v_definition,
    '''save_finance_provider'') THEN',
    '''save_finance_provider'',''save_partner_finance_discount_policy'') THEN'
  );
  IF position(
       'WHEN ''save_partner_finance_discount_policy'' THEN ''sales'''
       IN v_definition
     ) = 0
     OR position(
       '''save_partner_finance_discount_policy'') THEN'
       IN v_definition
     ) = 0
     OR position(
       '''save_partner_finance_discount_policy'') THEN ''edit'''
       IN v_definition
     ) = 0 THEN
    RAISE EXCEPTION 'Could not add partner finance policy access rule.';
  END IF;
  EXECUTE v_definition;
END $$;

REVOKE ALL ON FUNCTION public.save_partner_finance_discount_policy(uuid,numeric,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_partner_finance_discount_policy(uuid,numeric,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.create_partner_financed_sale(
  uuid,uuid,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,text,uuid,numeric,integer,numeric,numeric,text,text,date,text
) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_partner_financed_sale(
  uuid,uuid,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,text,uuid,numeric,integer,numeric,numeric,text,text,date,text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_finance_snapshot(uuid,uuid) TO authenticated;
