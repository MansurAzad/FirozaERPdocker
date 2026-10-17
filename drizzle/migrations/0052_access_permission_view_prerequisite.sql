CREATE OR REPLACE FUNCTION public.has_module_access(
  _biz uuid,
  _module text,
  _permission text DEFAULT 'view'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN NOT EXISTS (
      SELECT 1 FROM public.business_members bm
      WHERE bm.business_id = _biz AND bm.user_id = auth.uid()
    ) THEN false
    WHEN EXISTS (
      SELECT 1 FROM public.business_members bm
      WHERE bm.business_id = _biz AND bm.user_id = auth.uid() AND bm.role = 'owner'
    ) THEN true
    ELSE
      coalesce(
        (
          SELECT p.allowed
          FROM public.business_access_permissions p
          WHERE p.business_id = _biz
            AND p.user_id = auth.uid()
            AND p.module = _module
            AND p.permission = 'view'
        ),
        (
          SELECT p.allowed
          FROM public.business_members bm
          JOIN public.business_access_permissions p
            ON p.access_role_id = bm.access_role_id
           AND p.business_id = bm.business_id
          WHERE bm.business_id = _biz
            AND bm.user_id = auth.uid()
            AND p.module = _module
            AND p.permission = 'view'
        ),
        false
      )
      AND (
        _permission = 'view'
        OR coalesce(
          (
            SELECT p.allowed
            FROM public.business_access_permissions p
            WHERE p.business_id = _biz
              AND p.user_id = auth.uid()
              AND p.module = _module
              AND p.permission = _permission
          ),
          (
            SELECT p.allowed
            FROM public.business_members bm
            JOIN public.business_access_permissions p
              ON p.access_role_id = bm.access_role_id
             AND p.business_id = bm.business_id
            WHERE bm.business_id = _biz
              AND bm.user_id = auth.uid()
              AND p.module = _module
              AND p.permission = _permission
          ),
          false
        )
      )
  END
$$;
