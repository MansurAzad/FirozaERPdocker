-- 0034_quotations.sql
-- P2 — Quotation / Estimate / Proforma invoice (missing module).
--
-- A quotation/estimate/proforma never touches stock, customer due or the
-- ledger. It is a priced offer document that can later be converted into a
-- real sale through the normal POS flow (so IMEI selection, credit checks,
-- payments and accounting all keep using one code path).
--
-- Contents:
--   * public.quotations        (header, one row per document)
--   * public.quotation_items   (lines)
--   * tenant-scoped RLS + audit triggers
--   * save_quotation()             create / edit a document + its lines
--   * update_quotation_status()    draft -> sent -> accepted / rejected / expired / cancelled
--   * mark_quotation_converted()   link the SALE created from this document

-- ---------------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  quote_no text NOT NULL,
  doc_type text NOT NULL DEFAULT 'quotation'
    CHECK (doc_type IN ('quotation', 'estimate', 'proforma')),
  quote_date date NOT NULL DEFAULT current_date,
  valid_until date,
  price_level public.price_level NOT NULL DEFAULT 'retail',
  subtotal numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  doc_discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (doc_discount >= 0),
  discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'converted', 'cancelled')),
  converted_sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  notes text,
  terms text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, quote_no)
);
CREATE INDEX IF NOT EXISTS idx_quotations_business
  ON public.quotations(business_id, quote_date DESC);
CREATE INDEX IF NOT EXISTS idx_quotations_customer ON public.quotations(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotations_status ON public.quotations(business_id, status);

CREATE TABLE IF NOT EXISTS public.quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  description text,
  qty integer NOT NULL CHECK (qty > 0),
  price numeric(14,2) NOT NULL CHECK (price >= 0),
  discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  line_total numeric(14,2) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation
  ON public.quotation_items(quotation_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_quotation_items_variant
  ON public.quotation_items(variant_id);

-- ---------------------------------------------------------------------------
-- 2) Audit triggers (AGENTS.md: every business table gets audit_row())
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_quotations') THEN
    CREATE TRIGGER audit_quotations
      AFTER INSERT OR UPDATE OR DELETE ON public.quotations
      FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_quotation_items') THEN
    CREATE TRIGGER audit_quotation_items
      AFTER INSERT OR UPDATE OR DELETE ON public.quotation_items
      FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Row level security (tenant isolation is the source of truth)
-- ---------------------------------------------------------------------------
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quotations_select ON public.quotations;
CREATE POLICY quotations_select ON public.quotations
  FOR SELECT TO authenticated
  USING (public.is_member(business_id));

DROP POLICY IF EXISTS quotations_insert ON public.quotations;
CREATE POLICY quotations_insert ON public.quotations
  FOR INSERT TO authenticated
  WITH CHECK (public.has_biz_role(
    business_id,
    ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]
  ));

DROP POLICY IF EXISTS quotations_update ON public.quotations;
CREATE POLICY quotations_update ON public.quotations
  FOR UPDATE TO authenticated
  USING (
    public.has_biz_role(
      business_id,
      ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]
    )
    AND status <> 'converted'
  )
  WITH CHECK (public.has_biz_role(
    business_id,
    ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]
  ));

DROP POLICY IF EXISTS quotations_delete ON public.quotations;
CREATE POLICY quotations_delete ON public.quotations
  FOR DELETE TO authenticated
  USING (
    public.has_biz_role(business_id, ARRAY['owner','manager']::public.member_role[])
    AND status IN ('draft', 'cancelled')
  );

ALTER TABLE public.quotation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quotation_items_select ON public.quotation_items;
CREATE POLICY quotation_items_select ON public.quotation_items
  FOR SELECT TO authenticated
  USING (public.is_member(business_id));

DROP POLICY IF EXISTS quotation_items_write ON public.quotation_items;
CREATE POLICY quotation_items_write ON public.quotation_items
  FOR ALL TO authenticated
  USING (public.has_biz_role(
    business_id,
    ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]
  ))
  WITH CHECK (public.has_biz_role(
    business_id,
    ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]
  ));

-- ---------------------------------------------------------------------------
-- 4) save_quotation(): create (_id null) or replace a document + its lines.
--    Totals and the document number are computed server-side so the client
--    can never write an inconsistent total.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_quotation(_biz uuid, _id uuid DEFAULT NULL, _data jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := _id;
  v_branch uuid := NULLIF(_data->>'branch_id', '')::uuid;
  v_cust uuid := NULLIF(_data->>'customer_id', '')::uuid;
  v_type text := COALESCE(NULLIF(_data->>'doc_type', ''), 'quotation');
  v_date date := COALESCE((_data->>'quote_date')::date, current_date);
  v_valid date := NULLIF(_data->>'valid_until', '')::date;
  v_notes text := NULLIF(_data->>'notes', '');
  v_terms text := NULLIF(_data->>'terms', '');
  v_level public.price_level :=
    COALESCE(NULLIF(_data->>'price_level', '')::public.price_level, 'retail');
  v_hdisc numeric(14,2) := COALESCE((_data->>'discount')::numeric, 0);
  v_tax numeric(14,2) := COALESCE((_data->>'tax')::numeric, 0);
  v_sub numeric(14,2) := 0;
  v_ldisc numeric(14,2) := 0;
  v_total numeric(14,2);
  v_seq int;
  v_no text;
  v_prefix text;
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
    ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]
  ) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;
  IF v_type NOT IN ('quotation', 'estimate', 'proforma') THEN
    RAISE EXCEPTION 'Invalid document type.';
  END IF;
  IF v_branch IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.branches
    WHERE id = v_branch AND business_id = _biz AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Choose a valid branch.';
  END IF;
  IF v_cust IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers WHERE id = v_cust AND business_id = _biz
  ) THEN
    RAISE EXCEPTION 'Invalid customer.';
  END IF;
  IF v_hdisc < 0 OR v_tax < 0 THEN
    RAISE EXCEPTION 'Amounts cannot be negative.';
  END IF;

  -- Validate every line and total the document.
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
    PERFORM pg_advisory_xact_lock(hashtext('quote_no_' || _biz::text));
    SELECT COALESCE(MAX(NULLIF(regexp_replace(quote_no, '\D', '', 'g'), '')::int), 0) + 1
      INTO v_seq
    FROM public.quotations
    WHERE business_id = _biz;
    v_prefix := CASE v_type
      WHEN 'estimate' THEN 'EST-'
      WHEN 'proforma' THEN 'PRO-'
      ELSE 'QTN-'
    END;
    v_no := v_prefix || lpad(v_seq::text, 6, '0');

    INSERT INTO public.quotations (
      business_id, branch_id, customer_id, quote_no, doc_type, quote_date, valid_until,
      price_level, subtotal, doc_discount, discount, tax, total, notes, terms, status
    ) VALUES (
      _biz, v_branch, v_cust, v_no, v_type, v_date, v_valid,
      v_level, v_sub, v_hdisc, v_ldisc + v_hdisc, v_tax, v_total, v_notes, v_terms, 'draft'
    )
    RETURNING id INTO v_id;
  ELSE
    SELECT status INTO v_status
    FROM public.quotations
    WHERE id = v_id AND business_id = _biz
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Quotation not found.';
    END IF;
    IF v_status = 'converted' THEN
      RAISE EXCEPTION 'A converted quotation cannot be edited.';
    END IF;

    UPDATE public.quotations SET
      branch_id = v_branch,
      customer_id = v_cust,
      doc_type = v_type,
      quote_date = v_date,
      valid_until = v_valid,
      price_level = v_level,
      subtotal = v_sub,
      doc_discount = v_hdisc,
      discount = v_ldisc + v_hdisc,
      tax = v_tax,
      total = v_total,
      notes = v_notes,
      terms = v_terms,
      updated_at = now()
    WHERE id = v_id AND business_id = _biz;

    DELETE FROM public.quotation_items WHERE quotation_id = v_id;
  END IF;

  FOR it IN
    SELECT t.item
    FROM jsonb_array_elements(_data->'items') WITH ORDINALITY AS t(item, ord)
    ORDER BY t.ord
  LOOP
    v_var := (it->>'variant_id')::uuid;
    v_qty := (it->>'qty')::int;
    v_price := (it->>'price')::numeric;
    v_disc := COALESCE((it->>'discount')::numeric, 0);
    INSERT INTO public.quotation_items (
      business_id, quotation_id, variant_id, description, qty, price, discount, line_total
    ) VALUES (
      _biz, v_id, v_var, NULLIF(it->>'description', ''), v_qty, v_price, v_disc,
      round(v_qty * v_price, 2) - v_disc
    );
  END LOOP;

  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 4) Status transitions (converted is only reachable through a real sale)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_quotation_status(_biz uuid, _id uuid, _status text)
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
    ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]
  ) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;
  IF _status NOT IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid status.';
  END IF;

  SELECT status INTO v_cur
  FROM public.quotations
  WHERE id = _id AND business_id = _biz
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found.';
  END IF;
  IF v_cur = 'converted' THEN
    RAISE EXCEPTION 'A converted quotation cannot change status.';
  END IF;

  UPDATE public.quotations
  SET status = _status, updated_at = now()
  WHERE id = _id AND business_id = _biz;
END $$;

-- ---------------------------------------------------------------------------
-- 5) Mark a document converted and link the sale it produced
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_quotation_converted(_biz uuid, _id uuid, _sale uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur text;
  v_sale uuid;
BEGIN
  IF NOT public.has_biz_role(
    _biz,
    ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]
  ) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;

  SELECT id INTO v_sale FROM public.sales WHERE id = _sale AND business_id = _biz;
  IF v_sale IS NULL THEN
    RAISE EXCEPTION 'Invalid sale.';
  END IF;

  SELECT status INTO v_cur
  FROM public.quotations
  WHERE id = _id AND business_id = _biz
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found.';
  END IF;
  IF v_cur = 'converted' THEN
    RETURN;
  END IF;

  UPDATE public.quotations
  SET status = 'converted', converted_sale_id = _sale, updated_at = now()
  WHERE id = _id AND business_id = _biz;
END $$;

-- ---------------------------------------------------------------------------
-- 6) Privileges
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotations TO authenticated;
GRANT ALL ON public.quotations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotation_items TO authenticated;
GRANT ALL ON public.quotation_items TO service_role;

REVOKE ALL ON FUNCTION public.save_quotation(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_quotation(uuid, uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.update_quotation_status(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_quotation_status(uuid, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_quotation_converted(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_quotation_converted(uuid, uuid, uuid) TO authenticated;

COMMENT ON TABLE public.quotations IS
  'Quotation / estimate / proforma-invoice headers; no stock, due or ledger impact until converted to a sale.';
COMMENT ON TABLE public.quotation_items IS 'Lines of a quotation; totals are recomputed by save_quotation().';
COMMENT ON FUNCTION public.save_quotation(uuid, uuid, jsonb) IS
  'Create (_id null) or replace a quotation/estimate/proforma and its lines; server computes subtotal/discount/total.';
COMMENT ON FUNCTION public.update_quotation_status(uuid, uuid, text) IS
  'Move a quotation/estimate/proforma between draft/sent/accepted/rejected/expired/cancelled.';
COMMENT ON FUNCTION public.mark_quotation_converted(uuid, uuid, uuid) IS
  'Link the sale created from a quotation and mark it converted.';
