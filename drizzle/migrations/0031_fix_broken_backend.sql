-- 0031_fix_broken_backend.sql
-- P1 — make the priority-feature backend actually runnable.
--
-- Repairs the functions that were created in 0024/0026/0028 but could never
-- execute, because they reference columns/objects that were never created:
--   * start_bank_reconciliation()      -> money_account_balances has no account_id
--   * complete_bank_reconciliation()   -> bank_reconciliations has no updated_at,
--                                         customer/supplier_payments have no reconciled_at
--   * request/approve/reject_stock_transfer() -> status CHECK only allowed
--                                                dispatched/received and updated_at was missing
--   * generate_daily_kpi_snapshots()   -> stock_balances does not exist
--
-- No tenant/role guards are removed here: the recreated functions keep the
-- guards and the privileges applied by 0030_security_hardening.sql.

-- ===========================================================================
-- 1) Columns the priority RPCs already reference
-- ===========================================================================
ALTER TABLE public.customer_payments
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;
ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.money_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.bank_reconciliations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.stock_transfers
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Reconciliation scans payments by (account, unreconciled); index the hot path.
CREATE INDEX IF NOT EXISTS idx_customer_payments_recon
  ON public.customer_payments(account_id, reconciled_at) WHERE reconciled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_payments_recon
  ON public.supplier_payments(account_id, reconciled_at) WHERE reconciled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_payments_account
  ON public.supplier_payments(account_id);
CREATE INDEX IF NOT EXISTS idx_recon_items_lookup
  ON public.bank_reconciliation_items(reconciliation_id, transaction_type, cleared);

-- ---------------------------------------------------------------------------
-- 2) Stock-transfer approval statuses
--    The original CHECK only allowed ('dispatched','received'); the approval
--    workflow needs draft / pending_approval / approved / rejected as well.
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_transfers DROP CONSTRAINT IF EXISTS stock_transfers_status_check;
ALTER TABLE public.stock_transfers
  ADD CONSTRAINT stock_transfers_status_check
  CHECK (status IN ('draft', 'pending_approval', 'approved', 'rejected', 'dispatched', 'received'));

-- ---------------------------------------------------------------------------
-- 3) start_bank_reconciliation()
--    money_account_balances exposes the account id as "id", not "account_id".
--    Everything else (customer_payments.account_id, supplier_payments.account_id,
--    *.reconciled_at) now exists thanks to section 1.
--    Tenant/role guard matches 0030_security_hardening.sql.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_bank_reconciliation(
  _biz uuid,
  _account_id uuid,
  _reconciliation_date date,
  _statement_balance numeric,
  _note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec_id uuid;
  book_balance numeric;
  outstanding_deposits numeric := 0;
  outstanding_checks numeric := 0;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'You are not authorized for this action.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(balance, 0) INTO book_balance
  FROM public.money_account_balances
  WHERE business_id = _biz AND id = _account_id;

  SELECT COALESCE(SUM(amount), 0) INTO outstanding_deposits
  FROM public.customer_payments
  WHERE business_id = _biz AND account_id = _account_id
    AND paid_on::date > _reconciliation_date
    AND reconciled_at IS NULL;

  SELECT COALESCE(SUM(amount), 0) INTO outstanding_checks
  FROM public.supplier_payments
  WHERE business_id = _biz AND account_id = _account_id
    AND paid_on::date > _reconciliation_date
    AND reconciled_at IS NULL;

  INSERT INTO public.bank_reconciliations (
    business_id, account_id, reconciliation_date, statement_balance,
    book_balance, outstanding_deposits, outstanding_checks, status, note
  ) VALUES (
    _biz, _account_id, _reconciliation_date, _statement_balance,
    book_balance, outstanding_deposits, outstanding_checks, 'draft', _note
  )
  RETURNING id INTO rec_id;

  INSERT INTO public.bank_reconciliation_items (
    reconciliation_id, transaction_type, transaction_id, reference_type, reference_id, amount, cleared
  )
  SELECT
    rec_id,
    'deposit',
    cp.id,
    'customer_payment',
    cp.id,
    cp.amount,
    false
  FROM public.customer_payments cp
  WHERE cp.business_id = _biz
    AND cp.account_id = _account_id
    AND cp.paid_on::date <= _reconciliation_date
    AND cp.reconciled_at IS NULL;

  INSERT INTO public.bank_reconciliation_items (
    reconciliation_id, transaction_type, transaction_id, reference_type, reference_id, amount, cleared
  )
  SELECT
    rec_id,
    'withdrawal',
    sp.id,
    'supplier_payment',
    sp.id,
    sp.amount,
    false
  FROM public.supplier_payments sp
  WHERE sp.business_id = _biz
    AND sp.account_id = _account_id
    AND sp.paid_on::date <= _reconciliation_date
    AND sp.reconciled_at IS NULL;

  RETURN rec_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) generate_daily_kpi_snapshots()
--    There is no stock_balances relation; inventory value is qty * avg_cost on
--    the stock table (the same formula the Guardian snapshot already uses).
--    This function stays internal (service_role only, per 0030).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_daily_kpi_snapshots(
  _biz uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today_date date := CURRENT_DATE;
  daily_sales numeric;
  daily_purchases numeric;
  inventory_value numeric;
  total_due numeric;
BEGIN
  SELECT COALESCE(SUM(total), 0) INTO daily_sales
  FROM public.sales
  WHERE business_id = _biz AND sale_date = today_date;
  PERFORM public.record_kpi_snapshot(_biz, today_date, 'daily_sales', daily_sales);

  SELECT COALESCE(SUM(total), 0) INTO daily_purchases
  FROM public.purchases
  WHERE business_id = _biz AND purchase_date = today_date;
  PERFORM public.record_kpi_snapshot(_biz, today_date, 'daily_purchases', daily_purchases);

  SELECT COALESCE(SUM(s.qty * s.avg_cost), 0) INTO inventory_value
  FROM public.stock s
  WHERE s.business_id = _biz;
  PERFORM public.record_kpi_snapshot(_biz, today_date, 'inventory_value', inventory_value);

  SELECT COALESCE(SUM(due), 0) INTO total_due
  FROM public.sales
  WHERE business_id = _biz;
  PERFORM public.record_kpi_snapshot(_biz, today_date, 'customer_dues', total_due);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Privileges: CREATE OR REPLACE kept the ACL set by 0030, but re-assert it
--    so re-running 0031 alone (e.g. on a fresh environment) stays correct.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.start_bank_reconciliation(uuid, uuid, date, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_bank_reconciliation(uuid, uuid, date, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION public.generate_daily_kpi_snapshots(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_daily_kpi_snapshots(uuid) TO service_role;

COMMENT ON COLUMN public.customer_payments.reconciled_at IS 'Set when the receipt is cleared during bank reconciliation';
COMMENT ON COLUMN public.supplier_payments.reconciled_at IS 'Set when the payment is cleared during bank reconciliation';
COMMENT ON COLUMN public.supplier_payments.account_id IS 'Money account the supplier payment was paid from (bank reconciliation)';
COMMENT ON COLUMN public.bank_reconciliations.updated_at IS 'Last modification timestamp';
COMMENT ON COLUMN public.stock_transfers.updated_at IS 'Last modification timestamp (approval workflow)';
