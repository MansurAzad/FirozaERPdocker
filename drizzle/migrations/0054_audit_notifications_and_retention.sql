ALTER TABLE public.audit_logs
  ALTER COLUMN record_id TYPE text USING record_id::text;

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS source_table text,
  ADD COLUMN IF NOT EXISTS actor_name text,
  ADD COLUMN IF NOT EXISTS actor_role text;

CREATE INDEX IF NOT EXISTS audit_logs_created_at_id_idx
  ON public.audit_logs (created_at, id);

CREATE TABLE public.audit_notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  module text NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_notifications_created_at_id_idx
  ON public.audit_notifications (created_at, id);

ALTER TABLE public.audit_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_notifications_members_read
  ON public.audit_notifications
  FOR SELECT TO authenticated
  USING (public.is_member(business_id));
GRANT SELECT ON public.audit_notifications TO authenticated;
GRANT ALL ON public.audit_notifications TO service_role;

COMMENT ON TABLE public.audit_notifications IS
  'Transient low-detail tenant event stream for in-app tones; detailed records stay protected in audit_logs.';

CREATE OR REPLACE FUNCTION public.fill_audit_log_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_name text;
  v_actor_role text;
BEGIN
  NEW.user_id := coalesce(NEW.user_id, auth.uid());

  IF NEW.user_id IS NOT NULL AND (NEW.actor_name IS NULL OR NEW.actor_role IS NULL) THEN
    SELECT coalesce(nullif(bm.display_name, ''), bm.user_id::text), bm.role::text
      INTO v_actor_name, v_actor_role
      FROM public.business_members bm
     WHERE bm.business_id = NEW.business_id
       AND bm.user_id = NEW.user_id;
  END IF;

  NEW.actor_name := coalesce(
    NEW.actor_name,
    v_actor_name,
    CASE WHEN NEW.user_id IS NULL THEN 'System' ELSE NEW.user_id::text END
  );
  NEW.actor_role := coalesce(NEW.actor_role, v_actor_role);
  NEW.source_table := coalesce(
    NEW.source_table,
    CASE WHEN NEW.module = 'company_profile' THEN 'businesses' ELSE NEW.module END
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fill_audit_log_context() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER audit_logs_fill_context
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.fill_audit_log_context();

CREATE OR REPLACE FUNCTION public.publish_audit_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.audit_notifications (business_id, module, action)
  VALUES (NEW.business_id, NEW.module, NEW.action);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_audit_notification() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER audit_logs_publish_notification
  AFTER INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.publish_audit_notification();

CREATE OR REPLACE FUNCTION public.audit_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row jsonb;
  v_business_id uuid;
  v_user_id uuid := auth.uid();
  v_actor_name text;
  v_actor_role text;
BEGIN
  IF public._bulk() THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  v_row := to_jsonb(coalesce(NEW, OLD));
  v_business_id := (v_row->>'business_id')::uuid;

  IF v_user_id IS NOT NULL THEN
    SELECT coalesce(nullif(bm.display_name, ''), bm.user_id::text), bm.role::text
      INTO v_actor_name, v_actor_role
      FROM public.business_members bm
     WHERE bm.business_id = v_business_id
       AND bm.user_id = v_user_id;
  ELSE
    v_actor_name := 'System';
  END IF;

  INSERT INTO public.audit_logs (
    business_id, user_id, actor_name, actor_role, module, source_table,
    action, record_id, old_value, new_value
  )
  VALUES (
    v_business_id,
    v_user_id,
    v_actor_name,
    v_actor_role,
    coalesce(public.access_module_for_table(TG_TABLE_NAME), TG_TABLE_NAME),
    TG_TABLE_NAME,
    lower(TG_OP),
    nullif(v_row->>'id', ''),
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END
  );

  RETURN coalesce(NEW, OLD);
END;
$$;

DO $$
DECLARE
  v_table record;
BEGIN
  FOR v_table IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND NOT c.relispartition
       AND c.relname NOT IN ('audit_logs', 'audit_notifications', 'page_visits')
       AND EXISTS (
         SELECT 1
           FROM pg_attribute a
          WHERE a.attrelid = c.oid
            AND a.attname = 'business_id'
            AND NOT a.attisdropped
       )
       AND NOT EXISTS (
         SELECT 1
           FROM pg_trigger t
          WHERE t.tgrelid = c.oid
            AND (
              t.tgfoid = 'public.audit_row()'::regprocedure
              OR t.tgname LIKE 'audit_%'
            )
            AND NOT t.tgisinternal
       )
  LOOP
    EXECUTE format(
      'CREATE TRIGGER audit_row_all_changes AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row()',
      v_table.relname
    );
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
         FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'audit_notifications'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_notifications;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_expired_audit_logs(_batch_size integer DEFAULT 2000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer;
  v_notifications_deleted integer;
  v_batch_size integer := greatest(1, least(coalesce(_batch_size, 2000), 10000));
BEGIN
  WITH expired AS (
    SELECT id
      FROM public.audit_logs
     WHERE created_at < clock_timestamp() - interval '30 days'
     ORDER BY created_at, id
     LIMIT v_batch_size
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.audit_logs a
   USING expired
   WHERE a.id = expired.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  WITH expired AS (
    SELECT id
      FROM public.audit_notifications
     WHERE created_at < clock_timestamp() - interval '1 day'
     ORDER BY created_at, id
     LIMIT v_batch_size
     FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.audit_notifications n
   USING expired
   WHERE n.id = expired.id;

  GET DIAGNOSTICS v_notifications_deleted = ROW_COUNT;
  v_deleted := v_deleted + v_notifications_deleted;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_audit_logs(integer) FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule(jobid)
  FROM cron.job
 WHERE jobname = 'audit-logs-retention';

SELECT cron.schedule(
  'audit-logs-retention',
  '*/5 * * * *',
  'SELECT public.purge_expired_audit_logs(2000);'
);
