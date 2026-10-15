-- 0036_emi.sql
-- Module 3: EMI / Installment Sales

CREATE TABLE IF NOT EXISTS public.emi_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  tenure_months integer NOT NULL CHECK (tenure_months > 0),
  interest_rate numeric(6,2) NOT NULL DEFAULT 0 CHECK (interest_rate >= 0),
  processing_fee numeric(14,2) NOT NULL DEFAULT 0 CHECK (processing_fee >= 0),
  downpayment_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (downpayment_percent >= 0 AND downpayment_percent <= 100),
  status public.record_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);

CREATE INDEX IF NOT EXISTS idx_emi_plans_biz ON public.emi_plans(business_id);

CREATE TABLE IF NOT EXISTS public.sales_emi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.emi_plans(id) ON DELETE SET NULL,
  total_amount numeric(14,2) NOT NULL CHECK (total_amount > 0),
  downpayment numeric(14,2) NOT NULL CHECK (downpayment >= 0),
  financed_amount numeric(14,2) NOT NULL CHECK (financed_amount >= 0),
  interest_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (interest_amount >= 0),
  processing_fee numeric(14,2) NOT NULL DEFAULT 0 CHECK (processing_fee >= 0),
  tenure_months integer NOT NULL CHECK (tenure_months > 0),
  monthly_amount numeric(14,2) NOT NULL CHECK (monthly_amount > 0),
  start_date date NOT NULL DEFAULT current_date,
  due_day integer NOT NULL CHECK (due_day >= 1 AND due_day <= 31),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','early_settled','defaulted')),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, sale_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_emi_biz ON public.sales_emi(business_id);
CREATE INDEX IF NOT EXISTS idx_sales_emi_sale ON public.sales_emi(sale_id);

CREATE TABLE IF NOT EXISTS public.emi_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  emi_id uuid NOT NULL REFERENCES public.sales_emi(id) ON DELETE CASCADE,
  installment_no integer NOT NULL CHECK (installment_no > 0),
  due_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  balance numeric(14,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status text NOT NULL DEFAULT 'due' CHECK (status IN ('due','partially_paid','paid','overdue')),
  paid_at timestamptz,
  payment_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (emi_id, installment_no)
);

CREATE INDEX IF NOT EXISTS idx_emi_inst_emi ON public.emi_installments(emi_id, due_date);

-- audit
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='audit_emi_plans') THEN
    CREATE TRIGGER audit_emi_plans AFTER INSERT OR UPDATE OR DELETE ON public.emi_plans FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='audit_sales_emi') THEN
    CREATE TRIGGER audit_sales_emi AFTER INSERT OR UPDATE OR DELETE ON public.sales_emi FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='audit_emi_installments') THEN
    CREATE TRIGGER audit_emi_installments AFTER INSERT OR UPDATE OR DELETE ON public.emi_installments FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  END IF;
END $$;

-- RLS
ALTER TABLE public.emi_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY emi_plans_read ON public.emi_plans FOR SELECT TO authenticated USING (public.is_member(business_id));
CREATE POLICY emi_plans_write ON public.emi_plans FOR ALL TO authenticated USING (public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])) WITH CHECK (public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[]));

ALTER TABLE public.sales_emi ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_emi_read ON public.sales_emi FOR SELECT TO authenticated USING (public.is_member(business_id));
CREATE POLICY sales_emi_write ON public.sales_emi FOR ALL TO authenticated USING (public.has_biz_role(business_id, ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[])) WITH CHECK (public.has_biz_role(business_id, ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]));

ALTER TABLE public.emi_installments ENABLE ROW LEVEL SECURITY;
CREATE POLICY emi_inst_read ON public.emi_installments FOR SELECT TO authenticated USING (public.is_member(business_id));
CREATE POLICY emi_inst_write ON public.emi_installments FOR ALL TO authenticated USING (public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])) WITH CHECK (public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[]));

-- RPCs
CREATE OR REPLACE FUNCTION public.save_emi_plan(_biz uuid, _id uuid DEFAULT NULL, _data jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid:=_id; v_name text:=NULLIF(_data->>'name',''); v_ten int:=COALESCE((_data->>'tenure_months')::int,0); v_rate numeric:=COALESCE((_data->>'interest_rate')::numeric,0); v_fee numeric:=COALESCE((_data->>'processing_fee')::numeric,0); v_dp numeric:=COALESCE((_data->>'downpayment_percent')::numeric,0); v_status public.record_status:=COALESCE(NULLIF(_data->>'status','')::public.record_status,'active');
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager','accountant']::public.member_role[]) THEN RAISE EXCEPTION 'No permission.'; END IF;
  IF v_name IS NULL OR v_ten<=0 OR v_dp<0 OR v_dp>100 OR v_rate<0 OR v_fee<0 THEN RAISE EXCEPTION 'Invalid data.'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.emi_plans(business_id,name,tenure_months,interest_rate,processing_fee,downpayment_percent,status) VALUES(_biz,v_name,v_ten,v_rate,v_fee,v_dp,v_status) RETURNING id INTO v_id;
  ELSE
    UPDATE public.emi_plans SET name=v_name,tenure_months=v_ten,interest_rate=v_rate,processing_fee=v_fee,downpayment_percent=v_dp,status=v_status,updated_at=now() WHERE id=v_id AND business_id=_biz;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.create_sales_emi(_biz uuid, _sale uuid, _plan uuid, _start_date date, _due_day int, _downpayment numeric, _tenure int, _monthly numeric, _financed numeric, _interest numeric, _processing numeric, _total numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_eid uuid; v_cur text;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager','salesman','branch_manager','accountant']::public.member_role[]) THEN RAISE EXCEPTION 'No permission.'; END IF;
  IF EXISTS (SELECT 1 FROM public.sales_emi WHERE sale_id=_sale AND business_id=_biz) THEN RAISE EXCEPTION 'EMI already exists.'; END IF;
  SELECT id INTO v_eid FROM public.sales WHERE id=_sale AND business_id=_biz;
  IF v_eid IS NULL THEN RAISE EXCEPTION 'Invalid sale.'; END IF;
  INSERT INTO public.sales_emi(business_id,sale_id,plan_id,total_amount,downpayment,financed_amount,interest_amount,processing_fee,tenure_months,monthly_amount,start_date,due_day,status) VALUES(_biz,_sale,_plan,_total,_downpayment,_financed,_interest,_processing,_tenure,_monthly,_start_date,_due_day,'active') RETURNING id INTO v_eid;
  RETURN v_eid;
END $$;

GRANT SELECT,INSERT,UPDATE,DELETE ON public.emi_plans TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sales_emi TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.emi_installments TO authenticated;
REVOKE ALL ON FUNCTION public.save_emi_plan(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_emi_plan(uuid,uuid,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.create_sales_emi(uuid,uuid,uuid,date,int,numeric,int,numeric,numeric,numeric,numeric,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_sales_emi(uuid,uuid,uuid,date,int,numeric,int,numeric,numeric,numeric,numeric,numeric) TO authenticated;
