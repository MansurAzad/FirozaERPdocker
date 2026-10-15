-- 0038_stock_adjustment.sql
-- Module 5: Stock Adjustment + Physical Count.
--
-- A stock adjustment records the difference between the book quantity and the
-- physically counted quantity (or a manual increase/decrease). Nothing moves
-- until the document is posted; posting writes public.stock and
-- public.stock_movements atomically so one branch's stock stays the source of
-- truth.
--
-- Contents:
--   * public.stock_adjustments       (header)
--   * public.stock_adjustment_items  (lines)
--   * tenant-scoped RLS + audit triggers
--   * save_stock_adjustment()   create / edit a draft document + its lines
--   * post_stock_adjustment()   apply the difference to stock + movements

-- ---------------------------------------------------------------------------
-- 0) Reconcile with an earlier schema draft
-- ---------------------------------------------------------------------------
-- These tables may already exist from an earlier draft with a different column
-- layout; CREATE TABLE IF NOT EXISTS would then silently keep the old shape and
-- the statements below would fail (e.g. missing adj_date). Drop them when they
-- are still empty so this migration recreates the layout the app expects, and
-- refuse (instead of corrupting) when they hold data.
DO $$
DECLARE
  t text;
  has_rows boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_adjustment_items', 'stock_adjustments'] LOOP
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

-- Drop earlier-draft versions of these functions. CREATE OR REPLACE cannot
-- rename input parameters (error 42P13), so an existing function with the same
-- signature but different parameter names must be dropped first. Dropping by
-- name removes every overload.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('save_stock_adjustment', 'post_stock_adjustment')
  LOOP
    EXECUTE format('DROP FUNCTION public.%I(%s)', r.proname, pg_get_function_identity_arguments(r.oid));
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  adj_no text NOT NULL,
  adj_type text NOT NULL DEFAULT 'recount'
    CHECK (adj_type IN ('increase', 'decrease', 'recount')),
  adj_date date NOT NULL DEFAULT current_date,
  reason text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'posted', 'cancelled')),
  total_value numeric(14,2) NOT NULL DEFAULT 0,
  note text,
  created_by uuid DEFAULT auth.uid(),
  posted_at timestamptz,
  posted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, adj_no)
);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_business
  ON public.stock_adjustments(business_id, adj_date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_branch
  ON public.stock_adjustments(branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_status
  ON public.stock_adjustments(business_id, status);

CREATE TABLE IF NOT EXISTS public.stock_adjustment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  adjustment_id uuid NOT NULL REFERENCES public.stock_adjustments(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  current_qty integer NOT NULL DEFAULT 0,
  new_qty integer NOT NULL DEFAULT 0,
  diff integer NOT NULL DEFAULT 0,
  unit_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_adjustment_items_adjustment
  ON public.stock_adjustment_items(adjustment_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustment_items_variant
  ON public.stock_adjustment_items(variant_id);

-- ---------------------------------------------------------------------------
-- 2) Audit triggers
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_stock_adjustments') THEN
    CREATE TRIGGER audit_stock_adjustments
      AFTER INSERT OR UPDATE OR DELETE ON public.stock_adjustments
      FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_stock_adjustment_items') THEN
    CREATE TRIGGER audit_stock_adjustment_items
      AFTER INSERT OR UPDATE OR DELETE ON public.stock_adjustment_items
      FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Row level security
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_adjustments_select ON public.stock_adjustments;
CREATE POLICY stock_adjustments_select ON public.stock_adjustments
  FOR SELECT TO authenticated
  USING (public.is_member(business_id));

DROP POLICY IF EXISTS stock_adjustments_write ON public.stock_adjustments;
CREATE POLICY stock_adjustments_write ON public.stock_adjustments
  FOR ALL TO authenticated
  USING (public.has_biz_role(
    business_id,
    ARRAY['owner','manager','accountant','store_keeper']::public.member_role[]
  ))
  WITH CHECK (public.has_biz_role(
    business_id,
    ARRAY['owner','manager','accountant','store_keeper']::public.member_role[]
  ));

ALTER TABLE public.stock_adjustment_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_adjustment_items_select ON public.stock_adjustment_items;
CREATE POLICY stock_adjustment_items_select ON public.stock_adjustment_items
  FOR SELECT TO authenticated
  USING (public.is_member(business_id));

DROP POLICY IF EXISTS stock_adjustment_items_write ON public.stock_adjustment_items;
CREATE POLICY stock_adjustment_items_write ON public.stock_adjustment_items
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
-- 4) save_stock_adjustment(): create (_id null) or replace a draft + its lines
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_stock_adjustment(
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
  v_type text := COALESCE(NULLIF(_data->>'adj_type', ''), 'recount');
  v_date date := COALESCE((_data->>'adj_date')::date, current_date);
  v_reason text := NULLIF(_data->>'reason', '');
  v_note text := NULLIF(_data->>'note', '');
  v_status text;
  v_seq int;
  v_no text;
  v_total numeric(14,2) := 0;
  v_count int := 0;
  it jsonb;
  v_var uuid;
  v_cur int;
  v_new int;
  v_cost numeric(14,2);
BEGIN
  IF NOT public.has_biz_role(
    _biz,
    ARRAY['owner','manager','accountant','store_keeper']::public.member_role[]
  ) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;
  IF v_type NOT IN ('increase', 'decrease', 'recount') THEN
    RAISE EXCEPTION 'Invalid adjustment type.';
  END IF;
  IF v_branch IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches
    WHERE id = v_branch AND business_id = _biz AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Choose a valid branch.';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(_data->'items', '[]'::jsonb)) LOOP
    v_var := NULLIF(it->>'variant_id', '')::uuid;
    v_cost := COALESCE((it->>'unit_cost')::numeric, 0);
    IF NOT EXISTS (
      SELECT 1 FROM public.product_variants WHERE id = v_var AND business_id = _biz
    ) THEN
      RAISE EXCEPTION 'Invalid product.';
    END IF;
    IF v_cost < 0 THEN
      RAISE EXCEPTION 'Cost cannot be negative.';
    END IF;
    v_count := v_count + 1;
  END LOOP;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'Add at least one product.';
  END IF;

  IF v_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('adj_no_' || _biz::text));
    SELECT COALESCE(MAX(NULLIF(regexp_replace(adj_no, '\D', '', 'g'), '')::int), 0) + 1
      INTO v_seq
    FROM public.stock_adjustments
    WHERE business_id = _biz;
    v_no := 'ADJ-' || lpad(v_seq::text, 6, '0');

    INSERT INTO public.stock_adjustments (
      business_id, branch_id, adj_no, adj_type, adj_date, reason, note, status, total_value
    ) VALUES (
      _biz, v_branch, v_no, v_type, v_date, v_reason, v_note, 'draft', 0
    )
    RETURNING id INTO v_id;
  ELSE
    SELECT status INTO v_status
    FROM public.stock_adjustments
    WHERE id = v_id AND business_id = _biz
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Adjustment not found.';
    END IF;
    IF v_status <> 'draft' THEN
      RAISE EXCEPTION 'Only a draft adjustment can be edited.';
    END IF;

    UPDATE public.stock_adjustments SET
      branch_id = v_branch,
      adj_type = v_type,
      adj_date = v_date,
      reason = v_reason,
      note = v_note,
      updated_at = now()
    WHERE id = v_id AND business_id = _biz;

    DELETE FROM public.stock_adjustment_items WHERE adjustment_id = v_id;
  END IF;

  FOR it IN
    SELECT t.item
    FROM jsonb_array_elements(_data->'items') WITH ORDINALITY AS t(item, ord)
    ORDER BY t.ord
  LOOP
    v_var := (it->>'variant_id')::uuid;
    v_cost := COALESCE((it->>'unit_cost')::numeric, 0);
    -- Current book quantity for this branch (0 when the row does not exist yet).
    SELECT COALESCE(MAX(qty), 0) INTO v_cur
    FROM public.stock
    WHERE business_id = _biz AND branch_id = v_branch AND variant_id = v_var;
    IF v_type = 'increase' THEN
      v_new := v_cur + COALESCE((it->>'new_qty')::int, 0);
    ELSIF v_type = 'decrease' THEN
      v_new := v_cur - COALESCE((it->>'new_qty')::int, 0);
    ELSE
      v_new := COALESCE((it->>'new_qty')::int, 0);
    END IF;
    IF v_new < 0 THEN
      RAISE EXCEPTION 'Resulting quantity cannot be negative.';
    END IF;
    v_total := v_total + abs(v_new - v_cur) * v_cost;
    INSERT INTO public.stock_adjustment_items (
      business_id, adjustment_id, variant_id, current_qty, new_qty, diff, unit_cost, note
    ) VALUES (
      _biz, v_id, v_var, v_cur, v_new, v_new - v_cur, v_cost, NULLIF(it->>'note', '')
    );
  END LOOP;

  UPDATE public.stock_adjustments
  SET total_value = round(v_total, 2), updated_at = now()
  WHERE id = v_id AND business_id = _biz;

  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 5) post_stock_adjustment(): apply the difference to stock + movements
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_stock_adjustment(_biz uuid, _id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_branch uuid;
  r record;
  v_cur int;
BEGIN
  IF NOT public.has_biz_role(
    _biz,
    ARRAY['owner','manager','accountant','store_keeper']::public.member_role[]
  ) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;

  SELECT status, branch_id INTO v_status, v_branch
  FROM public.stock_adjustments
  WHERE id = _id AND business_id = _biz
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Adjustment not found.';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft adjustment can be posted.';
  END IF;

  FOR r IN
    SELECT variant_id, diff, unit_cost
    FROM public.stock_adjustment_items
    WHERE adjustment_id = _id AND business_id = _biz
    ORDER BY created_at
  LOOP
    IF r.diff = 0 THEN
      CONTINUE;
    END IF;
    SELECT qty INTO v_cur
    FROM public.stock
    WHERE branch_id = v_branch AND variant_id = r.variant_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_cur + r.diff < 0 THEN
        RAISE EXCEPTION 'Stock for a product would go negative.';
      END IF;
      UPDATE public.stock
      SET qty = qty + r.diff, updated_at = now()
      WHERE branch_id = v_branch AND variant_id = r.variant_id;
    ELSE
      IF r.diff < 0 THEN
        RAISE EXCEPTION 'No stock row to decrease for one of the products.';
      END IF;
      INSERT INTO public.stock (business_id, branch_id, variant_id, qty, avg_cost)
      VALUES (_biz, v_branch, r.variant_id, r.diff, r.unit_cost);
    END IF;

    INSERT INTO public.stock_movements (
      business_id, branch_id, variant_id, qty_change, unit_cost, ref_type, ref_id
    ) VALUES (
      _biz, v_branch, r.variant_id, r.diff, r.unit_cost, 'adjustment', _id
    );
  END LOOP;

  UPDATE public.stock_adjustments
  SET status = 'posted', posted_at = now(), posted_by = auth.uid(), updated_at = now()
  WHERE id = _id AND business_id = _biz;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Privileges
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_adjustments TO authenticated;
GRANT ALL ON public.stock_adjustments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_adjustment_items TO authenticated;
GRANT ALL ON public.stock_adjustment_items TO service_role;

REVOKE ALL ON FUNCTION public.save_stock_adjustment(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_stock_adjustment(uuid, uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.post_stock_adjustment(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_stock_adjustment(uuid, uuid) TO authenticated;

COMMENT ON TABLE public.stock_adjustments IS
  'Stock adjustment / physical count headers; stock moves only when posted.';
COMMENT ON TABLE public.stock_adjustment_items IS
  'Lines of a stock adjustment with the counted/book difference per variant.';
COMMENT ON FUNCTION public.save_stock_adjustment(uuid, uuid, jsonb) IS
  'Create (_id null) or replace a draft stock adjustment; server computes the diff and value.';
COMMENT ON FUNCTION public.post_stock_adjustment(uuid, uuid) IS
  'Apply a draft adjustment to public.stock and write public.stock_movements atomically.';
