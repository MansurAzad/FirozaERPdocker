-- 0035_orders.sql
-- Module 2: Order / Booking / Layaway / Delivery Tracking

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  order_no text NOT NULL,
  order_type text NOT NULL DEFAULT 'booking' CHECK (order_type IN ('booking','layaway','order')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','booked','layaway','confirmed','ready_for_delivery','out_for_delivery','delivered','cancelled','converted')),
  order_date date NOT NULL DEFAULT current_date,
  delivery_date date,
  delivery_address text,
  delivery_city text,
  courier_name text,
  tracking_no text,
  delivery_note text,
  subtotal numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total numeric(14,2) NOT NULL DEFAULT 0,
  deposit numeric(14,2) NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  balance numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  terms text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  converted_sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL,
  UNIQUE (business_id, order_no)
);

CREATE INDEX IF NOT EXISTS idx_orders_business ON public.orders(business_id, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON public.orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(business_id, status);

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  description text,
  qty integer NOT NULL CHECK (qty > 0),
  price numeric(14,2) NOT NULL CHECK (price >= 0),
  discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  line_total numeric(14,2) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_order_items_variant ON public.order_items(variant_id);

CREATE TABLE IF NOT EXISTS public.order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL DEFAULT current_date,
  method text NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','card','bkash','nagad','rocket','bank_transfer','other')),
  reference text,
  note text,
  received_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_payments_order ON public.order_payments(order_id, payment_date DESC);

-- audit
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='audit_orders') THEN
    CREATE TRIGGER audit_orders AFTER INSERT OR UPDATE OR DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='audit_order_items') THEN
    CREATE TRIGGER audit_order_items AFTER INSERT OR UPDATE OR DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='audit_order_payments') THEN
    CREATE TRIGGER audit_order_payments AFTER INSERT OR UPDATE OR DELETE ON public.order_payments FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  END IF;
END $$;

-- RLS
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_select ON public.orders;
CREATE POLICY orders_select ON public.orders FOR SELECT TO authenticated USING (public.is_member(business_id));
DROP POLICY IF EXISTS orders_write ON public.orders;
CREATE POLICY orders_write ON public.orders FOR ALL TO authenticated
  USING (public.has_biz_role(business_id, ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]))
  WITH CHECK (public.has_biz_role(business_id, ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]));

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_items_select ON public.order_items;
CREATE POLICY order_items_select ON public.order_items FOR SELECT TO authenticated USING (public.is_member(business_id));
DROP POLICY IF EXISTS order_items_write ON public.order_items;
CREATE POLICY order_items_write ON public.order_items FOR ALL TO authenticated
  USING (public.has_biz_role(business_id, ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]))
  WITH CHECK (public.has_biz_role(business_id, ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]));

ALTER TABLE public.order_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_payments_select ON public.order_payments;
CREATE POLICY order_payments_select ON public.order_payments FOR SELECT TO authenticated USING (public.is_member(business_id));
DROP POLICY IF EXISTS order_payments_write ON public.order_payments;
CREATE POLICY order_payments_write ON public.order_payments FOR ALL TO authenticated
  USING (public.has_biz_role(business_id, ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]))
  WITH CHECK (public.has_biz_role(business_id, ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]));

-- save_order
CREATE OR REPLACE FUNCTION public.save_order(_biz uuid, _id uuid DEFAULT NULL, _data jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_id uuid := _id; v_branch uuid := NULLIF(_data->>'branch_id','')::uuid;
  v_cust uuid := NULLIF(_data->>'customer_id','')::uuid;
  v_type text := COALESCE(NULLIF(_data->>'order_type',''),'booking');
  v_date date := COALESCE((_data->>'order_date')::date,current_date);
  v_ddate date := NULLIF(_data->>'delivery_date','')::date;
  v_addr text := NULLIF(_data->>'delivery_address',''); v_city text := NULLIF(_data->>'delivery_city','');
  v_courier text := NULLIF(_data->>'courier_name',''); v_track text := NULLIF(_data->>'tracking_no','');
  v_dnote text := NULLIF(_data->>'delivery_note','');
  v_notes text := NULLIF(_data->>'notes',''); v_terms text := NULLIF(_data->>'terms','');
  v_hdisc numeric(14,2):=COALESCE((_data->>'discount')::numeric,0); v_tax numeric(14,2):=COALESCE((_data->>'tax')::numeric,0);
  v_deposit numeric(14,2):=COALESCE((_data->>'deposit')::numeric,0);
  v_sub numeric(14,2):=0; v_ldisc numeric(14,2):=0; v_total numeric(14,2); v_seq int; v_no text; v_status text; v_cur text;
  it jsonb; v_var uuid; v_qty int; v_price numeric(14,2); v_disc numeric(14,2); v_line numeric(14,2); v_count int:=0;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;
  IF v_type NOT IN ('booking','layaway','order') THEN RAISE EXCEPTION 'Invalid order type.'; END IF;
  IF v_branch IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches WHERE id=v_branch AND business_id=_biz AND status='active') THEN
    RAISE EXCEPTION 'Choose a valid branch.';
  END IF;
  IF v_cust IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id=v_cust AND business_id=_biz) THEN
    RAISE EXCEPTION 'Invalid customer.';
  END IF;
  IF v_hdisc<0 OR v_tax<0 OR v_deposit<0 THEN RAISE EXCEPTION 'Amounts cannot be negative.'; END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(_data->'items','[]'::jsonb)) LOOP
    v_var:=NULLIF(it->>'variant_id','')::uuid; v_qty:=COALESCE((it->>'qty')::int,0); v_price:=COALESCE((it->>'price')::numeric,0); v_disc:=COALESCE((it->>'discount')::numeric,0);
    IF v_qty<=0 THEN RAISE EXCEPTION 'Quantity must be at least 1.'; END IF;
    IF v_price<0 OR v_disc<0 THEN RAISE EXCEPTION 'Amounts cannot be negative.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id=v_var AND business_id=_biz) THEN RAISE EXCEPTION 'Invalid product.'; END IF;
    v_line:=round(v_qty*v_price,2);
    IF v_disc>v_line THEN RAISE EXCEPTION 'Line discount cannot exceed line amount.'; END IF;
    v_sub:=v_sub+v_line; v_ldisc:=v_ldisc+v_disc; v_count:=v_count+1;
  END LOOP;
  IF v_count=0 THEN RAISE EXCEPTION 'Add at least one product.'; END IF;
  v_total:=v_sub - (v_ldisc+v_hdisc)+v_tax;
  IF v_total<0 THEN RAISE EXCEPTION 'Discount larger than total.'; END IF;
  IF v_deposit>v_total THEN RAISE EXCEPTION 'Deposit cannot exceed total.'; END IF;
  IF v_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('order_no_'||_biz::text));
    SELECT COALESCE(MAX(NULLIF(regexp_replace(order_no,'\D','','g'),'')::int),0)+1 INTO v_seq FROM public.orders WHERE business_id=_biz;
    v_no:='ORD-'||lpad(v_seq::text,6,'0');
    INSERT INTO public.orders(business_id,branch_id,customer_id,order_no,order_type,status,order_date,delivery_date,delivery_address,delivery_city,courier_name,tracking_no,delivery_note,subtotal,discount,tax,total,deposit,balance,notes,terms)
    VALUES(_biz,v_branch,v_cust,v_no,v_type,'draft',v_date,v_ddate,v_addr,v_city,v_courier,v_track,v_dnote,v_sub,v_ldisc+v_hdisc,v_tax,v_total,v_deposit,v_total-v_deposit,v_notes,v_terms)
    RETURNING id INTO v_id;
  ELSE
    SELECT status INTO v_cur FROM public.orders WHERE id=v_id AND business_id=_biz FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order not found.'; END IF;
    IF v_cur IN ('converted','delivered','cancelled') THEN RAISE EXCEPTION 'Cannot edit this order.'; END IF;
    UPDATE public.orders SET branch_id=v_branch,customer_id=v_cust,order_type=v_type,order_date=v_date,delivery_date=v_ddate,delivery_address=v_addr,delivery_city=v_city,courier_name=v_courier,tracking_no=v_track,delivery_note=v_dnote,subtotal=v_sub,discount=v_ldisc+v_hdisc,tax=v_tax,total=v_total,deposit=v_deposit,balance=v_total-v_deposit,notes=v_notes,terms=v_terms,updated_at=now() WHERE id=v_id AND business_id=_biz;
    DELETE FROM public.order_items WHERE order_id=v_id;
  END IF;
  FOR it IN SELECT t.item FROM jsonb_array_elements(_data->'items') WITH ORDINALITY AS t(item,ord) ORDER BY t.ord LOOP
    v_var:=(it->>'variant_id')::uuid; v_qty:=(it->>'qty')::int; v_price:=(it->>'price')::numeric; v_disc:=COALESCE((it->>'discount')::numeric,0);
    INSERT INTO public.order_items(business_id,order_id,variant_id,description,qty,price,discount,line_total) VALUES(_biz,v_id,v_var,NULLIF(it->>'description',''),v_qty,v_price,v_disc,round(v_qty*v_price,2)-v_disc);
  END LOOP;
  RETURN v_id;
END $$;

-- update order status
CREATE OR REPLACE FUNCTION public.update_order_status(_biz uuid, _id uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_cur text;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;
  IF _status NOT IN ('draft','booked','layaway','confirmed','ready_for_delivery','out_for_delivery','delivered','cancelled') THEN
    RAISE EXCEPTION 'Invalid status.';
  END IF;
  SELECT status INTO v_cur FROM public.orders WHERE id=_id AND business_id=_biz FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found.'; END IF;
  IF v_cur='converted' THEN RAISE EXCEPTION 'Converted order cannot change status.'; END IF;
  UPDATE public.orders SET status=_status, updated_at=now() WHERE id=_id AND business_id=_biz;
END $$;

-- add order payment
CREATE OR REPLACE FUNCTION public.add_order_payment(_biz uuid, _id uuid, _amount numeric, _method text DEFAULT 'cash', _reference text DEFAULT NULL, _note text DEFAULT NULL, _payment_date date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_pid uuid; v_total numeric; v_paid numeric; v_bal numeric; v_cur text;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be greater than zero.'; END IF;
  SELECT total,status,balance INTO v_total,v_cur FROM public.orders WHERE id=_id AND business_id=_biz FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found.'; END IF;
  IF v_cur='converted' THEN RAISE EXCEPTION 'Converted order cannot receive payments.'; END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_paid FROM public.order_payments WHERE order_id=_id;
  v_bal := v_total - (v_paid + _amount);
  IF v_bal < 0 THEN RAISE EXCEPTION 'Payment exceeds outstanding balance.'; END IF;
  INSERT INTO public.order_payments(business_id,order_id,amount,payment_date,method,reference,note)
  VALUES(_biz,_id,_amount,COALESCE(_payment_date,current_date),_method,_reference,_note)
  RETURNING id INTO v_pid;
  UPDATE public.orders SET deposit = deposit + _amount, balance = v_total - (v_paid + _amount), updated_at=now() WHERE id=_id;
  IF v_bal=0 AND v_cur IN ('layaway','booked','confirmed','ready_for_delivery') THEN
    UPDATE public.orders SET status='ready_for_delivery' WHERE id=_id;
  END IF;
  RETURN v_pid;
END $$;

-- mark converted
CREATE OR REPLACE FUNCTION public.mark_order_converted(_biz uuid, _id uuid, _sale uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_cur text; v_sale uuid;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;
  SELECT id INTO v_sale FROM public.sales WHERE id=_sale AND business_id=_biz;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'Invalid sale.'; END IF;
  SELECT status INTO v_cur FROM public.orders WHERE id=_id AND business_id=_biz FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found.'; END IF;
  IF v_cur='converted' THEN RETURN; END IF;
  UPDATE public.orders SET status='converted', converted_sale_id=_sale, updated_at=now() WHERE id=_id AND business_id=_biz;
END $$;

GRANT SELECT,INSERT,UPDATE,DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.order_payments TO authenticated;
GRANT ALL ON public.order_payments TO service_role;

REVOKE ALL ON FUNCTION public.save_order(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_order(uuid,uuid,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.update_order_status(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_order_status(uuid,uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.add_order_payment(uuid,uuid,numeric,text,text,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.add_order_payment(uuid,uuid,numeric,text,text,text,date) TO authenticated;
REVOKE ALL ON FUNCTION public.mark_order_converted(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mark_order_converted(uuid,uuid,uuid) TO authenticated;
