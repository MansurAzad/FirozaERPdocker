ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS partner_financed boolean NOT NULL DEFAULT false;
ALTER TABLE public.sales
  ADD CONSTRAINT sales_business_id_id_unique UNIQUE (business_id,id);

CREATE TABLE public.finance_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  legal_name text,
  status public.record_status NOT NULL DEFAULT 'active',
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  UNIQUE (business_id, name)
);

CREATE TABLE public.partner_financed_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  downpayment numeric(14,2) NOT NULL CHECK (downpayment >= 0),
  financed_amount numeric(14,2) NOT NULL CHECK (financed_amount > 0),
  expected_settlement numeric(14,2) NOT NULL CHECK (expected_settlement > 0),
  installment_count integer NOT NULL CHECK (installment_count > 0),
  installment_amount numeric(14,2) NOT NULL CHECK (installment_amount > 0),
  customer_total_repayment numeric(14,2) NOT NULL CHECK (customer_total_repayment > 0),
  application_reference text,
  approval_reference text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  UNIQUE (business_id, sale_id),
  UNIQUE (business_id, provider_id, approval_reference),
  FOREIGN KEY (business_id, sale_id) REFERENCES public.sales(business_id, id),
  FOREIGN KEY (business_id, provider_id) REFERENCES public.finance_providers(business_id, id)
);

CREATE TABLE public.partner_settlement_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL,
  file_name text,
  source text NOT NULL CHECK (source IN ('manual','csv')),
  imported_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, provider_id) REFERENCES public.finance_providers(business_id, id)
);

CREATE TABLE public.partner_settlement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  financed_sale_id uuid,
  invoice_no text,
  external_reference text,
  gross_amount numeric(14,2) NOT NULL CHECK (gross_amount >= 0),
  fee_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  adjustment_amount numeric(14,2) NOT NULL DEFAULT 0,
  net_amount numeric(14,2) NOT NULL CHECK (net_amount > 0),
  paid_on date NOT NULL,
  status text NOT NULL CHECK (status IN ('matched','unmatched')),
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  FOREIGN KEY (business_id, batch_id) REFERENCES public.partner_settlement_batches(business_id, id),
  FOREIGN KEY (business_id, provider_id) REFERENCES public.finance_providers(business_id, id),
  FOREIGN KEY (business_id, financed_sale_id) REFERENCES public.partner_financed_sales(business_id, id)
);

CREATE INDEX partner_financed_sales_business_date_idx
  ON public.partner_financed_sales(business_id, created_at DESC);
CREATE INDEX partner_financed_sales_provider_idx
  ON public.partner_financed_sales(business_id, provider_id, branch_id);
CREATE INDEX partner_settlement_lines_business_date_idx
  ON public.partner_settlement_lines(business_id, paid_on DESC);
CREATE UNIQUE INDEX partner_settlement_external_reference_unique
  ON public.partner_settlement_lines(business_id, provider_id, external_reference)
  WHERE external_reference IS NOT NULL;

CREATE TRIGGER audit_finance_providers
  AFTER INSERT OR UPDATE OR DELETE ON public.finance_providers
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_partner_financed_sales
  AFTER INSERT OR UPDATE OR DELETE ON public.partner_financed_sales
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_partner_settlement_batches
  AFTER INSERT OR UPDATE OR DELETE ON public.partner_settlement_batches
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_partner_settlement_lines
  AFTER INSERT OR UPDATE OR DELETE ON public.partner_settlement_lines
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

ALTER TABLE public.finance_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_financed_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_settlement_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_settlement_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY finance_providers_read ON public.finance_providers
  FOR SELECT TO authenticated USING (public.is_member(business_id) AND public.has_module_access(business_id,'sales','view'));
CREATE POLICY partner_financed_sales_read ON public.partner_financed_sales
  FOR SELECT TO authenticated USING (public.is_member(business_id) AND public.has_module_access(business_id,'sales','view'));
CREATE POLICY partner_settlement_batches_read ON public.partner_settlement_batches
  FOR SELECT TO authenticated USING (public.is_member(business_id) AND public.has_module_access(business_id,'sales','view'));
CREATE POLICY partner_settlement_lines_read ON public.partner_settlement_lines
  FOR SELECT TO authenticated USING (public.is_member(business_id) AND public.has_module_access(business_id,'sales','view'));

REVOKE ALL ON public.finance_providers, public.partner_financed_sales,
  public.partner_settlement_batches, public.partner_settlement_lines FROM PUBLIC, anon;
GRANT SELECT ON public.finance_providers, public.partner_financed_sales,
  public.partner_settlement_batches, public.partner_settlement_lines TO authenticated;

CREATE OR REPLACE FUNCTION public.save_finance_provider(
  _biz uuid, _id uuid, _name text, _legal_name text, _status public.record_status, _notes text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_module_access(_biz, 'sales', 'view')
    OR NOT (public.has_module_access(_biz, 'sales', 'create') OR public.has_module_access(_biz, 'sales', 'edit'))
    OR NOT public.has_biz_role(_biz, ARRAY['owner','manager']::public.member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission to manage finance providers.';
  END IF;
  IF length(trim(COALESCE(_name, ''))) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Provider name must be between 1 and 100 characters.';
  END IF;
  IF _id IS NULL THEN
    INSERT INTO public.finance_providers(business_id,name,legal_name,status,notes)
    VALUES (_biz,trim(_name),NULLIF(trim(COALESCE(_legal_name,'')),''),COALESCE(_status,'active'),NULLIF(trim(COALESCE(_notes,'')),''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.finance_providers
       SET name=trim(_name), legal_name=NULLIF(trim(COALESCE(_legal_name,'')),''),
           status=COALESCE(_status,'active'), notes=NULLIF(trim(COALESCE(_notes,'')),''),
           updated_at=now()
     WHERE business_id=_biz AND id=_id
     RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Finance provider not found.'; END IF;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.create_partner_financed_sale(
  _biz uuid, _branch uuid, _customer uuid, _provider uuid, _variant uuid, _imei uuid,
  _sale_price numeric, _downpayment numeric, _expected_settlement numeric,
  _installment_count integer, _installment_amount numeric, _customer_total_repayment numeric,
  _application_reference text, _approval_reference text, _sale_date date, _notes text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale uuid;
  v_item uuid;
  v_invoice text;
  v_seq integer;
  v_is_serial boolean;
  v_min numeric(14,2);
  v_warranty integer;
  v_cost numeric(14,2);
  v_qty integer;
  v_customer_name text;
  v_price numeric(14,2) := ROUND(COALESCE(_sale_price,0),2);
  v_downpayment numeric(14,2) := ROUND(COALESCE(_downpayment,0),2);
  v_financed numeric(14,2);
  v_expected numeric(14,2) := ROUND(COALESCE(_expected_settlement,0),2);
  v_monthly numeric(14,2) := ROUND(COALESCE(_installment_amount,0),2);
  v_customer_total numeric(14,2) := ROUND(COALESCE(_customer_total_repayment,0),2);
  v_manager boolean := public.has_biz_role(_biz, ARRAY['owner','manager']::public.member_role[]);
BEGIN
  IF NOT public.has_module_access(_biz,'sales','view')
    OR NOT public.has_module_access(_biz,'sales','create')
    OR NOT public.has_biz_role(_biz,ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission to create a partner-financed sale.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE id=_branch AND business_id=_biz AND status='active' AND kind='branch') THEN
    RAISE EXCEPTION 'Partner-financed sales are only allowed from an active brand shop.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.finance_providers WHERE id=_provider AND business_id=_biz AND status='active') THEN
    RAISE EXCEPTION 'Select an active finance provider.';
  END IF;
  SELECT name INTO v_customer_name FROM public.customers
   WHERE id=_customer AND business_id=_biz AND status='active';
  IF v_customer_name IS NULL THEN RAISE EXCEPTION 'Select an active customer.'; END IF;
  IF length(trim(COALESCE(_approval_reference,''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'A provider approval reference is required.';
  END IF;
  IF _imei IS NULL OR _variant IS NULL THEN RAISE EXCEPTION 'Select a phone and its IMEI.';
  END IF;
  IF v_price <= 0 OR v_downpayment < 0 OR v_downpayment >= v_price
    OR v_expected <= 0 OR COALESCE(_installment_count,0) <= 0
    OR v_monthly <= 0 OR v_customer_total < v_monthly THEN
    RAISE EXCEPTION 'Invalid sale or provider repayment terms.';
  END IF;
  v_financed := ROUND(v_price-v_downpayment,2);
  IF v_customer_total < v_financed THEN
    RAISE EXCEPTION 'Customer repayment total cannot be less than the financed amount.';
  END IF;
  SELECT c.is_serialized,pv.min_price,pv.warranty_months
    INTO v_is_serial,v_min,v_warranty
    FROM public.product_variants pv
    JOIN public.products p ON p.id=pv.product_id AND p.business_id=_biz
    JOIN public.categories c ON c.id=p.category_id AND c.business_id=_biz
   WHERE pv.id=_variant AND pv.business_id=_biz;
  IF NOT FOUND OR NOT v_is_serial THEN RAISE EXCEPTION 'Select an IMEI-tracked phone.'; END IF;
  IF v_price < v_min AND NOT v_manager THEN RAISE EXCEPTION 'Price is below the minimum selling price. Manager approval required.'; END IF;
  SELECT qty INTO v_qty FROM public.stock WHERE business_id=_biz AND branch_id=_branch AND variant_id=_variant FOR UPDATE;
  IF COALESCE(v_qty,0) < 1 THEN RAISE EXCEPTION 'This phone is out of stock at the selected shop.'; END IF;
  SELECT cost INTO v_cost FROM public.product_imeis
   WHERE id=_imei AND business_id=_biz AND branch_id=_branch AND variant_id=_variant AND status='IN_STOCK'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The selected IMEI is not available at this shop.'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('sale_no_' || _biz::text));
  SELECT COALESCE(MAX(NULLIF(regexp_replace(invoice_no,'\D','','g'), '')::integer),0)+1
    INTO v_seq FROM public.sales WHERE business_id=_biz;
  v_invoice := 'INV-' || lpad(v_seq::text,6,'0');
  INSERT INTO public.sales(business_id,branch_id,customer_id,invoice_no,sale_date,subtotal,total,paid,due,cogs,status,notes,partner_financed)
  VALUES (_biz,_branch,_customer,v_invoice,COALESCE(_sale_date,current_date),v_price,v_price,0,0,v_cost,'posted',
          NULLIF(trim(COALESCE(_notes,'')),''),true)
  RETURNING id INTO v_sale;
  INSERT INTO public.sale_items(business_id,sale_id,variant_id,imei_id,qty,price,line_total,unit_cost,warranty_months)
  VALUES (_biz,v_sale,_variant,_imei,1,v_price,v_price,v_cost,COALESCE(v_warranty,0))
  RETURNING id INTO v_item;
  UPDATE public.product_imeis SET status='SOLD',sale_item_id=v_item WHERE id=_imei;
  UPDATE public.stock SET qty=qty-1,updated_at=now()
   WHERE business_id=_biz AND branch_id=_branch AND variant_id=_variant;
  INSERT INTO public.stock_movements(business_id,branch_id,variant_id,imei_id,qty_change,unit_cost,ref_type,ref_id)
  VALUES (_biz,_branch,_variant,_imei,-1,v_cost,'sale',v_sale);
  INSERT INTO public.partner_financed_sales(
    business_id,sale_id,provider_id,branch_id,customer_id,downpayment,financed_amount,
    expected_settlement,installment_count,installment_amount,customer_total_repayment,
    application_reference,approval_reference,notes
  ) VALUES (
    _biz,v_sale,_provider,_branch,_customer,v_downpayment,v_financed,v_expected,
    _installment_count,v_monthly,v_customer_total,NULLIF(trim(COALESCE(_application_reference,'')),''),
    trim(_approval_reference),NULLIF(trim(COALESCE(_notes,'')),'')
  );
  RETURN jsonb_build_object('sale_id',v_sale,'invoice_no',v_invoice);
END $$;

CREATE OR REPLACE FUNCTION public._insert_partner_settlement_line(
  _biz uuid, _batch uuid, _provider uuid, _invoice text, _external_reference text,
  _gross numeric, _fee numeric, _adjustment numeric, _net numeric, _paid_on date, _note text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_financed_sale uuid;
  v_status text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.finance_providers WHERE id=_provider AND business_id=_biz) THEN
    RAISE EXCEPTION 'Finance provider not found.';
  END IF;
  IF ROUND(COALESCE(_gross,0),2)<0 OR ROUND(COALESCE(_fee,0),2)<0
    OR ROUND(COALESCE(_net,0),2)<=0 OR _paid_on IS NULL THEN
    RAISE EXCEPTION 'Settlement line has an invalid amount or date.';
  END IF;
  IF NULLIF(trim(COALESCE(_invoice,'')),'') IS NULL
    AND NULLIF(trim(COALESCE(_external_reference,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Provide an invoice number or provider reference for the settlement line.';
  END IF;
  IF ABS(ROUND(COALESCE(_gross,0)-COALESCE(_fee,0)+COALESCE(_adjustment,0),2)-ROUND(_net,2))>0.01 THEN
    RAISE EXCEPTION 'Net settlement must equal gross less fees plus adjustments.';
  END IF;
  SELECT pfs.id INTO v_financed_sale
    FROM public.partner_financed_sales pfs
    JOIN public.sales s ON s.id=pfs.sale_id AND s.business_id=pfs.business_id
   WHERE pfs.business_id=_biz AND pfs.provider_id=_provider AND pfs.status='active'
     AND ((_invoice IS NOT NULL AND s.invoice_no=trim(_invoice))
       OR (_external_reference IS NOT NULL AND pfs.approval_reference=trim(_external_reference)))
   ORDER BY CASE WHEN s.invoice_no=trim(COALESCE(_invoice,'')) THEN 0 ELSE 1 END
   LIMIT 1;
  v_status := CASE WHEN v_financed_sale IS NULL THEN 'unmatched' ELSE 'matched' END;
  INSERT INTO public.partner_settlement_lines(
    business_id,batch_id,provider_id,financed_sale_id,invoice_no,external_reference,
    gross_amount,fee_amount,adjustment_amount,net_amount,paid_on,status,note
  ) VALUES (
    _biz,_batch,_provider,v_financed_sale,NULLIF(trim(COALESCE(_invoice,'')), ''),
    NULLIF(trim(COALESCE(_external_reference,'')),''),ROUND(_gross,2),ROUND(COALESCE(_fee,0),2),
    ROUND(COALESCE(_adjustment,0),2),ROUND(_net,2),_paid_on,v_status,NULLIF(trim(COALESCE(_note,'')),'')
  );
  RETURN v_status;
END $$;

CREATE OR REPLACE FUNCTION public.record_partner_settlement(
  _biz uuid, _provider uuid, _invoice text, _external_reference text,
  _gross numeric, _fee numeric, _adjustment numeric, _net numeric, _paid_on date, _note text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_batch uuid; v_status text;
BEGIN
  IF NOT public.has_module_access(_biz,'sales','view')
    OR NOT public.has_module_access(_biz,'sales','create')
    OR NOT public.has_biz_role(_biz,ARRAY['owner','manager','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission to reconcile provider settlements.';
  END IF;
  INSERT INTO public.partner_settlement_batches(business_id,provider_id,source)
  VALUES (_biz,_provider,'manual') RETURNING id INTO v_batch;
  v_status := public._insert_partner_settlement_line(
    _biz,v_batch,_provider,_invoice,_external_reference,_gross,_fee,_adjustment,_net,_paid_on,_note
  );
  RETURN v_status;
END $$;

CREATE OR REPLACE FUNCTION public.match_partner_settlement(
  _biz uuid, _line uuid, _sale uuid
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_provider uuid;
  v_line_status text;
  v_financed_sale uuid;
  v_invoice text;
BEGIN
  IF NOT public.has_module_access(_biz,'sales','view')
    OR NOT public.has_module_access(_biz,'sales','create')
    OR NOT public.has_biz_role(_biz,ARRAY['owner','manager','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission to match provider settlements.';
  END IF;
  SELECT provider_id,status INTO v_provider,v_line_status
    FROM public.partner_settlement_lines
   WHERE business_id=_biz AND id=_line
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Settlement line not found.'; END IF;
  IF v_line_status <> 'unmatched' THEN RAISE EXCEPTION 'Only unmatched settlement lines can be matched.'; END IF;
  SELECT pfs.id,s.invoice_no INTO v_financed_sale,v_invoice
    FROM public.partner_financed_sales pfs
    JOIN public.sales s ON s.id=pfs.sale_id AND s.business_id=pfs.business_id
   WHERE pfs.business_id=_biz AND pfs.provider_id=v_provider
     AND pfs.sale_id=_sale AND pfs.status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Select an active financed sale for the same provider.'; END IF;
  UPDATE public.partner_settlement_lines
     SET financed_sale_id=v_financed_sale,invoice_no=COALESCE(invoice_no,v_invoice),status='matched'
   WHERE business_id=_biz AND id=_line;
  RETURN 'matched';
END $$;

CREATE OR REPLACE FUNCTION public.import_partner_settlements(
  _biz uuid, _provider uuid, _file_name text, _rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch uuid;
  v_row jsonb;
  v_inserted integer := 0;
  v_matched integer := 0;
  v_unmatched integer := 0;
  v_duplicate integer := 0;
  v_status text;
  v_external text;
BEGIN
  IF NOT public.has_module_access(_biz,'sales','view')
    OR NOT public.has_module_access(_biz,'sales','create')
    OR NOT public.has_biz_role(_biz,ARRAY['owner','manager','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission to import provider settlements.';
  END IF;
  IF jsonb_typeof(_rows) IS DISTINCT FROM 'array'
    OR jsonb_array_length(_rows)=0 OR jsonb_array_length(_rows)>5000 THEN
    RAISE EXCEPTION 'Settlement import must contain a valid array of at most 5000 rows.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.finance_providers WHERE id=_provider AND business_id=_biz) THEN
    RAISE EXCEPTION 'Finance provider not found.';
  END IF;
  INSERT INTO public.partner_settlement_batches(business_id,provider_id,file_name,source)
  VALUES (_biz,_provider,NULLIF(trim(COALESCE(_file_name,'')),''),'csv') RETURNING id INTO v_batch;
  FOR v_row IN SELECT value FROM jsonb_array_elements(_rows) LOOP
    v_external := NULLIF(trim(COALESCE(v_row->>'external_reference','')),'');
    IF v_external IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.partner_settlement_lines
      WHERE business_id=_biz AND provider_id=_provider AND external_reference=v_external
    ) THEN
      v_duplicate := v_duplicate+1;
      CONTINUE;
    END IF;
    v_status := public._insert_partner_settlement_line(
      _biz,v_batch,_provider,NULLIF(trim(COALESCE(v_row->>'invoice_no','')),''),
      v_external,COALESCE(NULLIF(v_row->>'gross_amount','')::numeric,0),
      COALESCE(NULLIF(v_row->>'fee_amount','')::numeric,0),
      COALESCE(NULLIF(v_row->>'adjustment_amount','')::numeric,0),
      COALESCE(NULLIF(v_row->>'net_amount','')::numeric,0),
      NULLIF(v_row->>'paid_on','')::date,v_row->>'note'
    );
    v_inserted := v_inserted+1;
    IF v_status='matched' THEN v_matched:=v_matched+1; ELSE v_unmatched:=v_unmatched+1; END IF;
  END LOOP;
  RETURN jsonb_build_object('batch_id',v_batch,'inserted',v_inserted,'matched',v_matched,
    'unmatched',v_unmatched,'duplicates_skipped',v_duplicate);
END $$;

CREATE OR REPLACE FUNCTION public.partner_finance_snapshot(_biz uuid, _provider uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.has_module_access(_biz,'sales','view') THEN RAISE EXCEPTION 'No permission.'; END IF;
  SELECT jsonb_build_object(
    'providers',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',fp.id,'name',fp.name,'legal_name',fp.legal_name,'status',fp.status,'notes',fp.notes)
        ORDER BY fp.name) FROM public.finance_providers fp WHERE fp.business_id=_biz
    ),'[]'::jsonb),
    'sales',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',pfs.id,'sale_id',pfs.sale_id,'invoice_no',s.invoice_no,'sale_date',s.sale_date,
        'sale_price',s.total,'cogs',s.cogs,'provider_id',pfs.provider_id,'provider_name',fp.name,
        'branch_id',pfs.branch_id,'branch_name',b.name,'customer_id',pfs.customer_id,
        'customer_name',c.name,'customer_mobile',c.mobile,'downpayment',pfs.downpayment,
        'financed_amount',pfs.financed_amount,'expected_settlement',pfs.expected_settlement,
        'installment_count',pfs.installment_count,'installment_amount',pfs.installment_amount,
        'customer_total_repayment',pfs.customer_total_repayment,'application_reference',pfs.application_reference,
        'approval_reference',pfs.approval_reference,'status',pfs.status,'notes',pfs.notes,
        'settled_amount',COALESCE(st.settled_amount,0),'fee_total',COALESCE(st.fee_total,0),
        'outstanding_settlement',GREATEST(pfs.expected_settlement-COALESCE(st.settled_amount,0),0),
        'settlement_status',CASE WHEN COALESCE(st.settled_amount,0)>pfs.expected_settlement+0.01 THEN 'overpaid'
          WHEN COALESCE(st.settled_amount,0)>=pfs.expected_settlement-0.01 THEN 'settled'
          WHEN COALESCE(st.settled_amount,0)>0 THEN 'partial'
          ELSE 'pending' END)
        ORDER BY s.sale_date DESC,s.created_at DESC)
      FROM public.partner_financed_sales pfs
      JOIN public.sales s ON s.id=pfs.sale_id AND s.business_id=_biz
      JOIN public.finance_providers fp ON fp.id=pfs.provider_id AND fp.business_id=_biz
      JOIN public.branches b ON b.id=pfs.branch_id AND b.business_id=_biz
      JOIN public.customers c ON c.id=pfs.customer_id AND c.business_id=_biz
      LEFT JOIN LATERAL (
        SELECT sum(l.net_amount) settled_amount,sum(l.fee_amount) fee_total
        FROM public.partner_settlement_lines l
        WHERE l.business_id=_biz AND l.financed_sale_id=pfs.id AND l.status='matched'
      ) st ON true
      WHERE pfs.business_id=_biz AND (_provider IS NULL OR pfs.provider_id=_provider)
    ),'[]'::jsonb),
    'settlements',COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',l.id,'provider_id',l.provider_id,'provider_name',fp.name,'invoice_no',l.invoice_no,
        'external_reference',l.external_reference,'gross_amount',l.gross_amount,'fee_amount',l.fee_amount,
        'adjustment_amount',l.adjustment_amount,'net_amount',l.net_amount,'paid_on',l.paid_on,
        'status',l.status,'note',l.note,'sale_invoice',s.invoice_no,'branch_id',pfs.branch_id)
        ORDER BY l.paid_on DESC,l.created_at DESC)
      FROM public.partner_settlement_lines l
      JOIN public.finance_providers fp ON fp.id=l.provider_id AND fp.business_id=_biz
      LEFT JOIN public.partner_financed_sales pfs ON pfs.id=l.financed_sale_id AND pfs.business_id=_biz
      LEFT JOIN public.sales s ON s.id=pfs.sale_id AND s.business_id=_biz
      WHERE l.business_id=_biz AND (_provider IS NULL OR l.provider_id=_provider)
    ),'[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.customer_due(_c uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.opening_balance
    + COALESCE((SELECT sum(s.total) FROM public.sales s
                 WHERE s.business_id=c.business_id AND s.customer_id=c.id AND s.status='posted' AND NOT s.partner_financed),0)
    - COALESCE((SELECT sum(p.amount) FROM public.customer_payments p WHERE p.business_id=c.business_id AND p.customer_id=c.id),0)
    - COALESCE((SELECT sum(r.total-r.refund) FROM public.sales_returns r WHERE r.business_id=c.business_id AND r.customer_id=c.id),0)
  FROM public.customers c WHERE c.id=_c
$$;

CREATE OR REPLACE VIEW public.customer_balances WITH (security_invoker=true) AS
SELECT c.id AS customer_id,c.business_id,c.name,c.business_name,c.mobile,c.type,c.credit_limit,c.payment_terms_days,c.opening_balance,
  COALESCE((SELECT sum(s.total) FROM public.sales s WHERE s.business_id=c.business_id AND s.customer_id=c.id AND s.status='posted' AND NOT s.partner_financed),0) AS sales_total,
  COALESCE((SELECT sum(p.amount) FROM public.customer_payments p WHERE p.business_id=c.business_id AND p.customer_id=c.id),0) AS payments_total,
  c.opening_balance
   + COALESCE((SELECT sum(s.total) FROM public.sales s WHERE s.business_id=c.business_id AND s.customer_id=c.id AND s.status='posted' AND NOT s.partner_financed),0)
   - COALESCE((SELECT sum(p.amount) FROM public.customer_payments p WHERE p.business_id=c.business_id AND p.customer_id=c.id),0)
   - COALESCE((SELECT sum(r.total-r.refund) FROM public.sales_returns r WHERE r.business_id=c.business_id AND r.customer_id=c.id),0) AS current_due,
  (SELECT max(s.sale_date) FROM public.sales s WHERE s.business_id=c.business_id AND s.customer_id=c.id AND NOT s.partner_financed) AS last_sale,
  (SELECT max(p.paid_on) FROM public.customer_payments p WHERE p.business_id=c.business_id AND p.customer_id=c.id) AS last_payment,
  COALESCE((SELECT sum(r.total) FROM public.sales_returns r WHERE r.business_id=c.business_id AND r.customer_id=c.id),0) AS returns_total
FROM public.customers c;

CREATE OR REPLACE FUNCTION public.reject_partner_financed_return()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.business_id=NEW.business_id AND s.id=NEW.sale_id AND s.partner_financed
  ) THEN
    RAISE EXCEPTION 'Partner-financed sales cannot be returned through the standard sales-return workflow.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER prevent_partner_financed_sales_return
  BEFORE INSERT ON public.sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.reject_partner_financed_return();
REVOKE ALL ON FUNCTION public.reject_partner_financed_return() FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION public._insert_partner_settlement_line(uuid,uuid,uuid,text,text,numeric,numeric,numeric,numeric,date,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.save_finance_provider(uuid,uuid,text,text,public.record_status,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.create_partner_financed_sale(uuid,uuid,uuid,uuid,uuid,uuid,numeric,numeric,numeric,integer,numeric,numeric,text,text,date,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.record_partner_settlement(uuid,uuid,text,text,numeric,numeric,numeric,numeric,date,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.match_partner_settlement(uuid,uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.import_partner_settlements(uuid,uuid,text,jsonb) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.partner_finance_snapshot(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_finance_provider(uuid,uuid,text,text,public.record_status,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_partner_financed_sale(uuid,uuid,uuid,uuid,uuid,uuid,numeric,numeric,numeric,integer,numeric,numeric,text,text,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_partner_settlement(uuid,uuid,text,text,numeric,numeric,numeric,numeric,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_partner_settlement(uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_partner_settlements(uuid,uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_finance_snapshot(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.access_rpc_allowed(_biz uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_path text:=current_setting('request.path',true);
  v_rpc text;
  v_module text;
  v_permission text;
BEGIN
  IF v_path IS NULL OR v_path NOT LIKE '/rpc/%' THEN RETURN true; END IF;
  v_rpc:=split_part(substring(v_path FROM 6),'/',1);
  IF v_rpc IN ('has_biz_role','is_member','get_effective_access') THEN RETURN true; END IF;
  v_module:=CASE v_rpc
    WHEN 'account_totals' THEN 'accounting'
    WHEN 'accrue_salesman_commission' THEN 'commission'
    WHEN 'add_entity_comment' THEN 'tasks'
    WHEN 'add_expense_category' THEN 'expenses'
    WHEN 'add_order_payment' THEN 'orders'
    WHEN 'apply_bulk_price_update' THEN 'bulk_price'
    WHEN 'approve_stock_transfer' THEN 'transfers'
    WHEN 'brand_shop_report' THEN 'reports'
    WHEN 'close_day' THEN 'closing'
    WHEN 'complete_bank_reconciliation' THEN 'bank_reconciliation'
    WHEN 'create_account' THEN 'accounting'
    WHEN 'create_attachment' THEN 'attachments'
    WHEN 'create_emi_sale_full' THEN 'emi'
    WHEN 'create_expense' THEN 'expenses'
    WHEN 'create_manual_journal' THEN 'accounting'
    WHEN 'create_money_account' THEN 'cash_bank'
    WHEN 'create_notification' THEN 'team'
    WHEN 'create_payment_request' THEN 'customer_portal'
    WHEN 'create_purchase' THEN 'purchases'
    WHEN 'create_purchase_return' THEN 'purchase_returns'
    WHEN 'create_sale' THEN 'sales'
    WHEN 'create_partner_financed_sale' THEN 'sales'
    WHEN 'record_partner_settlement' THEN 'sales'
    WHEN 'match_partner_settlement' THEN 'sales'
    WHEN 'import_partner_settlements' THEN 'sales'
    WHEN 'save_finance_provider' THEN 'sales'
    WHEN 'partner_finance_snapshot' THEN 'sales'
    WHEN 'create_sales_return' THEN 'sales'
    WHEN 'create_stock_transfer' THEN 'transfers'
    WHEN 'create_task' THEN 'tasks'
    WHEN 'create_warranty_claim' THEN 'warranty'
    WHEN 'daily_summary' THEN 'daily_reports'
    WHEN 'dead_slow_stock_report' THEN 'dead_slow_stock'
    WHEN 'delete_account' THEN 'accounting'
    WHEN 'delete_attachment' THEN 'attachments'
    WHEN 'delete_expense_category' THEN 'expenses'
    WHEN 'delete_money_account' THEN 'cash_bank'
    WHEN 'delete_access_role' THEN 'team'
    WHEN 'emi_summary' THEN 'emi'
    WHEN 'export_business' THEN 'backup'
    WHEN 'generate_customer_portal_token' THEN 'customer_portal'
    WHEN 'get_attachments_for_record' THEN 'attachments'
    WHEN 'get_bank_reconciliation_summary' THEN 'bank_reconciliation'
    WHEN 'get_company_profile' THEN 'company_profile'
    WHEN 'get_entity_comments' THEN 'tasks'
    WHEN 'get_guardian_runtime_config' THEN 'guardian'
    WHEN 'get_pending_transfer_approvals' THEN 'transfers'
    WHEN 'get_member_access_config' THEN 'team'
    WHEN 'get_user_notifications' THEN 'team'
    WHEN 'get_user_tasks' THEN 'tasks'
    WHEN 'guardian_snapshot' THEN 'guardian'
    WHEN 'mark_all_notifications_read' THEN 'team'
    WHEN 'mark_notification_read' THEN 'team'
    WHEN 'mark_order_converted' THEN 'orders'
    WHEN 'mark_quotation_converted' THEN 'quotations'
    WHEN 'mark_reconciliation_item_cleared' THEN 'bank_reconciliation'
    WHEN 'pay_salesman_commission' THEN 'commission'
    WHEN 'pay_supplier' THEN 'supplier_payments'
    WHEN 'post_purchase_return' THEN 'purchase_returns'
    WHEN 'post_stock_adjustment' THEN 'stock_adjustments'
    WHEN 'receive_customer_payment' THEN 'due_collection'
    WHEN 'receive_emi_payment' THEN 'emi'
    WHEN 'receive_po_items' THEN 'purchase_orders'
    WHEN 'receive_stock_transfer' THEN 'transfers'
    WHEN 'record_money_txn' THEN 'cash_bank'
    WHEN 'reject_stock_transfer' THEN 'transfers'
    WHEN 'request_transfer_approval' THEN 'transfers'
    WHEN 'reset_business' THEN 'backup'
    WHEN 'restore_business' THEN 'backup'
    WHEN 'resume_guardian_ai' THEN 'guardian'
    WHEN 'reverse_expense' THEN 'expenses'
    WHEN 'reverse_journal' THEN 'accounting'
    WHEN 'reverse_money_txn' THEN 'cash_bank'
    WHEN 'run_guardian_checks' THEN 'guardian'
    WHEN 'save_emi_plan' THEN 'emi'
    WHEN 'save_access_role' THEN 'team'
    WHEN 'save_member_access' THEN 'team'
    WHEN 'save_label_template' THEN 'labels'
    WHEN 'save_order' THEN 'orders'
    WHEN 'save_purchase_order' THEN 'purchase_orders'
    WHEN 'save_purchase_return' THEN 'purchase_returns'
    WHEN 'save_quotation' THEN 'quotations'
    WHEN 'save_service_items' THEN 'service'
    WHEN 'save_service_job' THEN 'service'
    WHEN 'save_stock_adjustment' THEN 'stock_adjustments'
    WHEN 'set_dealer_credit' THEN 'dealers'
    WHEN 'set_guardian_alert' THEN 'guardian'
    WHEN 'set_order_delivery' THEN 'courier'
    WHEN 'start_bank_reconciliation' THEN 'bank_reconciliation'
    WHEN 'supplier_aging_report' THEN 'supplier_aging'
    WHEN 'transfer_money' THEN 'cash_bank'
    WHEN 'update_account' THEN 'accounting'
    WHEN 'update_expense' THEN 'expenses'
    WHEN 'update_expense_category' THEN 'expenses'
    WHEN 'update_money_account' THEN 'cash_bank'
    WHEN 'update_order_status' THEN 'orders'
    WHEN 'update_po_status' THEN 'purchase_orders'
    WHEN 'update_quotation_status' THEN 'quotations'
    WHEN 'update_service_status' THEN 'service'
    WHEN 'update_task_status' THEN 'tasks'
    WHEN 'update_warranty_claim' THEN 'warranty'
    WHEN 'visit_log' THEN 'usage'
    ELSE NULL END;
  IF v_rpc IN ('create_business','get_effective_access','verify_customer_portal_token','verify_job_token') THEN RETURN true; END IF;
  IF v_module IS NULL THEN RETURN false; END IF;
  v_permission:=CASE
    WHEN v_rpc IN ('account_totals','brand_shop_report','daily_summary','dead_slow_stock_report','emi_summary',
      'get_attachments_for_record','get_bank_reconciliation_summary','get_company_profile','get_entity_comments',
      'get_guardian_runtime_config','get_pending_transfer_approvals','get_user_notifications','get_user_tasks',
      'guardian_snapshot','partner_finance_snapshot','supplier_aging_report','visit_log') THEN 'view'
    WHEN v_rpc LIKE 'delete_%' THEN 'delete'
    WHEN v_rpc IN ('approve_stock_transfer','close_day','complete_bank_reconciliation','mark_order_converted',
      'mark_quotation_converted','post_purchase_return','post_stock_adjustment','reject_stock_transfer',
      'reset_business','restore_business','set_guardian_alert') THEN 'approve'
    WHEN v_rpc IN ('update_account','update_expense','update_expense_category','update_money_account',
      'update_order_status','update_po_status','update_quotation_status','update_service_status',
      'update_task_status','update_warranty_claim','mark_all_notifications_read','mark_notification_read',
      'mark_reconciliation_item_cleared','reverse_expense','reverse_journal','reverse_money_txn',
      'resume_guardian_ai','set_order_delivery') THEN 'edit'
    WHEN v_rpc='export_business' THEN 'export'
    WHEN v_rpc='get_member_access_config' THEN 'view'
    WHEN v_rpc IN ('save_access_role','save_member_access','save_finance_provider') THEN 'edit'
    WHEN v_rpc='delete_access_role' THEN 'delete'
    ELSE 'create' END;
  IF v_rpc IN ('save_emi_plan','save_label_template','save_order','save_purchase_order','save_purchase_return',
    'save_quotation','save_service_items','save_service_job','save_stock_adjustment','set_dealer_credit',
    'save_finance_provider') THEN
    RETURN public.has_module_access(_biz,v_module,'create') OR public.has_module_access(_biz,v_module,'edit');
  END IF;
  RETURN public.has_module_access(_biz,v_module,v_permission);
END $$;

REVOKE ALL ON FUNCTION public.access_rpc_allowed(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.access_rpc_allowed(uuid) TO authenticated,service_role;
