-- 0041_label_templates.sql
-- Module 8: Barcode / QR label templates.
--
-- Labels are rendered entirely in the browser (JsBarcode / QRCode); the server
-- only stores the layout so every device prints the same label.

-- Reconcile with an earlier schema draft: drop the table only while it is still
-- empty so this migration recreates the layout the app expects (kind, sizes,
-- barcode_format, ...); refuse rather than corrupt when it holds data.
DO $$
DECLARE
  t text;
  has_rows boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY['label_templates'] LOOP
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
      AND p.proname IN ('save_label_template')
  LOOP
    EXECUTE format('DROP FUNCTION public.%I(%s)', r.proname, pg_get_function_identity_arguments(r.oid));
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.label_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'barcode' CHECK (kind IN ('barcode', 'qr', 'both')),
  paper text NOT NULL DEFAULT 'thermal' CHECK (paper IN ('a4', 'thermal')),
  width_mm numeric(6,1) NOT NULL DEFAULT 40,
  height_mm numeric(6,1) NOT NULL DEFAULT 25,
  cols integer NOT NULL DEFAULT 3,
  rows integer NOT NULL DEFAULT 8,
  show_name boolean NOT NULL DEFAULT true,
  show_sku boolean NOT NULL DEFAULT true,
  show_price boolean NOT NULL DEFAULT false,
  barcode_format text NOT NULL DEFAULT 'CODE128',
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);
CREATE INDEX IF NOT EXISTS idx_label_templates_business ON public.label_templates(business_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_label_templates') THEN
    CREATE TRIGGER audit_label_templates
      AFTER INSERT OR UPDATE OR DELETE ON public.label_templates
      FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  END IF;
END $$;

ALTER TABLE public.label_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS label_templates_select ON public.label_templates;
CREATE POLICY label_templates_select ON public.label_templates
  FOR SELECT TO authenticated
  USING (public.is_member(business_id));

DROP POLICY IF EXISTS label_templates_write ON public.label_templates;
CREATE POLICY label_templates_write ON public.label_templates
  FOR ALL TO authenticated
  USING (public.has_biz_role(business_id, ARRAY['owner','manager']::public.member_role[]))
  WITH CHECK (public.has_biz_role(business_id, ARRAY['owner','manager']::public.member_role[]));

CREATE OR REPLACE FUNCTION public.save_label_template(
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
  v_name text := NULLIF(_data->>'name', '');
  v_kind text := COALESCE(NULLIF(_data->>'kind', ''), 'barcode');
  v_paper text := COALESCE(NULLIF(_data->>'paper', ''), 'thermal');
  v_default boolean := COALESCE((_data->>'is_default')::boolean, false);
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager']::public.member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Template name is required.';
  END IF;
  IF v_kind NOT IN ('barcode', 'qr', 'both') THEN
    RAISE EXCEPTION 'Invalid label kind.';
  END IF;
  IF v_paper NOT IN ('a4', 'thermal') THEN
    RAISE EXCEPTION 'Invalid paper type.';
  END IF;

  IF v_default THEN
    UPDATE public.label_templates SET is_default = false
    WHERE business_id = _biz AND is_default;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.label_templates (
      business_id, name, kind, paper, width_mm, height_mm, cols, rows,
      show_name, show_sku, show_price, barcode_format, is_default
    ) VALUES (
      _biz, v_name, v_kind, v_paper,
      COALESCE((_data->>'width_mm')::numeric, 40),
      COALESCE((_data->>'height_mm')::numeric, 25),
      COALESCE((_data->>'cols')::int, 3),
      COALESCE((_data->>'rows')::int, 8),
      COALESCE((_data->>'show_name')::boolean, true),
      COALESCE((_data->>'show_sku')::boolean, true),
      COALESCE((_data->>'show_price')::boolean, false),
      COALESCE(NULLIF(_data->>'barcode_format', ''), 'CODE128'),
      v_default
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.label_templates SET
      name = v_name,
      kind = v_kind,
      paper = v_paper,
      width_mm = COALESCE((_data->>'width_mm')::numeric, width_mm),
      height_mm = COALESCE((_data->>'height_mm')::numeric, height_mm),
      cols = COALESCE((_data->>'cols')::int, cols),
      rows = COALESCE((_data->>'rows')::int, rows),
      show_name = COALESCE((_data->>'show_name')::boolean, show_name),
      show_sku = COALESCE((_data->>'show_sku')::boolean, show_sku),
      show_price = COALESCE((_data->>'show_price')::boolean, show_price),
      barcode_format = COALESCE(NULLIF(_data->>'barcode_format', ''), barcode_format),
      is_default = v_default,
      updated_at = now()
    WHERE id = v_id AND business_id = _biz;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Template not found.';
    END IF;
  END IF;

  RETURN v_id;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_templates TO authenticated;
GRANT ALL ON public.label_templates TO service_role;

REVOKE ALL ON FUNCTION public.save_label_template(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_label_template(uuid, uuid, jsonb) TO authenticated;

COMMENT ON TABLE public.label_templates IS
  'Barcode / QR label layouts; rendering happens client-side, the server stores the layout only.';
COMMENT ON FUNCTION public.save_label_template(uuid, uuid, jsonb) IS
  'Create (_id null) or update a label template; keeps a single default per business.';
