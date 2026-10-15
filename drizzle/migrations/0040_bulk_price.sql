-- 0040_bulk_price.sql
-- Module 7: Bulk price update.
--
-- Applies a percent / amount / set change to the retail, wholesale and/or
-- dealer price of every matching active variant in one transaction and keeps a
-- history row so the change can be reviewed later.

-- ---------------------------------------------------------------------------
-- 0) Reconcile with an earlier schema draft
-- ---------------------------------------------------------------------------
-- Drop an earlier-draft table only while it is still empty so this migration
-- recreates the layout the app expects; refuse rather than corrupt when it
-- holds data.
DO $$
DECLARE
  t text;
  has_rows boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['bulk_price_updates'] LOOP
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
      AND p.proname IN ('apply_bulk_price_update')
  LOOP
    EXECUTE format('DROP FUNCTION public.%I(%s)', r.proname, pg_get_function_identity_arguments(r.oid));
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1) History table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bulk_price_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  apply_type text NOT NULL DEFAULT 'percent'
    CHECK (apply_type IN ('percent', 'amount', 'set')),
  target text NOT NULL DEFAULT 'retail'
    CHECK (target IN ('retail', 'wholesale', 'dealer', 'all')),
  value numeric(14,2) NOT NULL DEFAULT 0,
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('preview', 'applied')),
  affected integer NOT NULL DEFAULT 0,
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_bulk_price_updates_business
  ON public.bulk_price_updates(business_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_bulk_price_updates') THEN
    CREATE TRIGGER audit_bulk_price_updates
      AFTER INSERT OR UPDATE OR DELETE ON public.bulk_price_updates
      FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  END IF;
END $$;

ALTER TABLE public.bulk_price_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bulk_price_updates_select ON public.bulk_price_updates;
CREATE POLICY bulk_price_updates_select ON public.bulk_price_updates
  FOR SELECT TO authenticated
  USING (public.is_member(business_id));

DROP POLICY IF EXISTS bulk_price_updates_write ON public.bulk_price_updates;
CREATE POLICY bulk_price_updates_write ON public.bulk_price_updates
  FOR ALL TO authenticated
  USING (public.has_biz_role(
    business_id,
    ARRAY['owner','manager','accountant']::public.member_role[]
  ))
  WITH CHECK (public.has_biz_role(
    business_id,
    ARRAY['owner','manager','accountant']::public.member_role[]
  ));

-- ---------------------------------------------------------------------------
-- 2) apply_bulk_price_update()
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_bulk_price_update(_biz uuid, _data jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := COALESCE(NULLIF(_data->>'name', ''), 'Bulk price update');
  v_type text := COALESCE(NULLIF(_data->>'apply_type', ''), 'percent');
  v_target text := COALESCE(NULLIF(_data->>'target', ''), 'retail');
  v_value numeric(14,2) := COALESCE((_data->>'value')::numeric, 0);
  v_cat uuid := NULLIF(_data->>'category_id', '')::uuid;
  v_brand uuid := NULLIF(_data->>'brand_id', '')::uuid;
  v_note text := NULLIF(_data->>'note', '');
  v_rows int := 0;
BEGIN
  IF NOT public.has_biz_role(
    _biz,
    ARRAY['owner','manager','accountant']::public.member_role[]
  ) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;
  IF v_type NOT IN ('percent', 'amount', 'set') THEN
    RAISE EXCEPTION 'Invalid update type.';
  END IF;
  IF v_target NOT IN ('retail', 'wholesale', 'dealer', 'all') THEN
    RAISE EXCEPTION 'Invalid price target.';
  END IF;

  UPDATE public.product_variants v
  SET
    retail_price = CASE
      WHEN v_target IN ('retail', 'all') THEN
        greatest(CASE v_type
          WHEN 'percent' THEN round(v.retail_price * (1 + v_value / 100), 2)
          WHEN 'amount' THEN round(v.retail_price + v_value, 2)
          ELSE v_value END, 0)
      ELSE v.retail_price END,
    wholesale_price = CASE
      WHEN v_target IN ('wholesale', 'all') THEN
        greatest(CASE v_type
          WHEN 'percent' THEN round(v.wholesale_price * (1 + v_value / 100), 2)
          WHEN 'amount' THEN round(v.wholesale_price + v_value, 2)
          ELSE v_value END, 0)
      ELSE v.wholesale_price END,
    dealer_price = CASE
      WHEN v_target IN ('dealer', 'all') THEN
        greatest(CASE v_type
          WHEN 'percent' THEN round(v.dealer_price * (1 + v_value / 100), 2)
          WHEN 'amount' THEN round(v.dealer_price + v_value, 2)
          ELSE v_value END, 0)
      ELSE v.dealer_price END
  FROM public.products p
  WHERE v.business_id = _biz
    AND v.product_id = p.id
    AND v.status = 'active'
    AND (v_cat IS NULL OR p.category_id = v_cat)
    AND (v_brand IS NULL OR p.brand_id = v_brand);

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  INSERT INTO public.bulk_price_updates (
    business_id, name, apply_type, target, value, category_id, brand_id,
    status, affected, note, applied_at
  ) VALUES (
    _biz, v_name, v_type, v_target, v_value, v_cat, v_brand,
    'applied', v_rows, v_note, now()
  );

  RETURN v_rows;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bulk_price_updates TO authenticated;
GRANT ALL ON public.bulk_price_updates TO service_role;

REVOKE ALL ON FUNCTION public.apply_bulk_price_update(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_bulk_price_update(uuid, jsonb) TO authenticated;

COMMENT ON TABLE public.bulk_price_updates IS
  'History of bulk price updates (percent / amount / set) applied to matching variants.';
COMMENT ON FUNCTION public.apply_bulk_price_update(uuid, jsonb) IS
  'Apply one bulk price change to matching active variants and record the history row; returns affected count.';
