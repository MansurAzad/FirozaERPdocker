ALTER TABLE public.sales
  ADD COLUMN field_sales_trip_id uuid;
ALTER TABLE public.customer_payments
  ADD COLUMN field_sales_trip_id uuid;
ALTER TABLE public.product_imeis
  ADD COLUMN field_sales_trip_id uuid;

CREATE OR REPLACE FUNCTION public.force_device_serialized()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.name ~* '(feature[ -]?phone|button[ -]?phone|ফিচার ফোন|বাটন ফোন)' THEN
    NEW.is_serialized := false;
  ELSIF NEW.name ~* '(mobile|phone|smartphone|tab|tablet|ipad|watch|মোবাইল|ফোন|ট্যাব)' THEN
    NEW.is_serialized := true;
  END IF;
  RETURN NEW;
END $$;
UPDATE public.categories SET is_serialized=false
WHERE name ~* '(feature[ -]?phone|button[ -]?phone|ফিচার ফোন|বাটন ফোন)' AND is_serialized;

CREATE TABLE public.field_sales_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  salesman_user_id uuid NOT NULL REFERENCES auth.users(id),
  salesman_id uuid NOT NULL REFERENCES public.salesmen(id),
  stock_branch_id uuid NOT NULL REFERENCES public.branches(id),
  sales_branch_id uuid NOT NULL REFERENCES public.branches(id),
  cash_account_id uuid NOT NULL REFERENCES public.money_accounts(id),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','settlement_pending','settled','cancelled')),
  opened_by uuid NOT NULL DEFAULT auth.uid(),
  opened_at timestamptz NOT NULL DEFAULT now(),
  settled_by uuid,
  settled_at timestamptz,
  UNIQUE (business_id, id)
);
CREATE UNIQUE INDEX field_sales_one_open_trip_per_salesman
  ON public.field_sales_trips (business_id, salesman_user_id)
  WHERE status IN ('open','settlement_pending');
CREATE INDEX field_sales_trips_salesman_date_idx
  ON public.field_sales_trips (business_id, salesman_user_id, opened_at DESC);

CREATE TABLE public.field_sales_trip_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES public.field_sales_trips(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id),
  qty_issued integer NOT NULL CHECK (qty_issued > 0),
  qty_returned integer NOT NULL DEFAULT 0 CHECK (qty_returned >= 0),
  qty_damaged integer NOT NULL DEFAULT 0 CHECK (qty_damaged >= 0),
  unit_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  UNIQUE (business_id, id),
  UNIQUE (trip_id, variant_id)
);
ALTER TABLE public.field_sales_trip_items
  ADD CONSTRAINT field_sales_trip_items_trip_biz_fkey
  FOREIGN KEY (business_id, trip_id)
  REFERENCES public.field_sales_trips(business_id, id) ON DELETE CASCADE;
CREATE TABLE public.field_sales_trip_imeis (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES public.field_sales_trips(id) ON DELETE CASCADE,
  trip_item_id uuid NOT NULL REFERENCES public.field_sales_trip_items(id) ON DELETE CASCADE,
  imei_id uuid NOT NULL REFERENCES public.product_imeis(id),
  status text NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued','sold','return_pending','damage_pending','returned','damaged')),
  PRIMARY KEY (business_id, imei_id)
);
ALTER TABLE public.product_imeis ADD CONSTRAINT product_imeis_business_id_id_key UNIQUE (business_id,id);
ALTER TABLE public.field_sales_trip_imeis
  ADD CONSTRAINT field_sales_trip_imeis_trip_biz_fkey
    FOREIGN KEY (business_id,trip_id)
    REFERENCES public.field_sales_trips(business_id,id) ON DELETE CASCADE,
  ADD CONSTRAINT field_sales_trip_imeis_item_biz_fkey
    FOREIGN KEY (business_id,trip_item_id)
    REFERENCES public.field_sales_trip_items(business_id,id) ON DELETE CASCADE,
  ADD CONSTRAINT field_sales_trip_imeis_imei_biz_fkey
    FOREIGN KEY (business_id,imei_id)
    REFERENCES public.product_imeis(business_id,id);
CREATE INDEX field_sales_trip_imeis_trip_idx
  ON public.field_sales_trip_imeis (business_id, trip_id, status);

CREATE TABLE public.field_sales_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES public.field_sales_trips(id) ON DELETE CASCADE,
  submitted_by uuid NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  cash_counted numeric(14,2) NOT NULL CHECK (cash_counted >= 0),
  deposit_account_id uuid NOT NULL REFERENCES public.money_accounts(id),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  transfer_ref uuid,
  UNIQUE (business_id, id)
);
ALTER TABLE public.field_sales_settlements
  ADD CONSTRAINT field_sales_settlements_trip_biz_fkey
  FOREIGN KEY (business_id,trip_id)
  REFERENCES public.field_sales_trips(business_id,id) ON DELETE CASCADE;
CREATE UNIQUE INDEX field_sales_one_pending_settlement
  ON public.field_sales_settlements (trip_id) WHERE status = 'pending';
CREATE TABLE public.field_sales_settlement_items (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  settlement_id uuid NOT NULL REFERENCES public.field_sales_settlements(id) ON DELETE CASCADE,
  trip_item_id uuid NOT NULL REFERENCES public.field_sales_trip_items(id),
  good_qty integer NOT NULL DEFAULT 0 CHECK (good_qty >= 0),
  damaged_qty integer NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
  PRIMARY KEY (settlement_id, trip_item_id)
);
ALTER TABLE public.field_sales_settlement_items
  ADD CONSTRAINT field_sales_settlement_items_settlement_biz_fkey
    FOREIGN KEY (business_id,settlement_id)
    REFERENCES public.field_sales_settlements(business_id,id) ON DELETE CASCADE,
  ADD CONSTRAINT field_sales_settlement_items_trip_item_biz_fkey
    FOREIGN KEY (business_id,trip_item_id)
    REFERENCES public.field_sales_trip_items(business_id,id);

ALTER TABLE public.sales
  ADD CONSTRAINT sales_field_sales_trip_fkey
  FOREIGN KEY (business_id, field_sales_trip_id)
  REFERENCES public.field_sales_trips(business_id, id);
ALTER TABLE public.customer_payments
  ADD CONSTRAINT customer_payments_field_sales_trip_fkey
  FOREIGN KEY (business_id, field_sales_trip_id)
  REFERENCES public.field_sales_trips(business_id, id);
ALTER TABLE public.product_imeis
  ADD CONSTRAINT product_imeis_field_sales_trip_fkey
  FOREIGN KEY (business_id, field_sales_trip_id)
  REFERENCES public.field_sales_trips(business_id, id);

CREATE OR REPLACE FUNCTION public.can_view_field_sales_trip(_biz uuid,_trip uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_member(_biz) AND EXISTS (
    SELECT 1 FROM public.field_sales_trips t
    WHERE t.business_id=_biz AND t.id=_trip
      AND (
        t.salesman_user_id=auth.uid()
        OR public.has_biz_role(_biz,ARRAY['owner','manager','accountant','store_keeper']::public.member_role[])
        OR (
          public.has_biz_role(_biz,ARRAY['branch_manager']::public.member_role[])
          AND public.can_access_shop_branch(_biz,t.sales_branch_id)
        )
      )
  )
$$;
REVOKE ALL ON FUNCTION public.can_view_field_sales_trip(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_field_sales_trip(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_field_sales_trip_summary(_biz uuid,_trip uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_summary jsonb;
BEGIN
  IF NOT public.can_view_field_sales_trip(_biz,_trip) THEN
    RAISE EXCEPTION 'You do not have access to this field-sales trip.';
  END IF;
  SELECT jsonb_build_object(
    'expected_cash',
    m.opening_balance+coalesce(sum(CASE WHEN mt.direction='in' THEN mt.amount ELSE -mt.amount END),0)
  ) INTO v_summary
  FROM public.field_sales_trips t
  JOIN public.money_accounts m ON m.business_id=t.business_id AND m.id=t.cash_account_id
  LEFT JOIN public.money_transactions mt ON mt.business_id=t.business_id AND mt.account_id=m.id
  WHERE t.business_id=_biz AND t.id=_trip
  GROUP BY m.opening_balance;
  RETURN coalesce(v_summary,jsonb_build_object('expected_cash',0));
END $$;

CREATE OR REPLACE FUNCTION public.get_field_sales_deposit_accounts(_biz uuid,_trip uuid)
RETURNS TABLE(id uuid,name text,kind public.money_kind,branch_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.can_view_field_sales_trip(_biz,_trip) THEN
    RAISE EXCEPTION 'You do not have access to this field-sales trip.';
  END IF;
  RETURN QUERY
  SELECT m.id,m.name,m.kind,m.branch_id
  FROM public.money_accounts m
  JOIN public.field_sales_trips t ON t.business_id=m.business_id
  WHERE t.business_id=_biz AND t.id=_trip AND m.status='active'
    AND m.id<>t.cash_account_id
    AND (m.branch_id IS NULL OR m.branch_id=t.sales_branch_id)
  ORDER BY m.name;
END $$;
REVOKE ALL ON FUNCTION public.get_field_sales_trip_summary(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_field_sales_deposit_accounts(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_field_sales_trip_summary(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_field_sales_deposit_accounts(uuid,uuid) TO authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'field_sales_trips','field_sales_trip_items','field_sales_trip_imeis',
    'field_sales_settlements','field_sales_settlement_items'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
    EXECUTE format(
      'CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.audit_row()',t,t
    );
    EXECUTE format(
      'CREATE TRIGGER guard_%I BEFORE INSERT OR UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.guard_business_module_write()',t,t
    );
  END LOOP;
END
$$;
CREATE POLICY field_sales_trips_read ON public.field_sales_trips
  FOR SELECT TO authenticated USING (public.can_view_field_sales_trip(business_id,id));
CREATE POLICY field_sales_trip_items_read ON public.field_sales_trip_items
  FOR SELECT TO authenticated USING (public.can_view_field_sales_trip(business_id,trip_id));
CREATE POLICY field_sales_trip_imeis_read ON public.field_sales_trip_imeis
  FOR SELECT TO authenticated USING (public.can_view_field_sales_trip(business_id,trip_id));
CREATE POLICY field_sales_product_imeis_read ON public.product_imeis
  FOR SELECT TO authenticated USING (
    field_sales_trip_id IS NOT NULL
    AND public.can_view_field_sales_trip(business_id,field_sales_trip_id)
  );
CREATE POLICY field_sales_settlements_read ON public.field_sales_settlements
  FOR SELECT TO authenticated USING (public.can_view_field_sales_trip(business_id,trip_id));
CREATE POLICY field_sales_settlement_items_read ON public.field_sales_settlement_items
  FOR SELECT TO authenticated USING (
    public.is_member(business_id) AND EXISTS (
      SELECT 1 FROM public.field_sales_settlements s
      WHERE s.business_id=field_sales_settlement_items.business_id
        AND s.id=field_sales_settlement_items.settlement_id
        AND public.can_view_field_sales_trip(s.business_id,s.trip_id)
    )
  );

CREATE OR REPLACE FUNCTION public.create_field_sales_trip(_biz uuid, _data jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := nullif(_data->>'salesman_user_id','')::uuid;
  v_stock_branch uuid := nullif(_data->>'stock_branch_id','')::uuid;
  v_sales_branch uuid := nullif(_data->>'sales_branch_id','')::uuid;
  v_salesman uuid;
  v_trip uuid;
  v_item jsonb;
  v_variant uuid;
  v_qty integer;
  v_cost numeric(14,2);
  v_serial boolean;
  v_ids jsonb;
  v_imei uuid;
  v_item_id uuid;
  v_count integer;
  v_cash_account uuid;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager','store_keeper']::public.member_role[])
    OR NOT public.has_module_access(_biz,'transfers','create') THEN
    RAISE EXCEPTION 'You do not have permission to issue field-sales stock.';
  END IF;
  IF jsonb_typeof(_data->'items') IS DISTINCT FROM 'array'
    OR jsonb_array_length(coalesce(_data->'items','[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Add at least one product.';
  END IF;
  SELECT s.id INTO v_salesman
  FROM public.salesmen s
  JOIN public.business_members bm
    ON bm.business_id = s.business_id AND bm.user_id = s.user_id
  WHERE s.business_id = _biz AND s.user_id = v_user
    AND s.status = 'active' AND bm.role = 'salesman';
  IF v_salesman IS NULL THEN
    RAISE EXCEPTION 'Select an active salesman linked to a salesman team account.';
  END IF;
  IF v_stock_branch IS NULL OR v_sales_branch IS NULL OR v_stock_branch = v_sales_branch THEN
    RAISE EXCEPTION 'Choose a stock house and a different sales shop.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches
    WHERE business_id = _biz AND id = v_stock_branch AND status = 'active'
      AND kind IN ('warehouse','head')
  ) OR NOT EXISTS (
    SELECT 1 FROM public.branches
    WHERE business_id = _biz AND id = v_sales_branch AND status = 'active'
      AND kind = 'branch'
  ) THEN
    RAISE EXCEPTION 'Select an active stock house and sales shop.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.partner_finance_branch_access
    WHERE business_id = _biz AND user_id = v_user AND branch_id = v_sales_branch
  ) THEN
    RAISE EXCEPTION 'Assign the salesman to this shop before opening a trip.';
  END IF;
  INSERT INTO public.money_accounts(
    business_id, kind, name, ledger_account_id, branch_id
  )
  VALUES (
    _biz, 'cash', 'Field trip ' || left(gen_random_uuid()::text,8) || ' — ' ||
      (SELECT display_name FROM public.business_members WHERE business_id=_biz AND user_id=v_user),
    public.acct(_biz,'1010'), v_sales_branch
  )
  RETURNING id INTO v_cash_account;

  INSERT INTO public.field_sales_trips(
    business_id, salesman_user_id, salesman_id, stock_branch_id, sales_branch_id, cash_account_id
  ) VALUES (_biz,v_user,v_salesman,v_stock_branch,v_sales_branch,v_cash_account)
  RETURNING id INTO v_trip;

  FOR v_item IN SELECT * FROM jsonb_array_elements(_data->'items') LOOP
    v_variant := nullif(v_item->>'variant_id','')::uuid;
    v_qty := nullif(v_item->>'qty','')::integer;
    IF v_variant IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Enter a valid product quantity.';
    END IF;
    SELECT c.is_serialized INTO v_serial
    FROM public.product_variants pv
    JOIN public.products p ON p.business_id=pv.business_id AND p.id=pv.product_id
    JOIN public.categories c ON c.business_id=p.business_id AND c.id=p.category_id
    WHERE pv.business_id=_biz AND pv.id=v_variant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid product.'; END IF;
    SELECT qty, avg_cost INTO v_count, v_cost
    FROM public.stock WHERE business_id=_biz AND branch_id=v_stock_branch
      AND variant_id=v_variant FOR UPDATE;
    IF coalesce(v_count,0) < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock (available %).', coalesce(v_count,0);
    END IF;
    v_ids := coalesce(v_item->'imei_ids','[]'::jsonb);
    IF v_serial AND jsonb_array_length(v_ids) <> v_qty THEN
      RAISE EXCEPTION 'Scan exactly % IMEI(s) for this product.',v_qty;
    ELSIF NOT v_serial AND jsonb_array_length(v_ids) > 0 THEN
      RAISE EXCEPTION 'This product is quantity-tracked, not IMEI-tracked.';
    END IF;
    INSERT INTO public.field_sales_trip_items(
      business_id,trip_id,variant_id,qty_issued,unit_cost
    ) VALUES (_biz,v_trip,v_variant,v_qty,coalesce(v_cost,0))
    RETURNING id INTO v_item_id;
    IF v_serial THEN
      FOR v_imei IN SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(v_ids) x LOOP
        UPDATE public.product_imeis
        SET status='RESERVED',field_sales_trip_id=v_trip
        WHERE business_id=_biz AND id=v_imei AND variant_id=v_variant
          AND branch_id=v_stock_branch AND status='IN_STOCK'
          AND field_sales_trip_id IS NULL;
        IF NOT FOUND THEN RAISE EXCEPTION 'IMEI is invalid or not available in this stock house.'; END IF;
        INSERT INTO public.field_sales_trip_imeis(business_id,trip_id,trip_item_id,imei_id)
        VALUES (_biz,v_trip,v_item_id,v_imei);
      END LOOP;
    END IF;
    UPDATE public.stock SET qty=qty-v_qty,updated_at=now()
    WHERE business_id=_biz AND branch_id=v_stock_branch AND variant_id=v_variant;
    INSERT INTO public.stock_movements(
      business_id,branch_id,variant_id,qty_change,unit_cost,ref_type,ref_id
    ) VALUES (_biz,v_stock_branch,v_variant,-v_qty,coalesce(v_cost,0),'field_sales_issue',v_trip);
  END LOOP;
  RETURN v_trip;
END $$;

CREATE OR REPLACE FUNCTION public.create_field_sales_sale(_biz uuid,_trip uuid,_data jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_trip public.field_sales_trips%ROWTYPE;
  v_item jsonb;
  v_variant uuid;
  v_qty integer;
  v_serial boolean;
  v_ids jsonb;
  v_imei uuid;
  v_available integer;
  v_sale uuid;
BEGIN
  SELECT * INTO v_trip FROM public.field_sales_trips
  WHERE business_id=_biz AND id=_trip AND salesman_user_id=auth.uid()
    AND status='open' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No open field-sales trip was found.'; END IF;
  IF NOT public.has_module_access(_biz,'sales','create') THEN
    RAISE EXCEPTION 'You do not have permission to record field sales.';
  END IF;
  IF jsonb_typeof(coalesce(_data->'payments','[]'::jsonb)) IS DISTINCT FROM 'array'
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(_data->'payments','[]'::jsonb)) p
      WHERE p->>'method' IS DISTINCT FROM 'cash'
    ) THEN
    RAISE EXCEPTION 'Field-trip sales currently accept cash only; record non-cash collections in the matching shop account.';
  END IF;
  IF jsonb_typeof(_data->'items') IS DISTINCT FROM 'array'
    OR jsonb_array_length(coalesce(_data->'items','[]'::jsonb))=0 THEN
    RAISE EXCEPTION 'Add at least one product.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_data->'items') x
    GROUP BY x->>'variant_id' HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'Combine duplicate product lines before saving.'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(_data->'items') LOOP
    v_variant := nullif(v_item->>'variant_id','')::uuid;
    v_qty := nullif(v_item->>'qty','')::integer;
    IF v_variant IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'Invalid sale item.'; END IF;
    SELECT c.is_serialized INTO v_serial
    FROM public.product_variants pv
    JOIN public.products p ON p.business_id=pv.business_id AND p.id=pv.product_id
    JOIN public.categories c ON c.business_id=p.business_id AND c.id=p.category_id
    WHERE pv.business_id=_biz AND pv.id=v_variant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid product.'; END IF;
    SELECT fti.qty_issued-fti.qty_returned-fti.qty_damaged
      - coalesce((SELECT sum(si.qty) FROM public.sales s
        JOIN public.sale_items si ON si.business_id=s.business_id AND si.sale_id=s.id
        WHERE s.business_id=_biz AND s.field_sales_trip_id=_trip AND s.status='posted'
          AND si.variant_id=v_variant),0)
    INTO v_available
    FROM public.field_sales_trip_items fti
    WHERE fti.business_id=_biz AND fti.trip_id=_trip AND fti.variant_id=v_variant
    FOR UPDATE;
    IF v_available IS NULL OR v_qty > v_available THEN
      RAISE EXCEPTION 'Sale quantity exceeds this trip''s remaining stock.';
    END IF;
    v_ids := coalesce(v_item->'imei_ids','[]'::jsonb);
    IF v_serial AND jsonb_array_length(v_ids) <> v_qty THEN
      RAISE EXCEPTION 'Select % issued IMEI(s).',v_qty;
    ELSIF NOT v_serial AND jsonb_array_length(v_ids)>0 THEN
      RAISE EXCEPTION 'Do not provide IMEIs for quantity-tracked products.';
    END IF;
    IF v_serial THEN
      FOR v_imei IN SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(v_ids) x LOOP
        IF NOT EXISTS (
          SELECT 1 FROM public.field_sales_trip_imeis
          WHERE business_id=_biz AND trip_id=_trip AND imei_id=v_imei AND status='issued'
          FOR UPDATE
        ) THEN RAISE EXCEPTION 'IMEI is not in this salesman''s available stock.'; END IF;
      END LOOP;
    END IF;
    UPDATE public.product_imeis SET branch_id=v_trip.sales_branch_id,status='IN_STOCK'
    WHERE business_id=_biz AND id IN (
      SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(v_ids) x
    ) AND status='RESERVED' AND field_sales_trip_id=_trip;
    INSERT INTO public.stock(business_id,branch_id,variant_id,qty,avg_cost)
    VALUES (_biz,v_trip.sales_branch_id,v_variant,v_qty,
      (SELECT unit_cost FROM public.field_sales_trip_items
       WHERE business_id=_biz AND trip_id=_trip AND variant_id=v_variant))
    ON CONFLICT (branch_id,variant_id)
    DO UPDATE SET
      avg_cost=CASE WHEN public.stock.qty+EXCLUDED.qty>0
        THEN round((public.stock.qty*public.stock.avg_cost+EXCLUDED.qty*EXCLUDED.avg_cost)
          /(public.stock.qty+EXCLUDED.qty),2)
        ELSE public.stock.avg_cost END,
      qty=public.stock.qty+EXCLUDED.qty,updated_at=now();
    IF NOT v_serial AND jsonb_array_length(v_ids)>0 THEN RAISE EXCEPTION 'Invalid IMEI payload.'; END IF;
  END LOOP;

  _data := jsonb_set(_data,'{branch_id}',to_jsonb(v_trip.sales_branch_id::text),true);
  _data := jsonb_set(_data,'{payments}',coalesce((
    SELECT jsonb_agg(jsonb_set(p,'{account_id}',to_jsonb(v_trip.cash_account_id::text),true))
    FROM jsonb_array_elements(coalesce(_data->'payments','[]'::jsonb)) p
  ),'[]'::jsonb),true);
  v_sale := public.create_sale(_biz,_data);
  UPDATE public.sales SET field_sales_trip_id=_trip
  WHERE business_id=_biz AND id=v_sale;
  UPDATE public.field_sales_trip_imeis fsi SET status='sold'
  FROM public.sale_items si
  WHERE si.business_id=_biz AND si.sale_id=v_sale AND si.imei_id=fsi.imei_id
    AND fsi.business_id=_biz AND fsi.trip_id=_trip;
  INSERT INTO public.stock_movements(
    business_id,branch_id,variant_id,qty_change,unit_cost,ref_type,ref_id
  )
  SELECT _biz,v_trip.sales_branch_id,si.variant_id,sum(si.qty),
    coalesce(max(si.unit_cost),0),'field_sales_sale_offset',v_sale
  FROM public.sale_items si WHERE si.business_id=_biz AND si.sale_id=v_sale
  GROUP BY si.variant_id;
  RETURN v_sale;
END $$;

CREATE OR REPLACE FUNCTION public.collect_field_sales_payment(
  _biz uuid,_trip uuid,_customer uuid,_amount numeric,_date date,
  _method public.payment_method,_txn_ref text,_note text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.field_sales_trips%ROWTYPE; v_id uuid;
BEGIN
  SELECT * INTO t FROM public.field_sales_trips
  WHERE business_id=_biz AND id=_trip AND salesman_user_id=auth.uid() AND status='open'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No open field-sales trip was found.'; END IF;
  IF _method IS DISTINCT FROM 'cash' THEN RAISE EXCEPTION 'Field-trip due collection currently accepts cash only.'; END IF;
  v_id := public.receive_customer_payment_for_branch(
    _biz,_customer,t.sales_branch_id,t.cash_account_id,_amount,_date,_method,_txn_ref,_note
  );
  UPDATE public.customer_payments SET field_sales_trip_id=_trip
  WHERE business_id=_biz AND id=v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.submit_field_sales_settlement(
  _biz uuid,_trip uuid,_returns jsonb,_cash_counted numeric,_deposit_account uuid,_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  t public.field_sales_trips%ROWTYPE;
  si jsonb;
  ti public.field_sales_trip_items%ROWTYPE;
  v_good integer;
  v_damaged integer;
  v_serial boolean;
  v_id uuid;
  v_imei uuid;
BEGIN
  SELECT * INTO t FROM public.field_sales_trips
  WHERE business_id=_biz AND id=_trip AND salesman_user_id=auth.uid() AND status='open'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No open field-sales trip can be settled.'; END IF;
  IF jsonb_typeof(_returns) IS DISTINCT FROM 'array'
    OR length(btrim(coalesce(_reason,''))) NOT BETWEEN 1 AND 1000
    OR _cash_counted IS NULL OR _cash_counted<0 THEN
    RAISE EXCEPTION 'Enter valid returns, a cash count and a settlement note.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.money_accounts
    WHERE business_id=_biz AND id=_deposit_account AND status='active'
      AND id<>t.cash_account_id) THEN RAISE EXCEPTION 'Select an active deposit account.'; END IF;
  INSERT INTO public.field_sales_settlements(
    business_id,trip_id,submitted_by,cash_counted,deposit_account_id,reason
  ) VALUES (_biz,_trip,auth.uid(),_cash_counted,_deposit_account,btrim(_reason))
  RETURNING id INTO v_id;

  FOR si IN SELECT * FROM jsonb_array_elements(_returns) LOOP
    SELECT * INTO ti FROM public.field_sales_trip_items
    WHERE business_id=_biz AND trip_id=_trip
      AND variant_id=(si->>'variant_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Returned product was not issued on this trip.'; END IF;
    SELECT c.is_serialized INTO v_serial
    FROM public.product_variants pv JOIN public.products p ON p.id=pv.product_id
    JOIN public.categories c ON c.id=p.category_id WHERE pv.id=ti.variant_id;
    v_good := coalesce((si->>'good_qty')::integer,0);
    v_damaged := coalesce((si->>'damaged_qty')::integer,0);
    IF v_good<0 OR v_damaged<0 THEN RAISE EXCEPTION 'Invalid return quantity.'; END IF;
    IF v_serial THEN
      FOR v_imei IN SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(coalesce(si->'good_imei_ids','[]'::jsonb)) x LOOP
        UPDATE public.field_sales_trip_imeis SET status='return_pending'
        WHERE business_id=_biz AND trip_id=_trip AND imei_id=v_imei AND status='issued';
        IF NOT FOUND THEN RAISE EXCEPTION 'Good-return IMEI is invalid or already used.'; END IF;
      END LOOP;
      IF (SELECT count(*) FROM public.field_sales_trip_imeis
        WHERE business_id=_biz AND trip_id=_trip AND trip_item_id=ti.id AND status='return_pending')
        < jsonb_array_length(coalesce(si->'good_imei_ids','[]'::jsonb)) THEN
        RAISE EXCEPTION 'Invalid good-return IMEI list.';
      END IF;
      FOR v_imei IN SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(coalesce(si->'damaged_imei_ids','[]'::jsonb)) x LOOP
        UPDATE public.field_sales_trip_imeis SET status='damage_pending'
        WHERE business_id=_biz AND trip_id=_trip AND imei_id=v_imei AND status='issued';
        IF NOT FOUND THEN RAISE EXCEPTION 'Damaged IMEI is invalid or already used.'; END IF;
      END LOOP;
      IF v_good<>jsonb_array_length(coalesce(si->'good_imei_ids','[]'::jsonb))
        OR v_damaged<>jsonb_array_length(coalesce(si->'damaged_imei_ids','[]'::jsonb)) THEN
        RAISE EXCEPTION 'IMEI counts do not match the return quantities.';
      END IF;
    END IF;
    INSERT INTO public.field_sales_settlement_items(
      business_id,settlement_id,trip_item_id,good_qty,damaged_qty
    ) VALUES (_biz,v_id,ti.id,v_good,v_damaged);
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.field_sales_trip_items ti
    WHERE ti.business_id=_biz AND ti.trip_id=_trip
      AND ti.qty_issued-ti.qty_returned-ti.qty_damaged-
        coalesce((SELECT sum(si.qty) FROM public.sales s
          JOIN public.sale_items si ON si.business_id=s.business_id AND si.sale_id=s.id
          WHERE s.field_sales_trip_id=_trip AND s.status='posted'
            AND si.variant_id=ti.variant_id),0) <>
        coalesce((SELECT good_qty+damaged_qty FROM public.field_sales_settlement_items
          WHERE settlement_id=v_id AND trip_item_id=ti.id),0)
  ) THEN RAISE EXCEPTION 'Every remaining unit must be returned or declared damaged.'; END IF;
  IF EXISTS (SELECT 1 FROM public.field_sales_trip_imeis
    WHERE business_id=_biz AND trip_id=_trip AND status='issued') THEN
    RAISE EXCEPTION 'Scan every remaining issued IMEI as good return or damaged.';
  END IF;
  UPDATE public.field_sales_trips SET status='settlement_pending' WHERE business_id=_biz AND id=_trip;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.approve_field_sales_settlement(_biz uuid,_trip uuid,_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  t public.field_sales_trips%ROWTYPE;
  s public.field_sales_settlements%ROWTYPE;
  r record;
  v_balance numeric(14,2);
  v_diff numeric(14,2);
  v_led uuid;
  v_dest uuid;
  v_dest_branch uuid;
  v_j uuid;
  v_ref uuid := gen_random_uuid();
  v_lines jsonb;
BEGIN
  IF NOT public.has_biz_role(_biz,ARRAY['owner','manager','accountant','branch_manager']::public.member_role[])
    OR NOT public.has_module_access(_biz,'sales','approve') THEN
    RAISE EXCEPTION 'Only an authorized manager can approve a field-sales settlement.';
  END IF;
  SELECT * INTO t FROM public.field_sales_trips
  WHERE business_id=_biz AND id=_trip AND status='settlement_pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No pending settlement was found.'; END IF;
  IF public.has_biz_role(_biz,ARRAY['branch_manager']::public.member_role[])
    AND NOT public.can_access_shop_branch(_biz,t.sales_branch_id) THEN
    RAISE EXCEPTION 'You do not manage this sales shop.';
  END IF;
  SELECT * INTO s FROM public.field_sales_settlements
  WHERE business_id=_biz AND trip_id=_trip AND status='pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Settlement request is no longer pending.'; END IF;
  SELECT ledger_account_id,
    opening_balance+coalesce((SELECT sum(CASE WHEN direction='in' THEN amount ELSE -amount END)
      FROM public.money_transactions WHERE business_id=_biz AND account_id=t.cash_account_id),0)
  INTO v_led,v_balance FROM public.money_accounts
  WHERE business_id=_biz AND id=t.cash_account_id AND status='active' FOR UPDATE;
  IF v_led IS NULL THEN RAISE EXCEPTION 'Field cash account is unavailable.'; END IF;
  v_diff := round(s.cash_counted-v_balance,2);
  IF abs(v_diff)>=0.01 AND length(btrim(coalesce(_note,'')))<3 THEN
    RAISE EXCEPTION 'Explain the cash shortage or overage before approval.';
  END IF;
  IF v_diff<0 THEN
    v_j := public.post_journal(_biz,current_date,'field_sales_cash_shortage',_trip,
      'Field-sales cash shortage: '||coalesce(_note,''),
      jsonb_build_array(public.jl(public.acct(_biz,'6190'),abs(v_diff),0),public.jl(v_led,0,abs(v_diff))));
    INSERT INTO public.money_transactions(business_id,account_id,branch_id,txn_date,direction,amount,kind,method,note,ref_type,ref_id,journal_entry_id)
    VALUES (_biz,t.cash_account_id,t.sales_branch_id,current_date,'out',abs(v_diff),'adjustment','cash',_note,'field_sales_trip',_trip,v_j);
  ELSIF v_diff>0 THEN
    v_j := public.post_journal(_biz,current_date,'field_sales_cash_overage',_trip,
      'Field-sales cash overage: '||coalesce(_note,''),
      jsonb_build_array(public.jl(v_led,v_diff,0),public.jl(public.acct(_biz,'4900'),0,v_diff)));
    INSERT INTO public.money_transactions(business_id,account_id,branch_id,txn_date,direction,amount,kind,method,note,ref_type,ref_id,journal_entry_id)
    VALUES (_biz,t.cash_account_id,t.sales_branch_id,current_date,'in',v_diff,'other_income','cash',_note,'field_sales_trip',_trip,v_j);
  END IF;
  SELECT ledger_account_id,branch_id INTO v_dest,v_dest_branch FROM public.money_accounts
  WHERE business_id=_biz AND id=s.deposit_account_id AND status='active' FOR UPDATE;
  IF v_dest IS NULL OR s.deposit_account_id=t.cash_account_id THEN RAISE EXCEPTION 'Invalid deposit account.'; END IF;
  IF s.cash_counted>0 THEN
    PERFORM public._money_out_check(t.cash_account_id,s.cash_counted);
    v_j := public.post_journal(_biz,current_date,'transfer',v_ref,
      'Field-sales trip cash deposit',jsonb_build_array(public.jl(v_dest,s.cash_counted,0),public.jl(v_led,0,s.cash_counted)));
    INSERT INTO public.money_transactions(business_id,account_id,branch_id,txn_date,direction,amount,kind,note,ref_type,ref_id,journal_entry_id)
    VALUES
      (_biz,t.cash_account_id,t.sales_branch_id,current_date,'out',s.cash_counted,'transfer_out','Trip deposit','field_sales_trip',_trip,v_j),
      (_biz,s.deposit_account_id,coalesce(v_dest_branch,t.sales_branch_id),current_date,'in',s.cash_counted,'transfer_in','Trip deposit','field_sales_trip',_trip,v_j);
  END IF;

  FOR r IN
    SELECT fti.*, fsi.good_qty, fsi.damaged_qty,
      (SELECT c.is_serialized FROM public.product_variants pv
       JOIN public.products p ON p.id=pv.product_id
       JOIN public.categories c ON c.id=p.category_id WHERE pv.id=fti.variant_id) AS serialized
    FROM public.field_sales_trip_items fti
    JOIN public.field_sales_settlement_items fsi ON fsi.trip_item_id=fti.id
      AND fsi.settlement_id=s.id
    WHERE fti.business_id=_biz AND fti.trip_id=_trip
  LOOP
    IF r.good_qty>0 THEN
      INSERT INTO public.stock(business_id,branch_id,variant_id,qty,avg_cost)
      VALUES (_biz,t.stock_branch_id,r.variant_id,r.good_qty,r.unit_cost)
      ON CONFLICT (branch_id,variant_id)
      DO UPDATE SET
        avg_cost=CASE WHEN public.stock.qty+EXCLUDED.qty>0
          THEN round((public.stock.qty*public.stock.avg_cost+EXCLUDED.qty*EXCLUDED.avg_cost)
            /(public.stock.qty+EXCLUDED.qty),2)
          ELSE public.stock.avg_cost END,
        qty=public.stock.qty+EXCLUDED.qty,updated_at=now();
      INSERT INTO public.stock_movements(business_id,branch_id,variant_id,qty_change,unit_cost,ref_type,ref_id)
      VALUES (_biz,t.stock_branch_id,r.variant_id,r.good_qty,r.unit_cost,'field_sales_return',_trip);
    END IF;
    IF r.serialized THEN
      UPDATE public.product_imeis p SET status='IN_STOCK',branch_id=t.stock_branch_id
      FROM public.field_sales_trip_imeis fsi
      WHERE fsi.business_id=_biz AND fsi.trip_id=_trip AND fsi.status='return_pending'
        AND p.business_id=_biz AND p.id=fsi.imei_id;
      UPDATE public.field_sales_trip_imeis SET status='returned'
      WHERE business_id=_biz AND trip_id=_trip AND status='return_pending';
      UPDATE public.product_imeis p SET status='WARRANTY',branch_id=t.stock_branch_id
      FROM public.field_sales_trip_imeis fsi
      WHERE fsi.business_id=_biz AND fsi.trip_id=_trip AND fsi.status='damage_pending'
        AND p.business_id=_biz AND p.id=fsi.imei_id;
      UPDATE public.field_sales_trip_imeis SET status='damaged'
      WHERE business_id=_biz AND trip_id=_trip AND status='damage_pending';
    END IF;
    UPDATE public.field_sales_trip_items SET qty_returned=qty_returned+r.good_qty,
      qty_damaged=qty_damaged+r.damaged_qty WHERE business_id=_biz AND id=r.id;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.field_sales_trip_items WHERE business_id=_biz AND trip_id=_trip AND qty_damaged>0) THEN
    SELECT coalesce(sum(fti.qty_damaged*fti.unit_cost),0) INTO v_diff
    FROM public.field_sales_trip_items fti WHERE fti.business_id=_biz AND fti.trip_id=_trip;
    IF v_diff>0 THEN
      v_j := public.post_journal(_biz,current_date,'field_sales_damage',_trip,
        'Damaged field-sales stock: '||coalesce(_note,''),
        jsonb_build_array(public.jl(public.acct(_biz,'5010'),v_diff,0),public.jl(public.acct(_biz,'1200'),0,v_diff)));
    END IF;
  END IF;
  UPDATE public.product_imeis SET field_sales_trip_id=NULL
  WHERE business_id=_biz AND field_sales_trip_id=_trip;
  UPDATE public.field_sales_settlements SET status='approved',reviewed_by=auth.uid(),
    reviewed_at=now(),review_note=nullif(btrim(_note),''),transfer_ref=v_ref
  WHERE business_id=_biz AND id=s.id;
  UPDATE public.field_sales_trips SET status='settled',settled_by=auth.uid(),settled_at=now()
  WHERE business_id=_biz AND id=_trip;
END $$;

CREATE OR REPLACE FUNCTION public.reject_field_sales_settlement(_biz uuid,_trip uuid,_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_branch uuid;
BEGIN
  IF NOT public.has_biz_role(_biz,ARRAY['owner','manager','branch_manager']::public.member_role[])
    OR NOT public.has_module_access(_biz,'sales','approve') THEN
    RAISE EXCEPTION 'You do not have permission to reject settlements.';
  END IF;
  IF length(btrim(coalesce(_reason,''))) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Enter a reason.'; END IF;
  SELECT sales_branch_id INTO v_branch FROM public.field_sales_trips
  WHERE business_id=_biz AND id=_trip AND status='settlement_pending' FOR UPDATE;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'No pending settlement was found.'; END IF;
  IF public.has_biz_role(_biz,ARRAY['branch_manager']::public.member_role[])
    AND NOT public.can_access_shop_branch(_biz,v_branch) THEN
    RAISE EXCEPTION 'You do not manage this sales shop.';
  END IF;
  UPDATE public.field_sales_settlements SET status='rejected',reviewed_by=auth.uid(),
    reviewed_at=now(),review_note=btrim(_reason)
  WHERE business_id=_biz AND trip_id=_trip AND status='pending' RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'No pending settlement was found.'; END IF;
  UPDATE public.field_sales_trip_imeis SET status='issued'
  WHERE business_id=_biz AND trip_id=_trip AND status IN ('return_pending','damage_pending');
  UPDATE public.field_sales_trips SET status='open' WHERE business_id=_biz AND id=_trip;
END $$;

DO $$
DECLARE
  d text;
BEGIN
  d := pg_get_functiondef('public.access_module_for_table(text)'::regprocedure);
  IF position('field_sales_trips' IN d)>0 THEN RAISE EXCEPTION 'Field-sales table mapping already exists.'; END IF;
  d := replace(d,'WHEN ''sale_items'' THEN ''sales''',
    'WHEN ''field_sales_trips'' THEN ''sales'' WHEN ''field_sales_trip_items'' THEN ''sales'' WHEN ''field_sales_trip_imeis'' THEN ''sales'' WHEN ''field_sales_settlements'' THEN ''sales'' WHEN ''field_sales_settlement_items'' THEN ''sales'' WHEN ''sale_items'' THEN ''sales''');
  IF position('field_sales_trips' IN d)=0 THEN RAISE EXCEPTION 'Could not map field-sales tables.'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public.access_rpc_allowed(uuid)'::regprocedure);
  IF position('create_field_sales_trip' IN d)>0 THEN RAISE EXCEPTION 'Field-sales RPC mapping already exists.'; END IF;
  d := replace(d,'WHEN ''create_sale'' THEN ''sales''',
    'WHEN ''get_field_sales_trip_summary'' THEN ''sales'' WHEN ''get_field_sales_deposit_accounts'' THEN ''sales'' WHEN ''create_field_sales_trip'' THEN ''transfers'' WHEN ''create_field_sales_sale'' THEN ''sales'' WHEN ''collect_field_sales_payment'' THEN ''due_collection'' WHEN ''submit_field_sales_settlement'' THEN ''sales'' WHEN ''approve_field_sales_settlement'' THEN ''sales'' WHEN ''reject_field_sales_settlement'' THEN ''sales'' WHEN ''create_sale'' THEN ''sales''');
  d := replace(d,'''approve_stock_transfer'',''close_day''',
    '''approve_field_sales_settlement'',''reject_field_sales_settlement'',''approve_stock_transfer'',''close_day''');
  IF position(
    'WHEN v_rpc IN (''approve_sale_exception'',''reject_sale_exception'',''approve_field_sales_settlement'',''reject_field_sales_settlement'',''approve_stock_transfer''' IN d
  )=0 THEN
    RAISE EXCEPTION 'Could not grant the settlement RPC approval permission context.';
  END IF;
  d := replace(d,
    '''get_entity_comments'',''get_guardian_runtime_config''',
    '''get_entity_comments'',''get_field_sales_deposit_accounts'',''get_field_sales_trip_summary'',''get_guardian_runtime_config''');
  IF position('get_field_sales_trip_summary' IN d)=0
    OR position('get_field_sales_deposit_accounts' IN d)=0 THEN
    RAISE EXCEPTION 'Could not map field-sales read permissions.';
  END IF;
  IF position('create_field_sales_trip' IN d)=0 OR position('approve_field_sales_settlement' IN d)=0 THEN
    RAISE EXCEPTION 'Could not map field-sales RPCs.';
  END IF;
  EXECUTE d;
END $$;

CREATE OR REPLACE FUNCTION public._biz_tables()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=public AS $tables$
  SELECT ARRAY[
    'branches','brands','categories','accounts','products','product_variants',
    'customers','suppliers','salesmen','money_accounts','field_sales_trips',
    'expense_categories','commission_rules','journal_entries','journal_lines',
    'money_transactions','purchases','purchase_items','product_imeis',
    'field_sales_trip_items','field_sales_trip_imeis','sales','sale_items',
    'customer_payments','supplier_payments','field_sales_settlements',
    'field_sales_settlement_items','expenses','sales_returns','sales_return_items',
    'purchase_returns','purchase_return_items','stock','stock_movements',
    'stock_transfers','stock_transfer_items','warranty_claims','daily_closings',
    'guardian_alerts','guardian_runs'
  ]
$tables$;

DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public._validate_company_data_replace(uuid,jsonb)'::regprocedure);
  IF position('field_sales_trips' IN d)>0 THEN
    RAISE EXCEPTION 'Company-data replacement already excludes field-sales records.';
  END IF;
  d := replace(d,'''salesmen''',
    '''salesmen'',''field_sales_trips'',''field_sales_trip_items'',''field_sales_trip_imeis'',''field_sales_settlements'',''field_sales_settlement_items''');
  IF position('field_sales_trips' IN d)=0 THEN
    RAISE EXCEPTION 'Could not exclude field-sales records from company-data replacement.';
  END IF;
  EXECUTE d;

  d := pg_get_functiondef('public._wipe_business(uuid,boolean)'::regprocedure);
  IF position('field_sales_settlements' IN d)>0 THEN RAISE EXCEPTION 'Business reset already includes field-sales tables.'; END IF;
  d := replace(d,'  delete from daily_closings where business_id=_biz;',
    '  delete from field_sales_settlement_items where business_id=_biz;
  delete from field_sales_settlements where business_id=_biz;
  delete from field_sales_trip_imeis where business_id=_biz;
  delete from field_sales_trip_items where business_id=_biz;
  update product_imeis set field_sales_trip_id=null where business_id=_biz;
  update customer_payments set field_sales_trip_id=null where business_id=_biz;
  update sales set field_sales_trip_id=null where business_id=_biz;
  delete from daily_closings where business_id=_biz;');
  d := replace(d,'  delete from sales where business_id=_biz;',
    '  delete from sales where business_id=_biz;
  delete from field_sales_trips where business_id=_biz;');
  IF position('delete from field_sales_trips' IN d)=0 THEN RAISE EXCEPTION 'Could not add field-sales reset cleanup.'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public.restore_business(uuid,jsonb,text)'::regprocedure);
  IF position('field_sales_trip_id' IN d)>0 THEN RAISE EXCEPTION 'Backup restore already supports field-sales IMEI links.'; END IF;
  d := replace(d,
    'branch_id, purchase_item_id, cost, created_at, sale_item_id',
    'branch_id, purchase_item_id, cost, created_at, sale_item_id, field_sales_trip_id');
  d := replace(d,
    'branch_id, purchase_item_id, cost, created_at, NULL',
    'branch_id, purchase_item_id, cost, created_at, NULL, field_sales_trip_id');
  IF position('field_sales_trip_id' IN d)=0 THEN RAISE EXCEPTION 'Could not add field-sales restore support.'; END IF;
  EXECUTE d;
END $$;

DO $$
DECLARE d text; original text;
BEGIN
  SELECT pg_get_functiondef('public._guardian_run(uuid)'::regprocedure) INTO d;
  original := d;
  d := replace(d,
    'i.status IN (''IN_STOCK'',''RESERVED'') AND i.business_id=_biz',
    'i.status IN (''IN_STOCK'',''RESERVED'') AND i.business_id=_biz AND i.field_sales_trip_id IS NULL');
  IF d=original THEN RAISE EXCEPTION 'Could not exclude salesman-custody IMEIs from on-hand stock check.'; END IF;
  EXECUTE d;

  SELECT pg_get_functiondef('public.guardian_snapshot(uuid)'::regprocedure) INTO d;
  original := d;
  d := replace(d,
    'business_id=_biz AND status IN (''IN_STOCK'',''RESERVED'') GROUP BY',
    'business_id=_biz AND status IN (''IN_STOCK'',''RESERVED'') AND field_sales_trip_id IS NULL GROUP BY');
  d := replace(d,
    'coalesce((SELECT sum(qty*avg_cost) FROM stock WHERE business_id=_biz),0)',
    'coalesce((SELECT sum(qty*avg_cost) FROM stock WHERE business_id=_biz),0)+coalesce((SELECT sum((fti.qty_issued-fti.qty_returned-fti.qty_damaged-coalesce((SELECT sum(si.qty) FROM sales s JOIN sale_items si ON si.business_id=s.business_id AND si.sale_id=s.id WHERE s.business_id=_biz AND s.field_sales_trip_id=fti.trip_id AND s.status=''posted'' AND si.variant_id=fti.variant_id),0))*fti.unit_cost) FROM field_sales_trip_items fti JOIN field_sales_trips t ON t.id=fti.trip_id AND t.business_id=fti.business_id WHERE fti.business_id=_biz),0)');
  IF d=original THEN RAISE EXCEPTION 'Could not include salesman-custody stock in Guardian snapshot.'; END IF;
  EXECUTE d;
END $$;

REVOKE ALL ON FUNCTION public.create_field_sales_trip(uuid,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.create_field_sales_sale(uuid,uuid,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.collect_field_sales_payment(uuid,uuid,uuid,numeric,date,public.payment_method,text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.submit_field_sales_settlement(uuid,uuid,jsonb,numeric,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.approve_field_sales_settlement(uuid,uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.reject_field_sales_settlement(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_field_sales_trip(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_field_sales_sale(uuid,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.collect_field_sales_payment(uuid,uuid,uuid,numeric,date,public.payment_method,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_field_sales_settlement(uuid,uuid,jsonb,numeric,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_field_sales_settlement(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_field_sales_settlement(uuid,uuid,text) TO authenticated;
