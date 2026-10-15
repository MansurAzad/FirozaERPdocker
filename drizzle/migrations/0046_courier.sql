-- 0046_courier.sql
-- Module: Courier / delivery board.
--
-- The delivery fields already live on public.orders (courier_name, tracking_no,
-- delivery_date, delivery_city, delivery_address, delivery_note). This adds one
-- atomic RPC so a delivery update -- courier, tracking, date and status -- is
-- validated and written together instead of as several racing table writes.

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
      AND p.proname IN ('set_order_delivery')
  LOOP
    EXECUTE format('DROP FUNCTION public.%I(%s)', r.proname, pg_get_function_identity_arguments(r.oid));
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.set_order_delivery(_biz uuid, _id uuid, _data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur text;
  v_status text := NULLIF(_data->>'status', '');
  v_courier text := NULLIF(_data->>'courier_name', '');
  v_track text := NULLIF(_data->>'tracking_no', '');
  v_date date := NULLIF(_data->>'delivery_date', '')::date;
BEGIN
  IF NOT public.has_biz_role(
    _biz,
    ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]
  ) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;

  SELECT status INTO v_cur
  FROM public.orders
  WHERE id = _id AND business_id = _biz
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.';
  END IF;
  IF v_cur IN ('converted', 'cancelled') THEN
    RAISE EXCEPTION 'A converted or cancelled order cannot be dispatched.';
  END IF;

  IF v_status IS NOT NULL
     AND v_status NOT IN ('confirmed','ready_for_delivery','out_for_delivery','delivered') THEN
    RAISE EXCEPTION 'Invalid delivery status.';
  END IF;

  -- Delivering without an explicit date means "today".
  IF v_status = 'delivered' AND v_date IS NULL THEN
    v_date := current_date;
  END IF;

  UPDATE public.orders
  SET courier_name = v_courier,
      tracking_no = v_track,
      status = COALESCE(v_status, status),
      delivery_date = COALESCE(v_date, delivery_date),
      updated_at = now()
  WHERE id = _id AND business_id = _biz;
END $$;

REVOKE ALL ON FUNCTION public.set_order_delivery(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_order_delivery(uuid, uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.set_order_delivery(uuid, uuid, jsonb) IS
  'Update an order''s courier, tracking number, delivery date and delivery status atomically.';
