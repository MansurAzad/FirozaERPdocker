CREATE TABLE public.sale_exception_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  requested_by uuid NOT NULL,
  request_reason text NOT NULL CHECK (length(btrim(request_reason)) BETWEEN 1 AND 1000),
  exception_types text[] NOT NULL CHECK (
    cardinality(exception_types) > 0
    AND exception_types <@ ARRAY['minimum_price','discount_limit','credit_limit']::text[]
  ),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  sale_summary jsonb NOT NULL CHECK (jsonb_typeof(sale_summary) = 'object'),
  sale_total numeric(14,2) NOT NULL CHECK (sale_total >= 0),
  customer_id uuid REFERENCES public.customers(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  reviewer_id uuid,
  reviewed_at timestamptz,
  rejection_reason text,
  sale_id uuid REFERENCES public.sales(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id)
);

CREATE INDEX sale_exception_requests_business_status_requested_idx
  ON public.sale_exception_requests (business_id, status, requested_at DESC);
CREATE INDEX sale_exception_requests_requester_idx
  ON public.sale_exception_requests (business_id, requested_by, requested_at DESC);

ALTER TABLE public.sale_exception_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_exception_requests FROM authenticated;
GRANT SELECT (
  id, business_id, branch_id, requested_by, request_reason, exception_types,
  sale_summary, sale_total, customer_id, status, reviewer_id, reviewed_at,
  rejection_reason, sale_id, requested_at
) ON public.sale_exception_requests TO authenticated;

CREATE POLICY sale_exception_requests_read ON public.sale_exception_requests
  FOR SELECT TO authenticated
  USING (
    public.has_module_access(business_id, 'sales', 'view')
    AND (
      requested_by = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.business_members bm
        WHERE bm.business_id = sale_exception_requests.business_id
          AND bm.user_id = auth.uid()
          AND bm.role IN ('owner','manager')
      )
    )
  );

CREATE TRIGGER audit_sale_exception_requests
  AFTER INSERT OR UPDATE OR DELETE ON public.sale_exception_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER guard_sale_exception_requests
  BEFORE INSERT OR UPDATE OR DELETE ON public.sale_exception_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_business_module_write();

CREATE OR REPLACE FUNCTION public.request_sale_exception(
  _biz uuid,
  _data jsonb,
  _reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid;
  v_customer uuid;
  v_credit_limit numeric(14,2);
  v_current_due numeric(14,2);
  v_subtotal numeric(14,2) := 0;
  v_discount numeric(14,2);
  v_tax numeric(14,2);
  v_paid numeric(14,2) := 0;
  v_total numeric(14,2);
  v_due numeric(14,2);
  v_variant uuid;
  v_qty integer;
  v_price numeric(14,2);
  v_min_price numeric(14,2);
  v_exceptions text[] := ARRAY[]::text[];
  v_summary jsonb := '[]'::jsonb;
  v_total_summary numeric(14,2);
  v_product_name text;
  v_item jsonb;
  v_payment jsonb;
  v_request uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members bm
    WHERE bm.business_id = _biz
      AND bm.user_id = auth.uid()
      AND bm.role = 'branch_manager'
  ) THEN
    RAISE EXCEPTION 'Only a branch manager can request a sale exception.';
  END IF;
  IF NOT public.has_module_access(_biz, 'sales', 'create') THEN
    RAISE EXCEPTION 'You do not have permission to request sale approval.';
  END IF;
  IF jsonb_typeof(_data) IS DISTINCT FROM 'object'
    OR jsonb_typeof(_data->'items') IS DISTINCT FROM 'array'
    OR (
      _data ? 'payments'
      AND jsonb_typeof(_data->'payments') IS DISTINCT FROM 'array'
    )
    OR jsonb_array_length(coalesce(_data->'items','[]'::jsonb)) = 0
    OR jsonb_array_length(coalesce(_data->'items','[]'::jsonb)) > 200
    OR jsonb_array_length(coalesce(_data->'payments','[]'::jsonb)) > 20
    OR pg_column_size(_data) > 262144 THEN
    RAISE EXCEPTION 'Invalid sale request payload.';
  END IF;
  IF length(btrim(coalesce(_reason,''))) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Enter a reason between 1 and 1000 characters.';
  END IF;

  v_branch := nullif(_data->>'branch_id','')::uuid;
  v_customer := nullif(_data->>'customer_id','')::uuid;
  IF v_branch IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.id = v_branch
        AND b.business_id = _biz
        AND b.status = 'active'
    )
    OR NOT public.can_access_shop_branch(_biz, v_branch) THEN
    RAISE EXCEPTION 'You cannot request approval for this shop.';
  END IF;
  IF v_customer IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = v_customer AND c.business_id = _biz AND c.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Select an active customer for this sale.';
  END IF;

  v_discount := coalesce(nullif(_data->>'discount','')::numeric,0);
  v_tax := coalesce(nullif(_data->>'tax','')::numeric,0);
  IF v_discount < 0 OR v_tax < 0 THEN
    RAISE EXCEPTION 'Amounts cannot be negative.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_data->'items') LOOP
    v_variant := nullif(v_item->>'variant_id','')::uuid;
    v_qty := nullif(v_item->>'qty','')::integer;
    v_price := nullif(v_item->>'price','')::numeric;
    IF v_variant IS NULL OR v_qty IS NULL OR v_qty <= 0
      OR v_price IS NULL OR v_price < 0 THEN
      RAISE EXCEPTION 'Invalid sale item.';
    END IF;

    SELECT pv.min_price, coalesce(p.model, pv.sku, 'Product')
    INTO v_min_price, v_product_name
    FROM public.product_variants pv
    JOIN public.products p ON p.id = pv.product_id AND p.business_id = _biz
    WHERE pv.id = v_variant AND pv.business_id = _biz;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid product.';
    END IF;
    IF v_price < coalesce(v_min_price,0) THEN
      v_exceptions := array_append(v_exceptions, 'minimum_price');
    END IF;
    v_subtotal := v_subtotal + round(v_qty * v_price,2);
    v_summary := v_summary || jsonb_build_array(jsonb_build_object(
      'product', v_product_name,
      'qty', v_qty,
      'price', v_price,
      'minimum_price', coalesce(v_min_price,0)
    ));
  END LOOP;

  IF v_discount > 0 AND v_subtotal > 0 AND v_discount / v_subtotal > 0.10 THEN
    v_exceptions := array_append(v_exceptions, 'discount_limit');
  END IF;

  FOR v_payment IN
    SELECT * FROM jsonb_array_elements(coalesce(_data->'payments','[]'::jsonb))
  LOOP
    IF coalesce(nullif(v_payment->>'amount','')::numeric,0) < 0 THEN
      RAISE EXCEPTION 'Invalid payment amount.';
    END IF;
    v_paid := v_paid + coalesce(nullif(v_payment->>'amount','')::numeric,0);
  END LOOP;

  v_total := v_subtotal - v_discount + v_tax;
  v_total_summary := v_total;
  IF v_total < 0 OR v_paid > v_total THEN
    RAISE EXCEPTION 'Invalid sale total or payment amount.';
  END IF;
  v_due := v_total - v_paid;
  IF v_due > 0 AND v_customer IS NULL THEN
    RAISE EXCEPTION 'Walk-in sales must be fully paid.';
  END IF;
  IF v_due > 0 THEN
    SELECT c.credit_limit INTO v_credit_limit
    FROM public.customers c
    WHERE c.id = v_customer AND c.business_id = _biz AND c.status = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Select an active customer for a sale on credit.';
    END IF;
    v_current_due := public.customer_due(v_customer);
    IF v_current_due + v_due > coalesce(v_credit_limit,0) THEN
      v_exceptions := array_append(v_exceptions, 'credit_limit');
    END IF;
  END IF;

  SELECT array_agg(DISTINCT exception_type ORDER BY exception_type)
  INTO v_exceptions
  FROM unnest(v_exceptions) AS exception_type;
  IF coalesce(cardinality(v_exceptions),0) = 0 THEN
    RAISE EXCEPTION 'This sale does not require an exception approval.';
  END IF;

  INSERT INTO public.sale_exception_requests (
    business_id, branch_id, requested_by, request_reason,
    exception_types, payload, sale_summary, sale_total, customer_id
  )
  VALUES (
    _biz, v_branch, auth.uid(), btrim(_reason), v_exceptions,
    jsonb_set(_data, '{override_credit}', 'false'::jsonb, true),
    jsonb_build_object(
      'items', v_summary,
      'subtotal', v_subtotal,
      'discount', v_discount,
      'tax', v_tax,
      'total', v_total_summary,
      'paid', v_paid,
      'due', v_due,
      'customer_current_due', v_current_due,
      'customer_credit_limit', v_credit_limit
    ),
    v_total_summary,
    v_customer
  )
  RETURNING id INTO v_request;

  RETURN v_request;
END
$$;

CREATE OR REPLACE FUNCTION public.approve_sale_exception(_biz uuid, _id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.sale_exception_requests%ROWTYPE;
  v_sale uuid;
  v_payload jsonb;
  v_document_id uuid;
  v_document_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members bm
    WHERE bm.business_id = _biz
      AND bm.user_id = auth.uid()
      AND bm.role IN ('owner','manager')
  ) THEN
    RAISE EXCEPTION 'Only an owner or manager can approve sale exceptions.';
  END IF;
  IF NOT public.has_module_access(_biz, 'sales', 'approve') THEN
    RAISE EXCEPTION 'You do not have permission to approve sale exceptions.';
  END IF;

  SELECT * INTO v_request
  FROM public.sale_exception_requests
  WHERE id = _id AND business_id = _biz
  FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Sale approval request is no longer pending.';
  END IF;
  IF v_request.requested_by = auth.uid() THEN
    RAISE EXCEPTION 'The requester cannot approve their own sale.';
  END IF;

  v_document_id := nullif(v_request.payload->>'quote_id','')::uuid;
  IF v_document_id IS NOT NULL THEN
    SELECT status INTO v_document_status
    FROM public.quotations
    WHERE id = v_document_id AND business_id = _biz
    FOR UPDATE;
    IF NOT FOUND OR v_document_status = 'converted' THEN
      RAISE EXCEPTION 'The quotation is missing or has already been converted.';
    END IF;
  END IF;

  v_document_id := nullif(v_request.payload->>'order_id','')::uuid;
  IF v_document_id IS NOT NULL THEN
    SELECT status INTO v_document_status
    FROM public.orders
    WHERE id = v_document_id AND business_id = _biz
    FOR UPDATE;
    IF NOT FOUND OR v_document_status = 'converted' THEN
      RAISE EXCEPTION 'The order is missing or has already been converted.';
    END IF;
  END IF;

  v_payload := jsonb_set(
    v_request.payload,
    '{override_credit}',
    to_jsonb('credit_limit' = ANY(v_request.exception_types)),
    true
  );
  v_sale := public.create_sale(_biz, v_payload);

  IF nullif(v_payload->>'quote_id','') IS NOT NULL THEN
    PERFORM public.mark_quotation_converted(
      _biz, (v_payload->>'quote_id')::uuid, v_sale
    );
  END IF;
  IF nullif(v_payload->>'order_id','') IS NOT NULL THEN
    PERFORM public.mark_order_converted(
      _biz, (v_payload->>'order_id')::uuid, v_sale
    );
  END IF;

  UPDATE public.sale_exception_requests
  SET status = 'approved', reviewer_id = auth.uid(), reviewed_at = now(), sale_id = v_sale
  WHERE id = _id AND business_id = _biz;

  INSERT INTO public.audit_logs (business_id, user_id, module, action, record_id, new_value)
  VALUES (
    _biz, auth.uid(), 'sales', 'sale_exception_approved', _id,
    jsonb_build_object(
      'sale_id', v_sale,
      'requested_by', v_request.requested_by,
      'exception_types', v_request.exception_types
    )
  );
  RETURN v_sale;
END
$$;

CREATE OR REPLACE FUNCTION public.reject_sale_exception(
  _biz uuid,
  _id uuid,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.sale_exception_requests%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.business_members bm
    WHERE bm.business_id = _biz
      AND bm.user_id = auth.uid()
      AND bm.role IN ('owner','manager')
  ) THEN
    RAISE EXCEPTION 'Only an owner or manager can reject sale exceptions.';
  END IF;
  IF NOT public.has_module_access(_biz, 'sales', 'approve') THEN
    RAISE EXCEPTION 'You do not have permission to reject sale exceptions.';
  END IF;
  IF length(btrim(coalesce(_reason,''))) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Enter a rejection reason between 1 and 1000 characters.';
  END IF;

  SELECT * INTO v_request
  FROM public.sale_exception_requests
  WHERE id = _id AND business_id = _biz
  FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Sale approval request is no longer pending.';
  END IF;
  IF v_request.requested_by = auth.uid() THEN
    RAISE EXCEPTION 'The requester cannot reject their own sale.';
  END IF;

  UPDATE public.sale_exception_requests
  SET status = 'rejected', reviewer_id = auth.uid(), reviewed_at = now(),
      rejection_reason = btrim(_reason)
  WHERE id = _id AND business_id = _biz;

  INSERT INTO public.audit_logs (business_id, user_id, module, action, record_id, new_value)
  VALUES (
    _biz, auth.uid(), 'sales', 'sale_exception_rejected', _id,
    jsonb_build_object(
      'requested_by', v_request.requested_by,
      'exception_types', v_request.exception_types,
      'reason', btrim(_reason)
    )
  );
END
$$;

DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.access_rpc_allowed(uuid)'::regprocedure)
  INTO v_definition;

  v_definition := replace(
    v_definition,
    'WHEN ''create_sale'' THEN ''sales''',
    'WHEN ''create_sale'' THEN ''sales'' WHEN ''request_sale_exception'' THEN ''sales'' WHEN ''approve_sale_exception'' THEN ''sales'' WHEN ''reject_sale_exception'' THEN ''sales'''
  );
  v_definition := replace(
    v_definition,
    '''approve_stock_transfer'',''close_day''',
    '''approve_sale_exception'',''reject_sale_exception'',''approve_stock_transfer'',''close_day'''
  );
  IF position('WHEN ''request_sale_exception'' THEN ''sales''' IN v_definition) = 0
    OR position('WHEN ''approve_sale_exception'' THEN ''sales''' IN v_definition) = 0
    OR position('WHEN ''reject_sale_exception'' THEN ''sales''' IN v_definition) = 0
    OR position('''approve_sale_exception'',''reject_sale_exception'',''approve_stock_transfer''' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Could not add sale exception access rules.';
  END IF;
  EXECUTE v_definition;
END
$$;

DO $$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.access_module_for_table(text)'::regprocedure)
  INTO v_definition;
  IF position('sale_exception_requests' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'Sale exception table access mapping already exists; inspect function definition.';
  END IF;
  v_definition := replace(
    v_definition,
    'WHEN ''sale_items'' THEN ''sales''',
    'WHEN ''sale_exception_requests'' THEN ''sales'' WHEN ''sale_items'' THEN ''sales'''
  );
  IF position('WHEN ''sale_exception_requests'' THEN ''sales''' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Could not add sale exception table access mapping.';
  END IF;
  EXECUTE v_definition;
END
$$;

REVOKE ALL ON FUNCTION public.request_sale_exception(uuid,jsonb,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_sale_exception(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_sale_exception(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_sale_exception(uuid,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_sale_exception(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_sale_exception(uuid,uuid,text) TO authenticated;
