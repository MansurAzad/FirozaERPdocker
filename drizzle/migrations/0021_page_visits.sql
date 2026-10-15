CREATE TABLE public.page_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  session_id text NOT NULL CHECK (length(session_id) <= 64),
  path text NOT NULL CHECK (length(path) <= 300),
  device text CHECK (length(device) <= 40),
  visited_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX page_visits_biz_at ON public.page_visits(business_id, visited_at DESC);
GRANT SELECT, INSERT ON public.page_visits TO authenticated;
GRANT ALL ON public.page_visits TO service_role;
ALTER TABLE public.page_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members log own visits" ON public.page_visits FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_member(business_id));
CREATE POLICY "owners managers read visits" ON public.page_visits FOR SELECT TO authenticated
  USING (public.has_biz_role(business_id, ARRAY['owner','manager']::member_role[]));
CREATE OR REPLACE FUNCTION public.visit_log(_biz uuid, _from timestamptz)
RETURNS TABLE(visited_at timestamptz, path text, device text, session_id text, user_name text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT v.visited_at, v.path, v.device, v.session_id,
    coalesce((SELECT m.display_name FROM public.business_members m WHERE m.user_id = v.user_id AND m.business_id = v.business_id LIMIT 1), left(v.user_id::text, 8))
  FROM public.page_visits v WHERE v.business_id = _biz AND v.visited_at >= _from
  ORDER BY v.visited_at DESC LIMIT 5000
$$;
GRANT EXECUTE ON FUNCTION public.visit_log(uuid, timestamptz) TO authenticated;