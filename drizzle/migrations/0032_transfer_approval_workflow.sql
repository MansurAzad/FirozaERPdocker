-- 0032_transfer_approval_workflow.sql
-- P2 — make the 0025/0026 stock-transfer approval workflow actually usable.
--
-- Background: create_stock_transfer() (0005) always inserted a transfer as
-- 'dispatched' and moved the stock right away, while request_transfer_approval()
-- only accepts a transfer in 'draft' status. Nothing ever created a draft, so
-- the whole approval workflow (request -> approve/reject -> receive) was dead.
--
-- This migration:
--   1. adds _dispatch_transfer(), the shared "move the stock" step
--   2. lets create_stock_transfer() create an approval-pending draft that does
--      not move stock yet
--   3. makes approve_stock_transfer() actually dispatch the stock
--   3. makes reject_stock_transfer() mark the transfer rejected
-- Existing direct transfers (no approval) behave exactly as before.

-- ---------------------------------------------------------------------------
-- 1) Dispatch helper (internal). Moves stock for an already-persisted transfer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._dispatch_transfer(_biz uuid, _id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t record;
  it record;
  v_stock integer;
BEGIN
  SELECT * INTO t FROM stock_transfers WHERE id = _id AND business_id = _biz FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid transfer.';
  END IF;

  FOR it IN SELECT * FROM stock_transfer_items WHERE transfer_id = _id ORDER BY id LOOP
    SELECT qty INTO v_stock
    FROM stock
    WHERE branch_id = t.from_branch_id AND variant_id = it.variant_id
    FOR UPDATE;

    IF COALESCE(v_stock, 0) < it.qty THEN
      RAISE EXCEPTION 'Insufficient stock (available %).', COALESCE(v_stock, 0);
    END IF;

    IF it.imei_id IS NOT NULL THEN
      UPDATE product_imeis SET status = 'RESERVED'
      WHERE id = it.imei_id AND branch_id = t.from_branch_id AND status = 'IN_STOCK';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'An IMEI is no longer in stock at the sending location.';
      END IF;
    END IF;

    INSERT INTO stock_movements(
      business_id, branch_id, variant_id, imei_id, qty_change, unit_cost, ref_type, ref_id
    ) VALUES (
      _biz, t.from_branch_id, it.variant_id, it.imei_id, -it.qty, it.unit_cost, 'transfer_out', _id
    );

    UPDATE stock SET qty = qty - it.qty, updated_at = now()
    WHERE branch_id = t.from_branch_id AND variant_id = it.variant_id;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) create_stock_transfer: optional approval gate.
--    _data.require_approval = true  -> create as 'draft', move no stock yet.
--    otherwise                      -> dispatch immediately (previous behaviour).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_stock_transfer(_biz uuid, _data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid; v_from uuid := (_data->>'from_branch_id')::uuid; v_to uuid := (_data->>'to_branch_id')::uuid;
  it jsonb; v_var uuid; v_qty int; v_avg numeric(14,2); v_serial boolean; v_ids jsonb; v_imei uuid; v_cost numeric(14,2);
  v_seq int; v_no text; v_n int := 0; v_approval boolean;
BEGIN
  IF NOT has_biz_role(_biz, ARRAY['owner','manager','store_keeper','branch_manager']::member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission to transfer stock.'; END IF;
  IF v_from = v_to THEN RAISE EXCEPTION 'Choose two different locations.'; END IF;
  IF (SELECT count(*) FROM branches WHERE id IN (v_from, v_to) AND business_id = _biz AND status = 'active') <> 2 THEN
    RAISE EXCEPTION 'Invalid branch.'; END IF;

  v_approval := COALESCE((_data->>'require_approval')::boolean, false);

  PERFORM pg_advisory_xact_lock(hashtext('trf_no_' || _biz::text));
  SELECT COALESCE(max(nullif(regexp_replace(transfer_no,'\D','','g'),'')::int),0)+1 INTO v_seq
  FROM stock_transfers WHERE business_id = _biz;
  v_no := 'TRF-' || lpad(v_seq::text, 6, '0');

  INSERT INTO stock_transfers(business_id, transfer_no, from_branch_id, to_branch_id, transfer_date, notes, status)
  VALUES (
    _biz, v_no, v_from, v_to,
    COALESCE((_data->>'transfer_date')::date, current_date),
    nullif(_data->>'notes',''),
    CASE WHEN v_approval THEN 'draft' ELSE 'dispatched' END
  ) RETURNING id INTO v_id;

  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(_data->'items','[]'::jsonb)) LOOP
    v_var := (it->>'variant_id')::uuid; v_qty := COALESCE((it->>'qty')::int,0);
    CONTINUE WHEN v_qty = 0;
    IF v_qty < 0 THEN RAISE EXCEPTION 'Invalid quantity.'; END IF;
    SELECT c.is_serialized INTO v_serial
    FROM product_variants pv JOIN products p ON p.id = pv.product_id JOIN categories c ON c.id = p.category_id
    WHERE pv.id = v_var AND pv.business_id = _biz;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid product.'; END IF;

    v_ids := COALESCE(it->'imei_ids','[]'::jsonb);
    IF v_serial THEN
      IF jsonb_array_length(v_ids) <> v_qty THEN RAISE EXCEPTION 'Select % IMEI(s) to transfer.', v_qty; END IF;
      FOR v_imei IN SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(v_ids) x LOOP
        SELECT cost INTO v_cost
        FROM product_imeis
        WHERE id = v_imei AND variant_id = v_var AND business_id = _biz
        FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'An IMEI is not valid for this product.'; END IF;
        INSERT INTO stock_transfer_items(business_id, transfer_id, variant_id, imei_id, qty, unit_cost)
        VALUES (_biz, v_id, v_var, v_imei, 1, v_cost);
      END LOOP;
    ELSE
      SELECT COALESCE(avg_cost, 0) INTO v_avg
      FROM stock WHERE branch_id = v_from AND variant_id = v_var FOR UPDATE;
      INSERT INTO stock_transfer_items(business_id, transfer_id, variant_id, qty, unit_cost)
      VALUES (_biz, v_id, v_var, v_qty, COALESCE(v_avg, 0));
    END IF;
    v_n := v_n + 1;
  END LOOP;

  IF v_n = 0 THEN RAISE EXCEPTION 'Add at least one product.'; END IF;

  -- Direct transfers move stock now; approval transfers wait for approve_stock_transfer().
  IF NOT v_approval THEN
    PERFORM public._dispatch_transfer(_biz, v_id);
  END IF;

  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 3) approve_stock_transfer: now performs the dispatch and moves stock.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_stock_transfer(
  _transfer_id uuid,
  _comments text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  transfer_rec stock_transfers%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.stock_transfers t
    WHERE t.id = _transfer_id
      AND public.has_biz_role(t.business_id, ARRAY['owner','manager','branch_manager']::public.member_role[])
  ) THEN
    RAISE EXCEPTION 'You are not authorized to approve transfers.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO transfer_rec FROM stock_transfers WHERE id = _transfer_id;
  IF transfer_rec IS NULL THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;
  IF transfer_rec.status != 'pending_approval' THEN
    RAISE EXCEPTION 'Transfer must be pending approval';
  END IF;

  PERFORM public._dispatch_transfer(transfer_rec.business_id, _transfer_id);

  UPDATE stock_transfers
  SET
    status = 'dispatched',
    approved_by = auth.uid(),
    approved_at = now(),
    updated_at = now()
  WHERE id = _transfer_id;

  INSERT INTO stock_transfer_approvals (business_id, transfer_id, action, approved_by, comments)
  VALUES (transfer_rec.business_id, _transfer_id, 'approve', auth.uid(), _comments);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) reject_stock_transfer: mark rejected (no stock was moved).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_stock_transfer(
  _transfer_id uuid,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  transfer_rec stock_transfers%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.stock_transfers t
    WHERE t.id = _transfer_id
      AND public.has_biz_role(t.business_id, ARRAY['owner','manager','branch_manager']::public.member_role[])
  ) THEN
    RAISE EXCEPTION 'You are not authorized to approve transfers.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO transfer_rec FROM stock_transfers WHERE id = _transfer_id;
  IF transfer_rec IS NULL THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;
  IF transfer_rec.status != 'pending_approval' THEN
    RAISE EXCEPTION 'Transfer must be pending approval';
  END IF;
  IF _reason IS NULL OR trim(_reason) = '' THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  UPDATE stock_transfers
  SET
    status = 'rejected',
    rejected_by = auth.uid(),
    rejected_at = now(),
    rejection_reason = _reason,
    updated_at = now()
  WHERE id = _transfer_id;

  INSERT INTO stock_transfer_approvals (business_id, transfer_id, action, approved_by, comments)
  VALUES (transfer_rec.business_id, _transfer_id, 'reject', auth.uid(), _reason);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) Privileges
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._dispatch_transfer(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._dispatch_transfer(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.approve_stock_transfer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_stock_transfer(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.reject_stock_transfer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_stock_transfer(uuid, text) TO authenticated;

-- Fast lookup of transfers awaiting approval.
CREATE INDEX IF NOT EXISTS idx_stock_transfers_pending
  ON public.stock_transfers(business_id, created_at DESC) WHERE status = 'pending_approval';

COMMENT ON FUNCTION public._dispatch_transfer(uuid, uuid) IS 'Internal: moves stock for a persisted transfer (called by create/approve)';
COMMENT ON FUNCTION public.create_stock_transfer(uuid, jsonb) IS 'Create a transfer; _data.require_approval=true creates a draft that needs approval before stock moves';
COMMENT ON FUNCTION public.approve_stock_transfer(uuid, text) IS 'Approve a pending transfer and dispatch its stock';
COMMENT ON FUNCTION public.reject_stock_transfer(uuid, text) IS 'Reject a pending transfer (no stock movement)';
