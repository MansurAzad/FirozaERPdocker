-- 0039_po.sql
-- Module 6: Purchase Order / Supplier Requisition (SR).
--
-- A purchase order is what we ask a supplier to send. Receiving it updates
-- public.stock and public.stock_movements per branch, but the actual supplier
-- invoice / due posting still happens through the normal purchase flow, so
-- there is a single accounting source of truth.
--
-- Contents:
--   * public.purchase_orders
--   * public.purchase_order_items
--   * tenant-scoped RLS + audit triggers
--   * save_purchase_order()    create / edit + recompute totals
--   * update_po_status()       draft <-> approved / cancelled
--   * receive_po_items()       receive lines into stock

-- ---------------------------------------------------------------------------
-- 0) Reconcile with an earlier schema draft
-- ---------------------------------------------------------------------------
-- Drop earlier-draft tables only while they are still empty so this migration
-- recreates the layout the app expects (po_date, totals, line pricing, ...);
-- refuse rather than corrupt when they hold data.
DO $$
DECLARE
  t text;
  has_rows boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_order_items', 'purchase_orders'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I)', t) INTO has_rows;
      IF has_rows THEN
        RAISE EXCEPTION
          'public.% already exists with an older layout and contains data; back it up and migrate it manually, then re-run this migration.',
          t;
      END IF;
      EXECUTE format('DROP TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

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
      AND p.proname IN ('save_purchase_order', 'update_po_status', 'receive_po_items')
  LOOP
    EXECUTE format('DROP FUNCTION public.%I(%s)', r.proname, pg_get_function_identity_arguments(r.oid));
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT,
  po_no text NOT NULL,
  po_date date NOT NULL DEFAULT current_date,
  expected_date date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'partially_received', 'received', 'cancelled')),
  subtotal numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  terms text,
  created_by uuid DEFAULT auth.uid(),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, po_no)
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_business
  ON public.purchase_orders(business_id, po_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON public.purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status
  ON public.purchase_orders(business_id, status);

CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  qty integer NOT NULL CHECK (qty > 0),
  received_qty integer NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  price numeric(14,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  line_total numeric(14,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po
  ON public.purchase_order_items(po_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_variant
  ON public.purchase_order_items(variant_id);

-- ---------------------------------------------------------------------------
-- 2) Audit triggers
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_purchase_orders') THEN
    CREATE TRIGGER audit_purchase_orders
      AFTER INSERT OR UPDATE OR DELETE ON public.purchase_orders
      FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_purchase_order_items') THEN
    CREATE TRIGGER audit_purchase_order_items
      AFTER INSERT OR UPDATE OR DELETE ON public.purchase_order_items
      FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Row level security
-- ---------------------------------------------------------------------------
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_orders_select ON public.purchase_orders;
CREATE POLICY purchase_orders_select ON public.purchase_orders
  FOR SELECT TO authenticated
  USING (public.is_member(business_id));

DROP POLICY IF EXISTS purchase_orders_write ON public.purchase_orders;
CREATE POLICY purchase_orders_write ON public.purchase_orders
  FOR ALL TO authenticated
  USING (public.has_biz_role(
    business_id,
    ARRAY['owner','manager','accountant','purchase_officer','store_keeper']::public.member_role[]
  ))
  WITH CHECK (public.has_biz_role(
    business_id,
    ARRAY['owner','manager','accountant','purchase_officer','store_keeper']::public.member_role[]
  ));

ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_order_items_select ON public.purchase_order_items;
CREATE POLICY purchase_order_items_select ON public.purchase_order_items
  FOR SELECT TO authenticated
  USING (public.is_member(business_id));

DROP POLICY IF EXISTS purchase_order_items_write ON public.purchase_order_items;
CREATE POLICY purchase_order_items_write ON public.purchase_order_items
  FOR ALL TO authenticated
  USING (public.has_biz_role(
    business_id,
    ARRAY['owner','manager','accountant','purchase_officer','store_keeper']::public.member_role[]
  ))
  WITH CHECK (public.has_biz_role(
    business_id,
    ARRAY['owner','manager','accountant','purchase_officer','store_keeper']::public.member_role[]
  ));

-- ---------------------------------------------------------------------------
-- 4) save_purchase_order()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_purchase_order(
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
  v_branch uuid := NULLIF(_data->>'branch_id', '')::uuid;
  v_supplier uuid := NULLIF(_data->>'supplier_id', '')::uuid;
  v_date date := COALESCE((_data->>'po_date')::date, current_date);
  v_expected date := NULLIF(_data->>'expected_date', '')::date;
  v_notes text := NULLIF(_data->>'notes', '');
  v_terms text := NULLIF(_data->>'terms', '');
  v_hdisc numeric(14,2) := COALESCE((_data->>'discount')::numeric, 0);
  v_tax numeric(14,2) := COALESCE((_data->>'tax')::numeric, 0);
  v_sub numeric(14,2) := 0;
  v_ldisc numeric(14,2) := 0;
  v_total numeric(14,2);
  v_seq int;
  v_no text;
  v_status text;
  it jsonb;
  v_var uuid;
  v_qty int;
  v_price numeric(14,2);
  v_disc numeric(14,2);
  v_line numeric(14,2);
  v_count int := 0;
BEGIN
  IF NOT public.has_biz_role(
    _biz,
    ARRAY['owner','manager','accountant','purchase_officer','store_keeper']::public.member_role[]
  ) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;
  IF v_branch IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches
    WHERE id = v_branch AND business_id = _biz AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Choose a valid branch.';
  END IF;
  IF v_supplier IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.suppliers WHERE id = v_supplier AND business_id = _biz
  ) THEN
    RAISE EXCEPTION 'Choose a valid supplier.';
  END IF;
  IF v_hdisc < 0 OR v_tax < 0 THEN
    RAISE EXCEPTION 'Amounts cannot be negative.';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(_data->'items', '[]'::jsonb)) LOOP
    v_var := NULLIF(it->>'variant_id', '')::uuid;
    v_qty := COALESCE((it->>'qty')::int, 0);
    v_price := COALESCE((it->>'price')::numeric, 0);
    v_disc := COALESCE((it->>'discount')::numeric, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantity must be at least 1.';
    END IF;
    IF v_price < 0 OR v_disc < 0 THEN
      RAISE EXCEPTION 'Amounts cannot be negative.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.product_variants WHERE id = v_var AND business_id = _biz
    ) THEN
      RAISE EXCEPTION 'Invalid product.';
    END IF;
    v_line := round(v_qty * v_price, 2);
    IF v_disc > v_line THEN
      RAISE EXCEPTION 'Line discount cannot exceed the line amount.';
    END IF;
    v_sub := v_sub + v_line;
    v_ldisc := v_ldisc + v_disc;
    v_count := v_count + 1;
  END LOOP;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Add at least one product.';
  END IF;

  v_total := v_sub - (v_ldisc + v_hdisc) + v_tax;
  IF v_total < 0 THEN
    RAISE EXCEPTION 'Discount is larger than the total.';
  END IF;

  IF v_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('po_no_' || _biz::text));
    SELECT COALESCE(MAX(NULLIF(regexp_replace(po_no, '\D', '', 'g'), '')::int), 0) + 1
      INTO v_seq
    FROM public.purchase_orders
    WHERE business_id = _biz;
    v_no := 'PO-' || lpad(v_seq::text, 6, '0');

    INSERT INTO public.purchase_orders (
      business_id, branch_id, supplier_id, po_no, po_date, expected_date,
      subtotal, discount, tax, total, notes, terms, status
    ) VALUES (
      _biz, v_branch, v_supplier, v_no, v_date, v_expected,
      v_sub, v_ldisc + v_hdisc, v_tax, v_total, v_notes, v_terms, 'draft'
    )
    RETURNING id INTO v_id;
  ELSE
    SELECT status INTO v_status
    FROM public.purchase_orders
    WHERE id = v_id AND business_id = _biz
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Purchase order not found.';
    END IF;
    IF v_status NOT IN ('draft', 'approved') THEN
      RAISE EXCEPTION 'Only a draft or approved purchase order can be edited.';
    END IF;

    UPDATE public.purchase_orders SET
      branch_id = v_branch,
      supplier_id = v_supplier,
      po_date = v_date,
      expected_date = v_expected,
      subtotal = v_sub,
      discount = v_ldisc + v_hdisc,
      tax = v_tax,
      total = v_total,
      notes = v_notes,
      terms = v_terms,
      updated_at = now()
    WHERE id = v_id AND business_id = _biz;

    DELETE FROM public.purchase_order_items WHERE po_id = v_id;
  END IF;

  FOR it IN
    SELECT t.item, t.ord
    FROM jsonb_array_elements(_data->'items') WITH ORDINALITY AS t(item, ord)
    ORDER BY t.ord
  LOOP
    v_var := (it->>'variant_id')::uuid;
    v_qty := (it->>'qty')::int;
    v_price := (it->>'price')::numeric;
    v_disc := COALESCE((it->>'discount')::numeric, 0);
    INSERT INTO public.purchase_order_items (
      business_id, po_id, variant_id, qty, received_qty, price, discount, line_total, sort_order
    ) VALUES (
      _biz, v_id, v_var, v_qty, 0, v_price, v_disc, round(v_qty * v_price, 2) - v_disc,
      (it->>'ord')::int - 1
    );
  END LOOP;

  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 5) update_po_status()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_po_status(_biz uuid, _id uuid, _status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur text;
BEGIN
  IF NOT public.has_biz_role(
    _biz,
    ARRAY['owner','manager','accountant','purchase_officer','store_keeper']::public.member_role[]
  ) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;
  IF _status NOT IN ('draft', 'approved', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid status.';
  END IF;

  SELECT status INTO v_cur
  FROM public.purchase_orders
  WHERE id = _id AND business_id = _biz
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found.';
  END IF;
  IF v_cur IN ('received', 'partially_received') THEN
    RAISE EXCEPTION 'A received purchase order cannot change status.';
  END IF;

  UPDATE public.purchase_orders SET
    status = _status,
    approved_by = CASE WHEN _status = 'approved' THEN auth.uid() ELSE approved_by END,
    approved_at = CASE WHEN _status = 'approved' THEN now() ELSE approved_at END,
    updated_at = now()
  WHERE id = _id AND business_id = _biz;
END $$;

-- ---------------------------------------------------------------------------
-- 6) receive_po_items(): increase stock for received lines
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_po_items(_biz uuid, _id uuid, _data jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_branch uuid;
  v_remaining int;
  it jsonb;
  v_var uuid;
  v_qty int;
  v_price numeric(14,2);
  v_left int;
BEGIN
  IF NOT public.has_biz_role(
    _biz,
    ARRAY['owner','manager','accountant','purchase_officer','store_keeper']::public.member_role[]
  ) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;

  SELECT status, branch_id INTO v_status, v_branch
  FROM public.purchase_orders
  WHERE id = _id AND business_id = _biz
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found.';
  END IF;
  IF v_status NOT IN ('draft', 'approved', 'partially_received') THEN
    RAISE EXCEPTION 'This purchase order cannot receive stock.';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(_data->'items', '[]'::jsonb)) LOOP
    v_var := NULLIF(it->>'variant_id', '')::uuid;
    v_qty := COALESCE((it->>'qty')::int, 0);
    IF v_qty <= 0 THEN
      CONTINUE;
    END IF;

    SELECT (qty - received_qty), price INTO v_left, v_price
    FROM public.purchase_order_items
    WHERE po_id = _id AND business_id = _biz AND variant_id = v_var
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'This product is not on the purchase order.';
    END IF;
    IF v_qty > v_left THEN
      RAISE EXCEPTION 'Received quantity is more than the remaining ordered quantity.';
    END IF;

    INSERT INTO public.stock (business_id, branch_id, variant_id, qty, avg_cost)
    VALUES (_biz, v_branch, v_var, v_qty, v_price)
    ON CONFLICT (branch_id, variant_id) DO UPDATE SET
      qty = public.stock.qty + EXCLUDED.qty,
      avg_cost = CASE WHEN public.stock.avg_cost = 0 THEN EXCLUDED.avg_cost ELSE public.stock.avg_cost END,
      updated_at = now();

    INSERT INTO public.stock_movements (
      business_id, branch_id, variant_id, qty_change, unit_cost, ref_type, ref_id
    ) VALUES (
      _biz, v_branch, v_var, v_qty, v_price, 'purchase_order', _id
    );

    UPDATE public.purchase_order_items
    SET received_qty = received_qty + v_qty
    WHERE po_id = _id AND business_id = _biz AND variant_id = v_var;
  END LOOP;

  SELECT COALESCE(SUM(qty - received_qty), 0) INTO v_remaining
  FROM public.purchase_order_items
  WHERE po_id = _id AND business_id = _biz;

  UPDATE public.purchase_orders
  SET status = CASE WHEN v_remaining <= 0 THEN 'received' ELSE 'partially_received' END,
      updated_at = now()
  WHERE id = _id AND business_id = _biz;
END $$;

-- ---------------------------------------------------------------------------
-- 7) Privileges
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders TO authenticated;
GRANT ALL ON public.purchase_orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_order_items TO authenticated;
GRANT ALL ON public.purchase_order_items TO service_role;

REVOKE ALL ON FUNCTION public.save_purchase_order(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_purchase_order(uuid, uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.update_po_status(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_po_status(uuid, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.receive_po_items(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receive_po_items(uuid, uuid, jsonb) TO authenticated;

COMMENT ON TABLE public.purchase_orders IS
  'Purchase orders / supplier requisitions; receiving updates stock, the invoice is posted separately.';
COMMENT ON TABLE public.purchase_order_items IS 'Lines of a purchase order with ordered vs received quantity.';
COMMENT ON FUNCTION public.save_purchase_order(uuid, uuid, jsonb) IS
  'Create (_id null) or replace a purchase order and its lines; server computes totals.';
COMMENT ON FUNCTION public.update_po_status(uuid, uuid, text) IS
  'Move a purchase order between draft / approved / cancelled.';
COMMENT ON FUNCTION public.receive_po_items(uuid, uuid, jsonb) IS
  'Receive purchase-order lines into public.stock and public.stock_movements atomically.';
