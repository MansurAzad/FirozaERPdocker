CREATE OR REPLACE FUNCTION public._validate_company_data_replace(
  _biz uuid,
  _data jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  t text;
  d jsonb := _data->'tables';
  forbidden_tables text[] := ARRAY[
    'money_transactions','purchases','purchase_items','product_imeis','sales','sale_items',
    'customer_payments','supplier_payments','expenses','sales_returns','sales_return_items',
    'purchase_returns','purchase_return_items','stock_movements','stock_transfers',
    'stock_transfer_items','warranty_claims','daily_closings','guardian_alerts','guardian_runs',
    'commission_rules','salesmen'
  ];
BEGIN
  IF coalesce(_data->>'app', '') <> 'MOBILE D-ERP'
     OR _data->>'legacy_csv_import' IS DISTINCT FROM 'true'
     OR (_data->>'business_id')::uuid IS DISTINCT FROM _biz
     OR jsonb_typeof(d) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid company data replacement payload.';
  END IF;

  FOREACH t IN ARRAY public._biz_tables() LOOP
    IF jsonb_typeof(d->t) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Missing or invalid import table: %.', t;
    END IF;
    IF EXISTS (
      SELECT 1
        FROM jsonb_array_elements(d->t) AS x(value)
       WHERE jsonb_typeof(x.value) IS DISTINCT FROM 'object'
          OR x.value->>'business_id' IS DISTINCT FROM _biz::text
    ) THEN
      RAISE EXCEPTION 'Import table % contains a record outside the selected business.', t;
    END IF;
    IF t = ANY(forbidden_tables) AND jsonb_array_length(d->t) > 0 THEN
      RAISE EXCEPTION 'Historical or unrelated records are not accepted in table %.', t;
    END IF;
    IF EXISTS (
      SELECT 1
        FROM jsonb_array_elements(d->t) AS x(value)
       WHERE x.value::text ILIKE '%legacy%'
    ) THEN
      RAISE EXCEPTION 'Imported records cannot contain retired source labels.';
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_legacy_operational_import(
  _biz uuid,
  _data jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t text;
  d jsonb := _data->'tables';
  v_existing bigint;
  v_incoming bigint;
  v_counts jsonb := '{}'::jsonb;
  v_existing_total bigint := 0;
  v_incoming_total bigint := 0;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner']::public.member_role[]) THEN
    RAISE EXCEPTION 'Only the owner can preview a company data replacement.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._validate_company_data_replace(_biz, _data);

  FOREACH t IN ARRAY public._biz_tables() LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE business_id = $1', t)
      INTO v_existing USING _biz;
    SELECT jsonb_array_length(d->t) INTO v_incoming;
    v_existing_total := v_existing_total + v_existing;
    v_incoming_total := v_incoming_total + v_incoming;
    v_counts := v_counts || jsonb_build_object(
      t,
      jsonb_build_object('existing', v_existing, 'incoming', v_incoming)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'business_id', _biz,
    'replaces_records', v_existing_total,
    'imports_records', v_incoming_total,
    'tables', v_counts
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_business(
  _biz uuid,
  _data jsonb,
  _confirm text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t text;
  d jsonb := _data->'tables';
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner']::public.member_role[]) THEN
    RAISE EXCEPTION 'Only the owner can restore a backup.';
  END IF;
  IF _confirm IS DISTINCT FROM 'RESTORE' THEN
    RAISE EXCEPTION 'Type RESTORE to confirm.';
  END IF;
  PERFORM public._validate_company_data_replace(_biz, _data);

  PERFORM public._wipe_business(_biz, true);
  DELETE FROM public.commission_transactions WHERE business_id = _biz;
  DELETE FROM public.salesmen WHERE business_id = _biz;
  DELETE FROM public.commission_rules WHERE business_id = _biz;
  DELETE FROM public.expense_categories WHERE business_id = _biz;
  DELETE FROM public.accounts WHERE business_id = _biz;
  DELETE FROM public.branches WHERE business_id = _biz;

  FOREACH t IN ARRAY public._biz_tables() LOOP
    IF t = 'product_imeis' THEN
      INSERT INTO public.product_imeis (
        id, business_id, variant_id, imei1, imei2, serial_no, status,
        branch_id, purchase_item_id, cost, created_at, sale_item_id
      )
      SELECT id, business_id, variant_id, imei1, imei2, serial_no, status,
             branch_id, purchase_item_id, cost, created_at, NULL
        FROM jsonb_populate_recordset(NULL::public.product_imeis, coalesce(d->t, '[]'::jsonb))
       WHERE business_id = _biz;
    ELSIF t = 'journal_entries' THEN
      INSERT INTO public.journal_entries (
        id, business_id, entry_date, ref_type, ref_id, memo, created_by, created_at
      )
      SELECT id, business_id, entry_date, ref_type, ref_id, memo, created_by, created_at
        FROM jsonb_populate_recordset(NULL::public.journal_entries, coalesce(d->t, '[]'::jsonb))
       WHERE business_id = _biz;
    ELSIF t = 'journal_lines' THEN
      INSERT INTO public.journal_lines (business_id, entry_id, account_id, debit, credit)
      SELECT business_id, entry_id, account_id, debit, credit
        FROM jsonb_populate_recordset(NULL::public.journal_lines, coalesce(d->t, '[]'::jsonb))
       WHERE business_id = _biz;
    ELSIF t = 'stock_movements' THEN
      INSERT INTO public.stock_movements (
        business_id, branch_id, variant_id, imei_id, qty_change, unit_cost,
        ref_type, ref_id, created_by, created_at
      )
      SELECT business_id, branch_id, variant_id, imei_id, qty_change, unit_cost,
             ref_type, ref_id, created_by, created_at
        FROM jsonb_populate_recordset(NULL::public.stock_movements, coalesce(d->t, '[]'::jsonb))
       WHERE business_id = _biz;
    ELSE
      EXECUTE format(
        'INSERT INTO public.%I OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_recordset(NULL::public.%I, $1) WHERE business_id = $2',
        t,
        t
      )
      USING coalesce(d->t, '[]'::jsonb), _biz;
    END IF;

    IF t = 'sale_items' THEN
      UPDATE public.product_imeis p
         SET sale_item_id = x.sale_item_id
        FROM jsonb_populate_recordset(NULL::public.product_imeis, coalesce(d->'product_imeis', '[]'::jsonb)) x
       WHERE p.id = x.id AND p.business_id = _biz AND x.sale_item_id IS NOT NULL;
    END IF;
  END LOOP;

  IF _data ? 'company' THEN
    UPDATE public.businesses
       SET name = coalesce(_data->'company'->>'name', name),
           phone = _data->'company'->>'phone',
           address = _data->'company'->>'address',
           trade_license = _data->'company'->>'trade_license',
           guardian_profile = coalesce(_data->'company'->'guardian_profile', '{}'::jsonb)
     WHERE id = _biz;
  END IF;

  PERFORM set_config('app.bulk', 'off', true);
  DELETE FROM public.audit_logs
   WHERE business_id = _biz
     AND to_jsonb(audit_logs)::text ILIKE '%legacy%';
  INSERT INTO public.audit_logs (business_id, user_id, module, action, new_value)
  VALUES (
    _biz,
    auth.uid(),
    'backup',
    'company_data_replace',
    jsonb_build_object('exported_at', _data->>'exported_at')
  );
END;
$$;

REVOKE ALL ON FUNCTION public._validate_company_data_replace(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._validate_company_data_replace(uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.restore_business(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_business(uuid, jsonb, text) TO authenticated;
REVOKE ALL ON FUNCTION public.preview_legacy_operational_import(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_legacy_operational_import(uuid, jsonb) TO authenticated;
