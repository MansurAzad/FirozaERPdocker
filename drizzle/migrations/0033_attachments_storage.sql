-- 0033_attachments_storage.sql
-- P2 — give the existing `attachments` table + RPCs (create_attachment,
-- get_attachments_for_record, delete_attachment) a real storage backend and
-- wire it into the UI.
--
-- The `attachments` table and its SECURITY DEFINER RPCs already exist
-- (0023/0024, re-guarded in 0030) but had nowhere to upload files. This
-- migration creates a private `attachments` bucket and tenant-scoped
-- storage.objects policies.
--
-- Object path convention used by the app:
--     {business_id}/{record_type}/{record_id}/{uuid}.{ext}
-- so the business id is the first folder and policies can scope by tenant.
--
-- `attachments.file_url` stores the storage object path (not a URL); the UI
-- resolves short-lived signed URLs on read.

-- ---------------------------------------------------------------------------
-- 1) Private bucket
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('attachments', 'attachments', false)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Tenant-scoped object policies
--    First folder must be a business id and the caller must be a member.
--    The regex guard stops a non-uuid folder from erroring the cast.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS attachments_objects_read ON storage.objects;
CREATE POLICY attachments_objects_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    AND public.is_member(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS attachments_objects_insert ON storage.objects;
CREATE POLICY attachments_objects_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    AND public.is_member(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS attachments_objects_delete ON storage.objects;
CREATE POLICY attachments_objects_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    AND public.has_biz_role(
      ((storage.foldername(name))[1])::uuid,
      ARRAY['owner', 'manager', 'accountant']::public.member_role[]
    )
  );

COMMENT ON TABLE public.attachments IS
  'Document attachments for records; file_url holds an object path inside the private attachments bucket.';
