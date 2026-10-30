CREATE OR REPLACE FUNCTION public.enforce_shop_transfer_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business uuid;
  v_from uuid;
  v_to uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_business := NEW.business_id;
    v_from := NEW.from_branch_id;
    v_to := NEW.to_branch_id;
    IF NOT public.can_access_shop_branch(v_business, v_from)
      OR NOT public.can_access_shop_branch(v_business, v_to) THEN
      RAISE EXCEPTION 'You must have access to both shops in this stock transfer.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.business_id = v_business
        AND b.id IN (v_from, v_to)
        AND b.status <> 'active'
    ) THEN
      RAISE EXCEPTION 'Stock transfers require active brand shops.';
    END IF;
    RETURN NEW;
  END IF;

  v_business := OLD.business_id;
  v_from := OLD.from_branch_id;
  v_to := OLD.to_branch_id;

  IF TG_OP = 'DELETE' THEN
    IF NOT public.can_access_shop_branch(v_business, v_from)
      OR NOT public.can_access_shop_branch(v_business, v_to) THEN
      RAISE EXCEPTION 'You must have access to both shops in this stock transfer.';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.business_id IS DISTINCT FROM OLD.business_id
    OR NEW.from_branch_id IS DISTINCT FROM OLD.from_branch_id
    OR NEW.to_branch_id IS DISTINCT FROM OLD.to_branch_id THEN
    RAISE EXCEPTION 'Transfer business and locations cannot be changed.';
  END IF;

  IF OLD.status = 'dispatched' AND NEW.status = 'received' THEN
    IF NOT public.can_access_shop_branch(v_business, v_to) THEN
      RAISE EXCEPTION 'Only staff assigned to the receiving shop can receive this transfer.';
    END IF;
  ELSIF (
    OLD.status = 'draft' AND NEW.status = 'pending_approval'
  ) OR (
    OLD.status = 'pending_approval' AND NEW.status IN ('dispatched', 'rejected')
  ) THEN
    IF NOT public.can_access_shop_branch(v_business, v_from) THEN
      RAISE EXCEPTION 'Only staff assigned to the sending shop can review this transfer.';
    END IF;
  ELSIF NOT public.can_access_shop_branch(v_business, v_from)
    AND NOT public.can_access_shop_branch(v_business, v_to) THEN
    RAISE EXCEPTION 'You must have access to one of the shops in this stock transfer.';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.get_pending_transfer_approvals(_biz uuid)
RETURNS TABLE (
  transfer_id uuid,
  from_branch_name text,
  to_branch_name text,
  item_count integer,
  total_value numeric,
  requested_by text,
  requested_at timestamptz,
  notes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_member(_biz)
    OR NOT public.has_module_access(_biz, 'transfers', 'view') THEN
    RAISE EXCEPTION 'You do not have access to transfer approvals.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    st.id,
    fb.name,
    tb.name,
    count(sti.id)::integer,
    COALESCE(sum(sti.qty * pv.purchase_price), 0),
    u.raw_user_meta_data->>'full_name',
    st.created_at,
    st.notes
  FROM public.stock_transfers st
  JOIN public.branches fb ON fb.business_id = st.business_id AND fb.id = st.from_branch_id
  JOIN public.branches tb ON tb.business_id = st.business_id AND tb.id = st.to_branch_id
  JOIN public.stock_transfer_items sti ON sti.business_id = st.business_id AND sti.transfer_id = st.id
  JOIN public.product_variants pv ON pv.business_id = sti.business_id AND pv.id = sti.variant_id
  LEFT JOIN auth.users u ON u.id = st.created_by
  WHERE st.business_id = _biz
    AND st.status = 'pending_approval'
    AND public.can_access_shop_branch(_biz, st.from_branch_id)
  GROUP BY st.id, fb.name, tb.name, u.raw_user_meta_data, st.created_at, st.notes
  ORDER BY st.created_at DESC;
END
$$;
REVOKE ALL ON FUNCTION public.get_pending_transfer_approvals(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pending_transfer_approvals(uuid) TO authenticated;

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
    ARRAY['owner','manager','accountant','store_keeper','branch_manager']::public.member_role[]
  ) OR NOT (
    public.has_module_access(_biz, 'stock_adjustments', 'create')
    OR public.has_module_access(_biz, 'stock_adjustments', 'edit')
  ) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;
  IF v_type NOT IN ('increase', 'decrease', 'recount') THEN
    RAISE EXCEPTION 'Invalid adjustment type.';
  END IF;
  IF v_branch IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.branches
      WHERE id = v_branch AND business_id = _biz AND status = 'active'
    )
    OR NOT public.can_access_shop_branch(_biz, v_branch) THEN
    RAISE EXCEPTION 'Choose a valid shop you are assigned to.';
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
END
$$;

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
    ARRAY['owner','manager','accountant','store_keeper','branch_manager']::public.member_role[]
  ) OR NOT public.has_module_access(_biz, 'stock_adjustments', 'approve') THEN
    RAISE EXCEPTION 'You do not have permission to post stock adjustments.';
  END IF;

  SELECT status, branch_id INTO v_status, v_branch
  FROM public.stock_adjustments
  WHERE id = _id AND business_id = _biz
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Adjustment not found.';
  END IF;
  IF NOT public.can_access_shop_branch(_biz, v_branch) THEN
    RAISE EXCEPTION 'You do not have access to this shop.';
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
END
$$;

REVOKE ALL ON FUNCTION public.save_stock_adjustment(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_stock_adjustment(uuid, uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.post_stock_adjustment(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_stock_adjustment(uuid, uuid) TO authenticated;

COMMIT;
