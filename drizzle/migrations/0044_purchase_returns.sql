-- 0044_purchase_returns.sql
-- Module 11: Purchase return list.
--
-- A purchase return sends goods back to a supplier. Saving builds the
-- document; posting decreases stock atomically (per branch) and writes
-- stock_movements. Because a return is only posted once, the movements with
-- ref_type='purchase_return' double as the "is posted" marker.

-- Drop earlier-draft versions of these functions (CREATE OR REPLACE cannot
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
      AND p.proname IN ('save_purchase_return', 'post_purchase_return')
  LOOP
    EXECUTE format('DROP FUNCTION public.%I(%s)', r.proname, pg_get_function_identity_arguments(r.oid));
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE RESTRICT,
  return_no text NOT NULL,
  return_date date NOT NULL DEFAULT current_date,
  reason text,
  refund numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, return_no)
);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_business
  ON public.purchase_returns(business_id, return_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier ON public.purchase_returns(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_purchase ON public.purchase_returns(purchase_id);

CREATE TABLE IF NOT EXISTS public.purchase_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  return_id uuid NOT NULL REFERENCES public.purchase_returns(id) ON DELETE CASCADE,
  purchase_item_id uuid NOT NULL REFERENCES public.purchase_items(id) ON DELETE RESTRICT,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  imei_id uuid REFERENCES public.product_imeis(id) ON DELETE SET NULL,
  qty integer NOT NULL CHECK (qty > 0),
  unit_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0)
);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_return ON public.purchase_return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_purchase_item
  ON public.purchase_return_items(purchase_item_id);

-- ---------------------------------------------------------------------------
-- 2) Audit triggers
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_purchase_returns') THEN
    CREATE TRIGGER audit_purchase_returns
      AFTER INSERT OR UPDATE OR DELETE ON public.purchase_returns
      FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_purchase_return_items') THEN
    CREATE TRIGGER audit_purchase_return_items
      AFTER INSERT OR UPDATE OR DELETE ON public.purchase_return_items
      FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Row level security
-- ---------------------------------------------------------------------------
ALTER TABLE public.purchase_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_returns_select ON public.purchase_returns;
CREATE POLICY purchase_returns_select ON public.purchase_returns
  FOR SELECT TO authenticated
  USING (public.is_member(business_id));

DROP POLICY IF EXISTS purchase_returns_write ON public.purchase_returns;
CREATE POLICY purchase_returns_write ON public.purchase_returns
  FOR ALL TO authenticated
  USING (public.has_biz_role(
    business_id,
    ARRAY['owner','manager','accountant','store_keeper']::public.member_role[]
  ))
  WITH CHECK (public.has_biz_role(
    business_id,
    ARRAY['owner','manager','accountant','store_keeper']::public.member_role[]
  ));

ALTER TABLE public.purchase_return_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_return_items_select ON public.purchase_return_items;
CREATE POLICY purchase_return_items_select ON public.purchase_return_items
  FOR SELECT TO authenticated
  USING (public.is_member(business_id));

DROP POLICY IF EXISTS purchase_return_items_write ON public.purchase_return_items;
CREATE POLICY purchase_return_items_write ON public.purchase_return_items
  FOR ALL TO authenticated
  USING (public.has_biz_role(
    business_id,
    ARRAY['owner','manager','accountant','store_keeper']::public.member_role[]
  ))
  WITH CHECK (public.has_biz_role(
    business_id,
    ARRAY['owner','manager','accountant','store_keeper']::public.member_role[]
  ));

-- ---------------------------------------------------------------------------
-- 4) save_purchase_return()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_purchase_return(
  _biz uuid,
  _id uuid DEFAULT NULL,
  _data jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := _id;
  v_purchase uuid := NULLIF(_data->>'purchase_id', '')::uuid;
  v_date date := COALESCE((_data->>'return_date')::date, current_date);
  v_reason text := NULLIF(_data->>'reason', '');
  v_branch uuid;
  v_supplier uuid;
  v_refund numeric(14,2) := COALESCE((_data->>'refund')::numeric, 0);
  v_seq int;
  v_no text;
  v_total numeric(14,2) := 0;
  v_count int := 0;
  v_posted boolean;
  it jsonb;
  v_pitem uuid;
  v_var uuid;
  v_qty int;
  v_cost numeric(14,2);
  v_ordered int;
  v_already int;
BEGIN
  IF NOT public.has_biz_role(
    _biz,
    ARRAY['owner','manager','accountant','store_keeper']::public.member_role[]
  ) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;

  SELECT branch_id, supplier_id INTO v_branch, v_supplier
  FROM public.purchases
  WHERE id = v_purchase AND business_id = _biz;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose a valid purchase.';
  END IF;
  IF v_refund < 0 THEN
    RAISE EXCEPTION 'Refund cannot be negative.';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(_data->'items', '[]'::jsonb)) LOOP
    v_pitem := NULLIF(it->>'purchase_item_id', '')::uuid;
    v_var := NULLIF(it->>'variant_id', '')::uuid;
    v_qty := COALESCE((it->>'qty')::int, 0);
    v_cost := COALESCE((it->>'unit_cost')::numeric, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Return quantity must be at least 1.';
    END IF;
    IF v_cost < 0 THEN
      RAISE EXCEPTION 'Unit cost cannot be negative.';
    END IF;
    SELECT qty INTO v_ordered
    FROM public.purchase_items
    WHERE id = v_pitem AND business_id = _biz AND purchase_id = v_purchase;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A line does not belong to this purchase.';
    END IF;
    IF v_var IS DISTINCT FROM (
      SELECT variant_id FROM public.purchase_items WHERE id = v_pitem
    ) THEN
      RAISE EXCEPTION 'A line product does not match the purchase line.';
    END IF;
    -- Already returned for this line across all returns of the purchase.
    SELECT COALESCE(SUM(pri.qty), 0) INTO v_already
    FROM public.purchase_return_items pri
    JOIN public.purchase_returns pr ON pr.id = pri.return_id
    WHERE pri.purchase_item_id = v_pitem
      AND pr.purchase_id = v_purchase
      AND (_id IS NULL OR pr.id <> _id);
    IF v_already + v_qty > v_ordered THEN
      RAISE EXCEPTION 'Return quantity is more than what was purchased.';
    END IF;
    v_total := v_total + round(v_qty * v_cost, 2);
    v_count := v_count + 1;
  END LOOP;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Add at least one line to return.';
  END IF;

  IF v_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('pr_no_' || _biz::text));
    SELECT COALESCE(MAX(NULLIF(regexp_replace(return_no, '\D', '', 'g'), '')::int), 0) + 1
      INTO v_seq
    FROM public.purchase_returns
    WHERE business_id = _biz;
    v_no := 'PR-' || lpad(v_seq::text, 6, '0');

    INSERT INTO public.purchase_returns (
      business_id, branch_id, supplier_id, purchase_id, return_no, return_date,
      reason, refund, total
    ) VALUES (
      _biz, v_branch, v_supplier, v_purchase, v_no, v_date, v_reason, v_refund, round(v_total, 2)
    )
    RETURNING id INTO v_id;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.stock_movements
      WHERE ref_type = 'purchase_return' AND ref_id = v_id
    ) INTO v_posted;
    IF v_posted THEN
      RAISE EXCEPTION 'A posted return cannot be edited.';
    END IF;

    UPDATE public.purchase_returns SET
      branch_id = v_branch,
      supplier_id = v_supplier,
      purchase_id = v_purchase,
      return_date = v_date,
      reason = v_reason,
      refund = v_refund,
      total = round(v_total, 2)
    WHERE id = v_id AND business_id = _biz;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Return not found.';
    END IF;

    DELETE FROM public.purchase_return_items WHERE return_id = v_id;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(_data->'items') LOOP
    v_pitem := (it->>'purchase_item_id')::uuid;
    v_var := (it->>'variant_id')::uuid;
    v_qty := (it->>'qty')::int;
    v_cost := COALESCE((it->>'unit_cost')::numeric, 0);
    INSERT INTO public.purchase_return_items (
      business_id, return_id, purchase_item_id, variant_id, imei_id, qty, unit_cost
    ) VALUES (
      _biz, v_id, v_pitem, v_var, NULLIF(it->>'imei_id', '')::uuid, v_qty, v_cost
    );
  END LOOP;

  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 5) post_purchase_return(): decrease stock + movements (once only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_purchase_return(_biz uuid, _id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid;
  v_purchase uuid;
  v_total numeric(14,2);
  v_cur int;
  r record;
BEGIN
  IF NOT public.has_biz_role(
    _biz,
    ARRAY['owner','manager','accountant','store_keeper']::public.member_role[]
  ) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;

  SELECT branch_id, purchase_id, total INTO v_branch, v_purchase, v_total
  FROM public.purchase_returns
  WHERE id = _id AND business_id = _biz
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Return not found.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.stock_movements
    WHERE ref_type = 'purchase_return' AND ref_id = _id
  ) THEN
    RAISE EXCEPTION 'This return has already been posted.';
  END IF;

  FOR r IN
    SELECT variant_id, qty, unit_cost
    FROM public.purchase_return_items
    WHERE return_id = _id AND business_id = _biz
  LOOP
    SELECT qty INTO v_cur
    FROM public.stock
    WHERE branch_id = v_branch AND variant_id = r.variant_id
    FOR UPDATE;
    IF NOT FOUND OR v_cur < r.qty THEN
      RAISE EXCEPTION 'Not enough stock for one of the returned products.';
    END IF;

    UPDATE public.stock
    SET qty = qty - r.qty, updated_at = now()
    WHERE branch_id = v_branch AND variant_id = r.variant_id;

    INSERT INTO public.stock_movements (
      business_id, branch_id, variant_id, qty_change, unit_cost, ref_type, ref_id
    ) VALUES (
      _biz, v_branch, r.variant_id, -r.qty, r.unit_cost, 'purchase_return', _id
    );
  END LOOP;

  UPDATE public.purchases
  SET due = greatest(due - v_total, 0)
  WHERE id = v_purchase AND business_id = _biz;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Privileges
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_returns TO authenticated;
GRANT ALL ON public.purchase_returns TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_return_items TO authenticated;
GRANT ALL ON public.purchase_return_items TO service_role;

REVOKE ALL ON FUNCTION public.save_purchase_return(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_purchase_return(uuid, uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.post_purchase_return(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_purchase_return(uuid, uuid) TO authenticated;

COMMENT ON TABLE public.purchase_returns IS
  'Purchase return headers; stock decreases only when posted.';
COMMENT ON TABLE public.purchase_return_items IS 'Lines of a purchase return.';
COMMENT ON FUNCTION public.save_purchase_return(uuid, uuid, jsonb) IS
  'Create (_id null) or replace an unposted purchase return and its lines.';
COMMENT ON FUNCTION public.post_purchase_return(uuid, uuid) IS
  'Decrease stock and write stock_movements for a purchase return, then reduce supplier due.';
