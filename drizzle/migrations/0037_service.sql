-- 0037_service.sql
-- Module 4: Service / Repair Jobs (separate from Warranty)

-- Drop earlier-draft versions of these functions (CREATE OR REPLACE cannot
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
      AND p.proname IN ('save_service_job', 'update_service_status')
  LOOP
    EXECUTE format('DROP FUNCTION public.%I(%s)', r.proname, pg_get_function_identity_arguments(r.oid));
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.service_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  job_no text NOT NULL,
  device_type text,
  brand text,
  model text,
  serial_imei text,
  problem text,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','in_progress','waiting_parts','ready_for_pickup','completed','returned','cancelled')),
  technician_id uuid REFERENCES auth.users(id),
  assigned_to text,
  received_at timestamptz NOT NULL DEFAULT now(),
  estimated_delivery date,
  actual_delivery date,
  estimated_cost numeric(14,2) DEFAULT 0,
  parts_cost numeric(14,2) DEFAULT 0,
  labor_cost numeric(14,2) DEFAULT 0,
  total_cost numeric(14,2) DEFAULT 0,
  advance numeric(14,2) DEFAULT 0,
  balance numeric(14,2) DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, job_no)
);

CREATE INDEX IF NOT EXISTS idx_service_jobs_biz ON public.service_jobs(business_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_jobs_status ON public.service_jobs(business_id, status);

CREATE TABLE IF NOT EXISTS public.service_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.service_jobs(id) ON DELETE CASCADE,
  description text NOT NULL,
  qty integer NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_items_job ON public.service_items(job_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='audit_service_jobs') THEN
    CREATE TRIGGER audit_service_jobs AFTER INSERT OR UPDATE OR DELETE ON public.service_jobs FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='audit_service_items') THEN
    CREATE TRIGGER audit_service_items AFTER INSERT OR UPDATE OR DELETE ON public.service_items FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  END IF;
END $$;

ALTER TABLE public.service_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sj_read ON public.service_jobs;
DROP POLICY IF EXISTS sj_write ON public.service_jobs;
CREATE POLICY sj_read ON public.service_jobs FOR SELECT TO authenticated USING (public.is_member(business_id));
CREATE POLICY sj_write ON public.service_jobs FOR ALL TO authenticated USING (public.has_biz_role(business_id, ARRAY['owner','manager','salesman','branch_manager','accountant','store_keeper']::public.member_role[])) WITH CHECK (public.has_biz_role(business_id, ARRAY['owner','manager','salesman','branch_manager','accountant','store_keeper']::public.member_role[]));

ALTER TABLE public.service_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS si_read ON public.service_items;
DROP POLICY IF EXISTS si_write ON public.service_items;
CREATE POLICY si_read ON public.service_items FOR SELECT TO authenticated USING (public.is_member(business_id));
CREATE POLICY si_write ON public.service_items FOR ALL TO authenticated USING (public.has_biz_role(business_id, ARRAY['owner','manager','accountant','store_keeper']::public.member_role[])) WITH CHECK (public.has_biz_role(business_id, ARRAY['owner','manager','accountant','store_keeper']::public.member_role[]));

CREATE OR REPLACE FUNCTION public.save_service_job(_biz uuid, _id uuid DEFAULT NULL, _data jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid:=_id; v_branch uuid:=NULLIF(_data->>'branch_id','')::uuid; v_cust uuid:=NULLIF(_data->>'customer_id','')::uuid; v_job text; v_seq int; v_cur text;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager','salesman','branch_manager','accountant','store_keeper']::public.member_role[]) THEN RAISE EXCEPTION 'No permission.'; END IF;
  IF v_branch IS NULL OR NOT EXISTS (SELECT 1 FROM public.branches WHERE id=v_branch AND business_id=_biz AND status='active') THEN RAISE EXCEPTION 'Invalid branch.'; END IF;
  IF v_cust IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id=v_cust AND business_id=_biz) THEN RAISE EXCEPTION 'Invalid customer.'; END IF;
  IF v_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('sj_no_'||_biz::text));
    SELECT COALESCE(MAX(NULLIF(regexp_replace(job_no,'\D','','g'),'')::int),0)+1 INTO v_seq FROM public.service_jobs WHERE business_id=_biz;
    v_job:='SJ-'||lpad(v_seq::text,6,'0');
    INSERT INTO public.service_jobs(business_id,branch_id,customer_id,job_no,device_type,brand,model,serial_imei,problem,assigned_to,estimated_delivery,estimated_cost,note)
    VALUES(_biz,v_branch,v_cust,v_job,NULLIF(_data->>'device_type',''),NULLIF(_data->>'brand',''),NULLIF(_data->>'model',''),NULLIF(_data->>'serial_imei',''),NULLIF(_data->>'problem',''),NULLIF(_data->>'assigned_to',''),NULLIF(_data->>'estimated_delivery','')::date,COALESCE((_data->>'estimated_cost')::numeric,0),NULLIF(_data->>'note','')) RETURNING id INTO v_id;
  ELSE
    SELECT status INTO v_cur FROM public.service_jobs WHERE id=v_id AND business_id=_biz FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Not found.'; END IF;
    IF v_cur='completed' OR v_cur='returned' OR v_cur='cancelled' THEN RAISE EXCEPTION 'Cannot edit closed job.'; END IF;
    UPDATE public.service_jobs SET branch_id=v_branch,customer_id=v_cust,device_type=NULLIF(_data->>'device_type',''),brand=NULLIF(_data->>'brand',''),model=NULLIF(_data->>'model',''),serial_imei=NULLIF(_data->>'serial_imei',''),problem=NULLIF(_data->>'problem',''),assigned_to=NULLIF(_data->>'assigned_to',''),estimated_delivery=NULLIF(_data->>'estimated_delivery','')::date,estimated_cost=COALESCE((_data->>'estimated_cost')::numeric,0),note=NULLIF(_data->>'note',''),updated_at=now() WHERE id=v_id;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.update_service_status(_biz uuid, _id uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_cur text;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager','salesman','branch_manager','accountant','store_keeper']::public.member_role[]) THEN RAISE EXCEPTION 'No permission.'; END IF;
  IF _status NOT IN ('received','in_progress','waiting_parts','ready_for_pickup','completed','returned','cancelled') THEN RAISE EXCEPTION 'Invalid status.'; END IF;
  SELECT status INTO v_cur FROM public.service_jobs WHERE id=_id AND business_id=_biz FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found.'; END IF;
  IF v_cur IN ('completed','returned','cancelled') THEN RAISE EXCEPTION 'Closed.'; END IF;
  UPDATE public.service_jobs SET status=_status, actual_delivery=CASE WHEN _status IN ('completed','returned') THEN now()::date ELSE actual_delivery END, updated_at=now() WHERE id=_id;
END $$;

GRANT SELECT,INSERT,UPDATE,DELETE ON public.service_jobs TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.service_items TO authenticated;
REVOKE ALL ON FUNCTION public.save_service_job(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_service_job(uuid,uuid,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.update_service_status(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_service_status(uuid,uuid,text) TO authenticated;
