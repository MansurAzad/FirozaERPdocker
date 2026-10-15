-- Support for the Salesman Commission management page and the Dealer / Sub-dealer page.
-- Scope: what those two pages need to run correctly.
--   * salesmen.user_id link so a salesman profile can be attributed to sales.created_by
--   * idempotent commission accrual + a working, tenant/role-guarded accrual RPC
--   * tenant/role guards + EXECUTE grants on the RPCs the pages call
--   * one atomic RPC to set a dealer credit limit (customers is the enforced source of truth,
--     dealer_credit keeps status/terms/approval for the dealer workspace)

-- 1. Link a salesman profile to an app user (business member).
ALTER TABLE public.salesmen ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS salesmen_business_user_key
  ON public.salesmen (business_id, user_id) WHERE user_id IS NOT NULL;

-- 2. One commission row per (sale, salesman) so accrual can be re-run safely.
CREATE UNIQUE INDEX IF NOT EXISTS commission_transactions_reference_key
  ON public.commission_transactions (business_id, salesman_id, reference_type, reference_id);

-- 3. Fix get_salesman_commission_summary: the declared table had 7 columns but the body
--    only returned 6 (runtime "returned structure not compatible"). Keep the declared
--    signature and actually return total_sales.
CREATE OR REPLACE FUNCTION public.get_salesman_commission_summary(
  _biz uuid,
  _salesman_id uuid,
  _from_date date,
  _to_date date
)
RETURNS TABLE(
  salesman_id uuid,
  salesman_name text,
  total_sales numeric,
  total_commission numeric,
  paid_commission numeric,
  pending_commission numeric,
  transaction_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_member(_biz) THEN
    RAISE EXCEPTION 'Not authorized.';
  END IF;

  RETURN QUERY
  SELECT s.id,
         s.name,
         COALESCE(SUM(CASE WHEN ct.reference_type = 'sale' THEN sa.total ELSE 0 END), 0)::numeric AS total_sales,
         COALESCE(sum(ct.amount), 0)::numeric,
         COALESCE(sum(ct.paid_amount), 0)::numeric,
         COALESCE(sum(ct.pending_amount), 0)::numeric,
         COALESCE(count(ct.id), 0)::integer
  FROM public.salesmen s
  LEFT JOIN public.commission_transactions ct
    ON ct.salesman_id = s.id
   AND ct.business_id = s.business_id
   AND ct.status <> 'cancelled'
   AND ct.created_at::date >= _from_date
   AND ct.created_at::date <= _to_date
  LEFT JOIN public.sales AS sa
    ON sa.id = ct.reference_id AND ct.reference_type = 'sale'
  WHERE s.business_id = _biz AND s.id = COALESCE(_salesman_id, s.id)
  GROUP BY s.id, s.name;
END;
$$;

-- 3b. Accrue commission for one salesman over a date range from posted sales they created.
CREATE OR REPLACE FUNCTION public.accrue_salesman_commission(
  _biz uuid,
  _salesman_id uuid,
  _from date,
  _to date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_rule uuid;
  v_percent numeric(6,3) := 0;
  v_per_device numeric(14,2) := 0;
  v_count integer := 0;
  r record;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner', 'manager', 'accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;

  SELECT user_id INTO v_user FROM public.salesmen WHERE id = _salesman_id AND business_id = _biz;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Link this salesman to a team member before calculating commission.';
  END IF;

  SELECT id, percent, per_device INTO v_rule, v_percent, v_per_device
  FROM public.commission_rules
  WHERE business_id = _biz AND user_id = v_user;
  IF v_rule IS NULL THEN
    RAISE EXCEPTION 'Set this salesman''s commission rule (percent + per device) first.';
  END IF;

  FOR r IN
    SELECT sa.id,
           sa.subtotal,
           sa.discount,
           COALESCE((
             SELECT sum(si.qty) FROM public.sale_items si
             WHERE si.sale_id = sa.id AND si.imei_id IS NOT NULL
           ), 0)::integer AS devices
    FROM public.sales sa
    WHERE sa.business_id = _biz
      AND sa.status = 'posted'
      AND sa.created_by = v_user
      AND sa.sale_date >= _from
      AND sa.sale_date <= _to
      AND NOT EXISTS (
        SELECT 1 FROM public.commission_transactions ct
        WHERE ct.business_id = _biz
          AND ct.salesman_id = _salesman_id
          AND ct.reference_type = 'sale'
          AND ct.reference_id = sa.id
      )
  LOOP
    DECLARE
      v_amount numeric(14,2);
    BEGIN
      v_amount := round(
        (coalesce(r.subtotal, 0) - coalesce(r.discount, 0)) * (v_percent / 100)
        + r.devices * v_per_device,
        2
      );
      IF v_amount > 0 THEN
        INSERT INTO public.commission_transactions (
          business_id, salesman_id, rule_id, reference_type, reference_id,
          amount, paid_amount, pending_amount, status
        ) VALUES (
          _biz, _salesman_id, v_rule, 'sale', r.id,
          v_amount, 0, v_amount, 'pending'
        );
        v_count := v_count + 1;
      END IF;
    END;
  END LOOP;

  RETURN v_count;
END;
$$;

-- 4. Commission payment: keep the signature, add tenant + role guard and row locking.
CREATE OR REPLACE FUNCTION public.pay_salesman_commission(
  _biz uuid,
  _commission_id uuid,
  _amount numeric,
  _payment_method text,
  _transaction_ref text,
  _note text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  commission_rec public.commission_transactions%ROWTYPE;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner', 'manager', 'accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;
  IF coalesce(_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'Invalid payment amount.';
  END IF;

  SELECT * INTO commission_rec
  FROM public.commission_transactions
  WHERE id = _commission_id AND business_id = _biz
  FOR UPDATE;

  IF commission_rec.id IS NULL THEN
    RAISE EXCEPTION 'Commission not found';
  END IF;
  IF commission_rec.status = 'cancelled' THEN
    RAISE EXCEPTION 'This commission entry is cancelled.';
  END IF;
  IF _amount > commission_rec.pending_amount THEN
    RAISE EXCEPTION 'Payment amount cannot exceed pending commission';
  END IF;

  UPDATE public.commission_transactions
  SET
    paid_amount = paid_amount + _amount,
    pending_amount = pending_amount - _amount,
    payment_date = current_date,
    payment_method = _payment_method,
    transaction_ref = _transaction_ref,
    note = COALESCE(_note, note),
    status = CASE WHEN pending_amount - _amount <= 0 THEN 'paid' ELSE 'pending' END,
    updated_at = now()
  WHERE id = _commission_id AND business_id = _biz;
END;
$$;

-- 5. Dealer credit: customers.credit_limit / payment_terms_days is the enforced source of truth
--    (create_sale reads it), dealer_credit keeps status/approval for the dealer workspace.
CREATE OR REPLACE FUNCTION public.set_dealer_credit(
  _biz uuid,
  _customer uuid,
  _credit_limit numeric,
  _payment_terms_days integer,
  _status text DEFAULT 'active'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type public.customer_type;
  v_status text := coalesce(_status, 'active');
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner', 'manager', 'accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;
  IF coalesce(_credit_limit, 0) < 0 THEN
    RAISE EXCEPTION 'Credit limit cannot be negative.';
  END IF;
  IF v_status NOT IN ('active', 'blocked', 'suspended') THEN
    RAISE EXCEPTION 'Invalid dealer status.';
  END IF;

  SELECT type INTO v_type FROM public.customers WHERE id = _customer AND business_id = _biz;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'Invalid customer.';
  END IF;
  IF v_type NOT IN ('wholesale_dealer', 'sub_dealer', 'dealer') THEN
    RAISE EXCEPTION 'Only dealer customers can have dealer credit.';
  END IF;

  UPDATE public.customers
  SET credit_limit = coalesce(_credit_limit, 0),
      payment_terms_days = coalesce(_payment_terms_days, payment_terms_days)
  WHERE id = _customer AND business_id = _biz;

  INSERT INTO public.dealer_credit (
    business_id, customer_id, credit_limit, current_due, payment_terms_days,
    status, approved_by, approved_at
  ) VALUES (
    _biz, _customer, coalesce(_credit_limit, 0), public.customer_due(_customer),
    coalesce(_payment_terms_days, 0), v_status, auth.uid(), now()
  )
  ON CONFLICT (business_id, customer_id) DO UPDATE SET
    credit_limit = EXCLUDED.credit_limit,
    current_due = public.customer_due(_customer),
    payment_terms_days = EXCLUDED.payment_terms_days,
    status = EXCLUDED.status,
    approved_by = auth.uid(),
    approved_at = now(),
    updated_at = now();
END;
$$;

-- 6. Grants (0009 revoked default EXECUTE from anon/PUBLIC, so newer functions need an explicit grant).
REVOKE EXECUTE ON FUNCTION public.get_salesman_commission_summary(uuid, uuid, date, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.accrue_salesman_commission(uuid, uuid, date, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.pay_salesman_commission(uuid, uuid, numeric, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_dealer_credit(uuid, uuid, numeric, integer, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_salesman_commission_summary(uuid, uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accrue_salesman_commission(uuid, uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_salesman_commission(uuid, uuid, numeric, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_dealer_credit(uuid, uuid, numeric, integer, text) TO authenticated;

COMMENT ON FUNCTION public.accrue_salesman_commission(uuid, uuid, date, date) IS
  'Creates pending commission_transactions for posted sales created by the linked team member; safe to re-run.';
COMMENT ON FUNCTION public.set_dealer_credit(uuid, uuid, numeric, integer, text) IS
  'Sets dealer credit limit/terms atomically on customers (enforced) and dealer_credit (workspace status).';
