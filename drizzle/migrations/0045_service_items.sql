-- 0045_service_items.sql
-- Module 4 (completion): service job parts / labour lines and costing.
--
-- 0037 created service_jobs + service_items and the header RPC, but nothing
-- replaced a job's lines or recomputed parts_cost / labor_cost / total_cost /
-- balance. This adds one atomic RPC so a job's costing is always consistent.

-- Drop an earlier-draft version of this function (CREATE OR REPLACE cannot
-- rename input parameters, error 42P13).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('save_service_items')
  LOOP
    EXECUTE format('DROP FUNCTION public.%I(%s)', r.proname, pg_get_function_identity_arguments(r.oid));
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.save_service_items(_biz uuid, _id uuid, _data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_status text;
  v_labor numeric(14,2) := COALESCE((_data->>'labor_cost')::numeric, 0);
  v_advance numeric(14,2) := COALESCE((_data->>'advance')::numeric, 0);
  v_parts numeric(14,2) := 0;
  it jsonb;
  v_qty int;
  v_price numeric(14,2);
BEGIN
  IF NOT public.has_biz_role(
    _biz,
    ARRAY['owner','manager','accountant','store_keeper']::public.member_role[]
  ) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;
  IF v_labor < 0 OR v_advance < 0 THEN
    RAISE EXCEPTION 'Amounts cannot be negative.';
  END IF;

  SELECT status INTO v_status
  FROM public.service_jobs
  WHERE id = _id AND business_id = _biz
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service job not found.';
  END IF;
  IF v_status IN ('completed', 'returned', 'cancelled') THEN
    RAISE EXCEPTION 'A closed job cannot be changed.';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(_data->'items', '[]'::jsonb)) LOOP
    v_qty := COALESCE((it->>'qty')::int, 0);
    v_price := COALESCE((it->>'unit_price')::numeric, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Item quantity must be at least 1.';
    END IF;
    IF v_price < 0 THEN
      RAISE EXCEPTION 'Amounts cannot be negative.';
    END IF;
    v_parts := v_parts + round(v_qty * v_price, 2);
  END LOOP;

  DELETE FROM public.service_items WHERE job_id = _id AND business_id = _biz;

  FOR it IN
    SELECT t.item
    FROM jsonb_array_elements(COALESCE(_data->'items', '[]'::jsonb)) WITH ORDINALITY AS t(item, ord)
    ORDER BY t.ord
  LOOP
    v_qty := (it->>'qty')::int;
    v_price := (it->>'unit_price')::numeric;
    INSERT INTO public.service_items (business_id, job_id, description, qty, unit_price, amount)
    VALUES (
      _biz, _id, COALESCE(NULLIF(it->>'description', ''), 'Item'), v_qty, v_price,
      round(v_qty * v_price, 2)
    );
  END LOOP;

  UPDATE public.service_jobs
  SET parts_cost = round(v_parts, 2),
      labor_cost = round(v_labor, 2),
      total_cost = round(v_parts + v_labor, 2),
      advance = round(v_advance, 2),
      balance = round(v_parts + v_labor - v_advance, 2),
      updated_at = now()
  WHERE id = _id AND business_id = _biz;
END $func$;

REVOKE ALL ON FUNCTION public.save_service_items(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_service_items(uuid, uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.save_service_items(uuid, uuid, jsonb) IS
  'Replace a service job''s parts/charges lines and recompute parts, labour, total and balance atomically.';
