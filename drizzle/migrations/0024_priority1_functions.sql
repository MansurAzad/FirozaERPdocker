CREATE OR REPLACE FUNCTION public.update_dealer_credit_on_sale(
  _biz uuid,
  _customer_id uuid,
  _sale_amount numeric,
  _paid numeric,
  _due numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_due numeric;
  new_due numeric;
BEGIN
  SELECT COALESCE(current_due, 0) INTO current_due
  FROM dealer_credit
  WHERE business_id = _biz AND customer_id = _customer_id;

  new_due := current_due + _due - _paid;

  UPDATE dealer_credit
  SET 
    current_due = new_due,
    last_payment_date = now(),
    updated_at = now()
  WHERE business_id = _biz AND customer_id = _customer_id;

  INSERT INTO dealer_payments (business_id, customer_id, amount, payment_date, payment_method, transaction_ref)
  VALUES (_biz, _customer_id, _paid, now()::date, 'credit_sale', NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_dealer_credit_on_payment(
  _biz uuid,
  _customer_id uuid,
  _amount numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_due numeric;
BEGIN
  SELECT COALESCE(current_due, 0) INTO current_due
  FROM dealer_credit
  WHERE business_id = _biz AND customer_id = _customer_id;

  UPDATE dealer_credit
  SET 
    current_due = GREATEST(current_due - _amount, 0),
    last_payment_date = now(),
    updated_at = now()
  WHERE business_id = _biz AND customer_id = _customer_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_commission_for_sale(
  _biz uuid,
  _salesman_id uuid,
  _sale_id uuid
)
RETURNS numeric(14,2)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  commission numeric(14,2) := 0;
  sale_amount numeric(14,2);
  rule commission_rules%ROWTYPE;
BEGIN
  SELECT total INTO sale_amount
  FROM sales
  WHERE id = _sale_id AND business_id = _biz;

  SELECT * INTO rule
  FROM commission_rules
  WHERE business_id = _biz 
    AND is_active = true
    AND rule_type = 'percentage'
  LIMIT 1;

  IF rule IS NOT NULL THEN
    commission := sale_amount * (rule.rate / 100);
    IF rule.max_amount IS NOT NULL THEN
      commission := LEAST(commission, rule.max_amount);
    END IF;
  END IF;

  INSERT INTO commission_transactions (
    business_id, salesman_id, reference_type, reference_id, amount,
    paid_amount, pending_amount, status
  ) VALUES (
    _biz, _salesman_id, 'sale', _sale_id, commission,
    0, commission, 'pending'
  );

  RETURN commission;
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_product_commission(
  _biz uuid,
  _salesman_id uuid,
  _sale_id uuid,
  _product_id uuid,
  _qty integer,
  _price numeric
)
RETURNS numeric(14,2)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  commission numeric(14,2) := 0;
  rule commission_rules%ROWTYPE;
  product product_variants%ROWTYPE;
BEGIN
  SELECT * INTO product
  FROM product_variants
  WHERE id = _product_id AND business_id = _biz;

  SELECT * INTO rule
  FROM commission_rules
  WHERE business_id = _biz 
    AND is_active = true
    AND rule_type = 'category_based'
    AND category_id = product.category_id
  LIMIT 1;

  IF rule IS NULL THEN
    SELECT * INTO rule
    FROM commission_rules
    WHERE business_id = _biz 
      AND is_active = true
      AND rule_type = 'brand_based'
      AND brand_id = product.brand_id
    LIMIT 1;
  END IF;

  IF rule IS NULL THEN
    SELECT * INTO rule
    FROM commission_rules
    WHERE business_id = _biz 
      AND is_active = true
      AND rule_type = 'product_based'
      AND product_id = _product_id
    LIMIT 1;
  END IF;

  IF rule IS NULL THEN
    SELECT * INTO rule
    FROM commission_rules
    WHERE business_id = _biz 
      AND is_active = true
      AND rule_type = 'fixed'
    LIMIT 1;
  END IF;

  IF rule IS NOT NULL THEN
    IF rule.rule_type = 'fixed' THEN
      commission := rule.rate * _qty;
    ELSIF rule.rule_type IN ('percentage', 'category_based', 'brand_based', 'product_based') THEN
      commission := _price * (rule.rate / 100);
    END IF;

    IF rule.max_amount IS NOT NULL THEN
      commission := LEAST(commission, rule.max_amount);
    END IF;
  END IF;

  RETURN commission;
END;
$$;

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
  commission_rec commission_transactions%ROWTYPE;
BEGIN
  SELECT * INTO commission_rec
  FROM commission_transactions
  WHERE id = _commission_id AND business_id = _biz;

  IF commission_rec IS NULL THEN
    RAISE EXCEPTION 'Commission not found';
  END IF;

  IF _amount > commission_rec.pending_amount THEN
    RAISE EXCEPTION 'Payment amount cannot exceed pending commission';
  END IF;

  UPDATE commission_transactions
  SET 
    paid_amount = paid_amount + _amount,
    pending_amount = pending_amount - _amount,
    payment_date = now()::date,
    payment_method = _payment_method,
    transaction_ref = _transaction_ref,
    note = COALESCE(_note, note),
    status = CASE WHEN pending_amount - _amount <= 0 THEN 'paid' ELSE 'pending' END,
    updated_at = now()
  WHERE id = _commission_id;
END;
$$;

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
  SELECT COALESCE(balance, 0) INTO book_balance
  FROM money_account_balances
  WHERE business_id = _biz AND account_id = _account_id;

  SELECT COALESCE(SUM(amount), 0) INTO outstanding_deposits
  FROM customer_payments
  WHERE business_id = _biz AND account_id = _account_id
    AND paid_on::date > _reconciliation_date
    AND reconciled_at IS NULL;

  SELECT COALESCE(SUM(amount), 0) INTO outstanding_checks
  FROM supplier_payments
  WHERE business_id = _biz AND account_id = _account_id
    AND paid_on::date > _reconciliation_date
    AND reconciled_at IS NULL;

  INSERT INTO bank_reconciliations (
    business_id, account_id, reconciliation_date, statement_balance,
    book_balance, outstanding_deposits, outstanding_checks, status, note
  ) VALUES (
    _biz, _account_id, _reconciliation_date, _statement_balance,
    book_balance, outstanding_deposits, outstanding_checks, 'draft', _note
  )
  RETURNING id INTO rec_id;

  INSERT INTO bank_reconciliation_items (
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
  FROM customer_payments cp
  WHERE cp.business_id = _biz 
    AND cp.account_id = _account_id
    AND cp.paid_on::date <= _reconciliation_date
    AND cp.reconciled_at IS NULL;

  INSERT INTO bank_reconciliation_items (
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
  FROM supplier_payments sp
  WHERE sp.business_id = _biz 
    AND sp.account_id = _account_id
    AND sp.paid_on::date <= _reconciliation_date
    AND sp.reconciled_at IS NULL;

  RETURN rec_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_reconciliation_item_cleared(
  _item_id uuid,
  _cleared boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE bank_reconciliation_items
  SET cleared = _cleared
  WHERE id = _item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_bank_reconciliation(
  _recon_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recon bank_reconciliations%ROWTYPE;
BEGIN
  SELECT * INTO recon
  FROM bank_reconciliations
  WHERE id = _recon_id;

  IF recon IS NULL THEN
    RAISE EXCEPTION 'Reconciliation not found';
  END IF;

  IF recon.status != 'draft' THEN
    RAISE EXCEPTION 'Reconciliation already %', recon.status;
  END IF;

  UPDATE bank_reconciliations
  SET 
    status = 'reconciled',
    updated_at = now()
  WHERE id = _recon_id;

  UPDATE money_accounts
  SET 
    last_reconciled_at = now(),
    last_reconciled_by = auth.uid(),
    statement_closing_balance = statement_closing_balance
  WHERE id = recon.account_id AND business_id = recon.business_id;

  UPDATE customer_payments
  SET reconciled_at = now()
  WHERE business_id = recon.business_id
    AND account_id = recon.account_id
    AND EXISTS (
      SELECT 1 FROM bank_reconciliation_items
      WHERE reconciliation_id = _recon_id
        AND transaction_id = customer_payments.id
        AND transaction_type = 'deposit'
        AND cleared = true
    );

  UPDATE supplier_payments
  SET reconciled_at = now()
  WHERE business_id = recon.business_id
    AND account_id = recon.account_id
    AND EXISTS (
      SELECT 1 FROM bank_reconciliation_items
      WHERE reconciliation_id = _recon_id
        AND transaction_id = supplier_payments.id
        AND transaction_type = 'withdrawal'
        AND cleared = true
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_attachment(
  _biz uuid,
  _record_type text,
  _record_id uuid,
  _file_name text,
  _file_url text,
  _file_size bigint,
  _mime_type text,
  _note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  attachment_id uuid;
BEGIN
  INSERT INTO attachments (
    business_id, record_type, record_id, file_name, file_url,
    file_size, mime_type, uploaded_by, note
  ) VALUES (
    _biz, _record_type, _record_id, _file_name, _file_url,
    _file_size, _mime_type, auth.uid(), _note
  )
  RETURNING id INTO attachment_id;

  RETURN attachment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_attachments_for_record(
  _biz uuid,
  _record_type text,
  _record_id uuid
)
RETURNS TABLE (
  id uuid,
  file_name text,
  file_url text,
  file_size bigint,
  mime_type text,
  uploaded_by uuid,
  uploaded_by_name text,
  created_at timestamptz,
  note text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id,
    a.file_name,
    a.file_url,
    a.file_size,
    a.mime_type,
    a.uploaded_by,
    u.raw_user_meta_data->>'full_name' as uploaded_by_name,
    a.created_at,
    a.note
  FROM attachments a
  LEFT JOIN auth.users u ON u.id = a.uploaded_by
  WHERE a.business_id = _biz
    AND a.record_type = _record_type
    AND a.record_id = _record_id
  ORDER BY a.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_attachment(
  _biz uuid,
  _attachment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM attachments
  WHERE id = _attachment_id AND business_id = _biz;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_import_job(
  _biz uuid,
  _import_type text,
  _file_name text,
  _file_url text,
  _total_records integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  job_id uuid;
BEGIN
  INSERT INTO import_jobs (
    business_id, import_type, file_name, file_url, total_records, status
  ) VALUES (
    _biz, _import_type, _file_name, _file_url, _total_records, 'pending'
  )
  RETURNING id INTO job_id;

  RETURN job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_import_job(
  _job_id uuid,
  _success_records integer,
  _failed_records integer,
  _errors text[],
  _status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE import_jobs
  SET 
    success_records = success_records + _success_records,
    failed_records = failed_records + _failed_records,
    errors = COALESCE(errors, '{}') || _errors,
    status = _status,
    processed_at = now()
  WHERE id = _job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_dealer_credit_limit(
  _biz uuid,
  _customer_id uuid,
  _sale_amount numeric
)
RETURNS TABLE (
  can_sale boolean,
  current_due numeric,
  credit_limit numeric,
  available_credit numeric,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_due numeric;
  credit_limit numeric;
  available_credit numeric;
BEGIN
  SELECT COALESCE(current_due, 0), COALESCE(credit_limit, 0)
  INTO current_due, credit_limit
  FROM dealer_credit
  WHERE business_id = _biz AND customer_id = _customer_id;

  available_credit := credit_limit - current_due;

  RETURN QUERY
  SELECT 
    available_credit >= _sale_amount,
    current_due,
    credit_limit,
    available_credit,
    CASE 
      WHEN credit_limit = 0 THEN 'No credit limit set'
      WHEN available_credit < _sale_amount THEN 
        'Credit limit exceeded. Available: ' || available_credit || ', Required: ' || _sale_amount
      ELSE 'OK'
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_salesman_commission_summary(
  _biz uuid,
  _salesman_id uuid,
  _from_date date,
  _to_date date
)
RETURNS TABLE (
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
  RETURN QUERY
  SELECT 
    s.id as salesman_id,
    s.name as salesman_name,
    COALESCE(SUM(ct.amount), 0) as total_commission,
    COALESCE(SUM(ct.paid_amount), 0) as paid_commission,
    COALESCE(SUM(ct.pending_amount), 0) as pending_commission,
    COUNT(ct.id)::integer as transaction_count
  FROM salesmen s
  LEFT JOIN commission_transactions ct ON ct.salesman_id = s.id 
    AND ct.business_id = _biz 
    AND ct.created_at::date BETWEEN _from_date AND _to_date
  WHERE s.business_id = _biz 
    AND s.id = COALESCE(_salesman_id, s.id)
  GROUP BY s.id, s.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_bank_reconciliation_summary(
  _biz uuid,
  _account_id uuid,
  _from_date date,
  _to_date date
)
RETURNS TABLE (
  recon_id uuid,
  account_id uuid,
  reconciliation_date date,
  statement_balance numeric,
  book_balance numeric,
  difference numeric,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    r.id as recon_id,
    r.account_id,
    r.reconciliation_date,
    r.statement_balance,
    r.book_balance,
    r.difference,
    r.status,
    r.created_at
  FROM bank_reconciliations r
  WHERE r.business_id = _biz
    AND r.account_id = COALESCE(_account_id, r.account_id)
    AND r.reconciliation_date BETWEEN _from_date AND _to_date
  ORDER BY r.reconciliation_date DESC;
END;
$$;

COMMENT ON FUNCTION public.update_dealer_credit_on_sale IS 'Update dealer credit when a sale is created';
COMMENT ON FUNCTION public.update_dealer_credit_on_payment IS 'Update dealer credit when a payment is received';
COMMENT ON FUNCTION public.calculate_commission_for_sale IS 'Calculate commission for a sale';
COMMENT ON FUNCTION public.calculate_product_commission IS 'Calculate commission based on product rules';
COMMENT ON FUNCTION public.pay_salesman_commission IS 'Pay salesman commission';
COMMENT ON FUNCTION public.start_bank_reconciliation IS 'Start bank reconciliation process';
COMMENT ON FUNCTION public.mark_reconciliation_item_cleared IS 'Mark a reconciliation item as cleared';
COMMENT ON FUNCTION public.complete_bank_reconciliation IS 'Complete bank reconciliation';
COMMENT ON FUNCTION public.create_attachment IS 'Create an attachment record';
COMMENT ON FUNCTION public.get_attachments_for_record IS 'Get attachments for a record';
COMMENT ON FUNCTION public.delete_attachment IS 'Delete an attachment';
COMMENT ON FUNCTION public.create_import_job IS 'Create an import job';
COMMENT ON FUNCTION public.update_import_job IS 'Update import job progress';
COMMENT ON FUNCTION public.check_dealer_credit_limit IS 'Check dealer credit limit before sale';
COMMENT ON FUNCTION public.get_salesman_commission_summary IS 'Get salesman commission summary';
COMMENT ON FUNCTION public.get_bank_reconciliation_summary IS 'Get bank reconciliation summary';