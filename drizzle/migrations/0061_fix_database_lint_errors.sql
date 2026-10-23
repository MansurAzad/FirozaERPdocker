DROP TABLE IF EXISTS private._g;
CREATE TABLE IF NOT EXISTS public._g (
  code text,
  sev text,
  title text,
  detail text,
  rtype text,
  rid uuid,
  fp text
);
ALTER TABLE public._g ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._g FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public._g IS
  'Empty schema template for linting public._guardian_run; runtime uses a temporary table.';

DO $$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  SELECT pg_get_functiondef('public._guardian_run(uuid)'::regprocedure)
    INTO v_definition;
  v_updated := replace(v_definition, 'EXECUTE ''DELETE FROM pg_temp._g'';', 'DELETE FROM _g;');
  v_updated := replace(v_updated, 'INSERT INTO pg_temp._g', 'INSERT INTO _g');
  v_updated := replace(v_updated, 'FROM pg_temp._g', 'FROM _g');
  v_updated := replace(
    v_updated,
    'SET search_path TO ''public''',
    'SET search_path TO ''public'''
  );
  v_updated := replace(
    v_updated,
    'SET search_path TO ''public, private''',
    'SET search_path TO ''public'''
  );
  IF position('CREATE TEMP TABLE IF NOT EXISTS _g' IN v_updated) = 0
     OR position('DELETE FROM _g;' IN v_updated) = 0
     OR position('FROM pg_temp._g' IN v_updated) > 0
     OR position('SET search_path TO ''public''' IN v_updated) = 0 THEN
    RAISE EXCEPTION 'Could not configure the Guardian findings table for linting.';
  END IF;
  IF v_updated <> v_definition THEN EXECUTE v_updated; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.add_audit_trigger(_table text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF _table IS NULL OR to_regclass(format('public.%I', _table)) IS NULL THEN
    RAISE EXCEPTION 'Select an existing public table to audit.';
  END IF;

  EXECUTE 'DROP TRIGGER IF EXISTS ' || quote_ident('audit_' || _table)
    || ' ON public.' || quote_ident(_table);
  EXECUTE 'CREATE TRIGGER ' || quote_ident('audit_' || _table)
    || ' AFTER INSERT OR UPDATE OR DELETE ON public.' || quote_ident(_table)
    || ' FOR EACH ROW EXECUTE FUNCTION public.audit_row()';
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
  v_current_due numeric := 0;
  v_credit_limit numeric := 0;
  v_available_credit numeric := 0;
BEGIN
  IF NOT public.is_member(_biz) THEN
    RAISE EXCEPTION 'You do not have access to this business.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(dc.current_due, 0), COALESCE(dc.credit_limit, 0)
    INTO v_current_due, v_credit_limit
    FROM public.dealer_credit dc
   WHERE dc.business_id = _biz AND dc.customer_id = _customer_id;

  v_available_credit := v_credit_limit - v_current_due;
  RETURN QUERY
  SELECT
    v_available_credit >= _sale_amount,
    v_current_due,
    v_credit_limit,
    v_available_credit,
    CASE
      WHEN v_credit_limit = 0 THEN 'No credit limit set'
      WHEN v_available_credit < _sale_amount
        THEN 'Credit limit exceeded. Available: ' || v_available_credit || ', Required: ' || _sale_amount
      ELSE 'OK'
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_backup_schedule(
  _biz uuid,
  _schedule_type text,
  _schedule_time time DEFAULT NULL,
  _schedule_day integer DEFAULT NULL,
  _retention_days integer DEFAULT 30
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  schedule_id uuid;
  v_now timestamptz := statement_timestamp();
  v_next_backup timestamptz;
  v_month_start date;
  v_month_day integer;
  v_day_offset integer;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner', 'manager']::public.member_role[]) THEN
    RAISE EXCEPTION 'You are not authorized for this action.' USING ERRCODE = '42501';
  END IF;
  IF _schedule_type NOT IN ('hourly', 'daily', 'weekly', 'monthly') THEN
    RAISE EXCEPTION 'Invalid backup schedule type.';
  END IF;
  IF _retention_days < 1 THEN
    RAISE EXCEPTION 'Retention must be at least one day.';
  END IF;
  IF _schedule_type <> 'hourly' AND _schedule_time IS NULL THEN
    RAISE EXCEPTION 'Select a backup time.';
  END IF;

  CASE _schedule_type
    WHEN 'hourly' THEN
      v_next_backup := v_now + interval '1 hour';
    WHEN 'daily' THEN
      v_next_backup := (v_now::date + _schedule_time)::timestamptz;
      IF v_next_backup <= v_now THEN
        v_next_backup := v_next_backup + interval '1 day';
      END IF;
    WHEN 'weekly' THEN
      IF _schedule_day IS NULL OR _schedule_day NOT BETWEEN 0 AND 6 THEN
        RAISE EXCEPTION 'Weekly backup day must be between 0 and 6.';
      END IF;
      v_day_offset := (_schedule_day - extract(dow FROM v_now)::integer + 7) % 7;
      v_next_backup := (v_now::date + v_day_offset + _schedule_time)::timestamptz;
      IF v_next_backup <= v_now THEN
        v_next_backup := v_next_backup + interval '7 days';
      END IF;
    WHEN 'monthly' THEN
      IF _schedule_day IS NULL OR _schedule_day NOT BETWEEN 1 AND 31 THEN
        RAISE EXCEPTION 'Monthly backup day must be between 1 and 31.';
      END IF;
      v_month_start := date_trunc('month', v_now)::date;
      v_month_day := LEAST(
        _schedule_day,
        extract(day FROM (v_month_start + interval '1 month - 1 day'))::integer
      );
      v_next_backup := (v_month_start + (v_month_day - 1) + _schedule_time)::timestamptz;
      IF v_next_backup <= v_now THEN
        v_month_start := (v_month_start + interval '1 month')::date;
        v_month_day := LEAST(
          _schedule_day,
          extract(day FROM (v_month_start + interval '1 month - 1 day'))::integer
        );
        v_next_backup := (v_month_start + (v_month_day - 1) + _schedule_time)::timestamptz;
      END IF;
  END CASE;

  INSERT INTO public.backup_schedules (
    business_id, schedule_type, schedule_time, schedule_day,
    is_active, retention_days, next_backup_at
  ) VALUES (
    _biz, _schedule_type, _schedule_time, _schedule_day,
    true, _retention_days, v_next_backup
  )
  ON CONFLICT (business_id, schedule_type)
  DO UPDATE SET
    schedule_time = EXCLUDED.schedule_time,
    schedule_day = EXCLUDED.schedule_day,
    retention_days = EXCLUDED.retention_days,
    is_active = true,
    next_backup_at = EXCLUDED.next_backup_at,
    updated_at = now()
  RETURNING id INTO schedule_id;

  RETURN schedule_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_customer_portal_token(
  _biz uuid,
  _customer_id uuid,
  _expires_in_days integer DEFAULT 30
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  token_value text;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner', 'manager', 'accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'You are not authorized for this action.' USING ERRCODE = '42501';
  END IF;
  token_value := encode(extensions.gen_random_bytes(32), 'base64');
  INSERT INTO public.customer_portal_tokens (
    business_id, customer_id, token, expires_at
  ) VALUES (
    _biz, _customer_id, token_value, now() + (_expires_in_days || ' days')::interval
  );
  RETURN token_value;
END;
$$;

DO $$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  SELECT pg_get_functiondef('public.create_sale(uuid,jsonb)'::regprocedure)
    INTO v_definition;
  v_updated := regexp_replace(
    v_definition,
    'v_cname text;[[:space:]]*v_limit numeric;[[:space:]]*v_ctype customer_type;[[:space:]]*v_level price_level := ''retail'';[[:space:]]*v_curdue numeric;',
    'v_cname text; v_limit numeric; v_level public.price_level := ''retail''::public.price_level; v_curdue numeric;',
    'gi'
  );
  v_updated := regexp_replace(
    v_updated,
    'SELECT name, credit_limit, type, price_level INTO v_cname, v_limit, v_ctype, v_level FROM customers',
    'SELECT name, credit_limit, price_level INTO v_cname, v_limit, v_level FROM public.customers',
    'i'
  );
  IF position('v_ctype' IN v_updated) > 0
     OR position('''retail''::public.price_level' IN v_updated) = 0 THEN
    RAISE EXCEPTION 'Could not correct the customer price-level initialization in create_sale.';
  END IF;
  IF v_updated <> v_definition THEN EXECUTE v_updated; END IF;
END $$;

DO $$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  SELECT pg_get_functiondef(
    'public.save_purchase_order(uuid,uuid,jsonb)'::regprocedure
  ) INTO v_definition;
  v_updated := regexp_replace(
    v_definition,
    '([[:space:]]+)it jsonb;([[:space:]]*)v_var uuid;',
    '\1it jsonb;\1r record;\2v_var uuid;',
    'i'
  );
  v_updated := regexp_replace(
    v_updated,
    'FOR it IN[[:space:]]+SELECT t\.item, t\.ord[[:space:]]+FROM jsonb_array_elements\(_data->''items''\) WITH ORDINALITY AS t\(item, ord\)[[:space:]]+ORDER BY t\.ord[[:space:]]+LOOP',
    'FOR r IN SELECT t.item, t.ord FROM jsonb_array_elements(_data->''items'') WITH ORDINALITY AS t(item, ord) ORDER BY t.ord LOOP',
    'i'
  );
  v_updated := regexp_replace(
    v_updated,
    '(ORDER BY t\.ord[[:space:]]+LOOP[[:space:]]+)v_var := \(it->>''variant_id''\)',
    '\1it := r.item; v_var := (it->>''variant_id'')',
    'i'
  );
  v_updated := replace(v_updated, '(it->>''ord'')::int - 1', 'r.ord::int - 1');
  IF position('r record;' IN v_updated) = 0
     OR position('FOR R IN SELECT T.ITEM, T.ORD' IN upper(v_updated)) = 0
     OR position('it := r.item;' IN v_updated) = 0
     OR position('r.ord::int - 1' IN v_updated) = 0 THEN
    RAISE EXCEPTION 'Could not preserve purchase order item ordinality.';
  END IF;
  IF v_updated <> v_definition THEN EXECUTE v_updated; END IF;
END $$;

DO $$
DECLARE
  v_definition text;
  v_updated text;
BEGIN
  SELECT pg_get_functiondef(
    'public.add_order_payment(uuid,uuid,numeric,text,text,text,date)'::regprocedure
  ) INTO v_definition;
  v_updated := regexp_replace(
    v_definition,
    'SELECT[[:space:]]+total[[:space:]]*,[[:space:]]*status[[:space:]]*,[[:space:]]*balance[[:space:]]+INTO[[:space:]]+v_total[[:space:]]*,[[:space:]]*v_cur[[:space:]]+FROM[[:space:]]+public\.orders',
    'SELECT total, status INTO v_total, v_cur FROM public.orders',
    'i'
  );
  IF position('SELECT TOTAL, STATUS, BALANCE INTO V_TOTAL, V_CUR' IN upper(v_updated)) > 0 THEN
    RAISE EXCEPTION 'Could not correct the order payment select target list.';
  END IF;
  IF v_updated <> v_definition THEN EXECUTE v_updated; END IF;
END $$;

DO $$
DECLARE
  v_name text;
  v_definition text;
  v_updated text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'export_business',
    'preview_legacy_operational_import',
    'restore_business'
  ]::text[] LOOP
    CASE v_name
      WHEN 'export_business' THEN
        v_definition := pg_get_functiondef('public.export_business(uuid)'::regprocedure);
      WHEN 'preview_legacy_operational_import' THEN
        v_definition := pg_get_functiondef(
          'public.preview_legacy_operational_import(uuid,jsonb)'::regprocedure
        );
      WHEN 'restore_business' THEN
        v_definition := pg_get_functiondef(
          'public.restore_business(uuid,jsonb,text)'::regprocedure
        );
    END CASE;

    v_updated := replace(
      v_definition,
      'foreach t in array _biz_tables() loop',
      'for t in select unnest(_biz_tables()) loop'
    );
    v_updated := replace(
      v_updated,
      'FOREACH t IN ARRAY _biz_tables() LOOP',
      'FOR t IN SELECT unnest(_biz_tables()) LOOP'
    );
    v_updated := replace(
      v_updated,
      'FOREACH t IN ARRAY public._biz_tables() LOOP',
      'FOR t IN SELECT unnest(public._biz_tables()) LOOP'
    );
    IF v_updated = v_definition
       AND position('FOR T IN SELECT UNNEST(' IN upper(v_definition)) = 0 THEN
      RAISE EXCEPTION 'Could not update the table loop in public.%().', v_name;
    END IF;
    IF v_updated <> v_definition THEN
      EXECUTE v_updated;
    END IF;
  END LOOP;
END $$;
