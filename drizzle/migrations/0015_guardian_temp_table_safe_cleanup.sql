DO $$ DECLARE d text; BEGIN
SELECT pg_get_functiondef(oid) INTO d FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='_guardian_run';
d:=replace(d,'DELETE FROM _g;','DELETE FROM _g WHERE code IS NOT NULL;'); EXECUTE d;
END $$;