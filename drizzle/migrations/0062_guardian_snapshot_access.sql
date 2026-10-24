DO $$
DECLARE
  v_definition text;
  v_updated_definition text;
  v_old_guard text := $old$IF NOT public.has_biz_role(_biz,ARRAY['owner','manager','accountant']::member_role[]) AND NOT (auth.uid() IS NULL AND current_user IN ('postgres','supabase_admin')) THEN RAISE EXCEPTION 'Owner, manager or accountant access required'; END IF;$old$;
  v_new_guard text := $new$IF auth.uid() IS NOT NULL AND (
   NOT public.has_biz_role(_biz,ARRAY['owner','manager','accountant']::member_role[])
   OR NOT public.has_module_access(_biz, 'guardian', 'view')
 ) THEN RAISE EXCEPTION 'Guardian access has not been granted'; END IF;$new$;
BEGIN
  SELECT pg_get_functiondef('public.guardian_snapshot(uuid)'::regprocedure)
  INTO v_definition;

  IF position('SECURITY DEFINER' IN v_definition) > 0
    AND position('Guardian access has not been granted' IN v_definition) > 0 THEN
    RETURN;
  END IF;
  IF position(v_old_guard IN v_definition) = 0 THEN
    RAISE EXCEPTION 'guardian_snapshot access guard changed; review this migration before applying';
  END IF;

  v_updated_definition := replace(v_definition, v_old_guard, v_new_guard);
  EXECUTE v_updated_definition;
END
$$;

ALTER FUNCTION public.guardian_snapshot(uuid) SECURITY DEFINER;