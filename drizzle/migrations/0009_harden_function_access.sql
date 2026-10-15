ALTER FUNCTION public._biz_tables() SET search_path = public;
ALTER FUNCTION public._bulk() SET search_path = public;
ALTER FUNCTION public.jl(uuid, numeric, numeric) SET search_path = public;
ALTER FUNCTION public.money_ledger_code(money_kind) SET search_path = public;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_member(uuid), public.has_biz_role(uuid, member_role[]) TO authenticated;