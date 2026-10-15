-- 0042_supplier_aging.sql
-- Module 9: Supplier aging report.
--
-- Buckets the outstanding supplier balance (purchases.due) by the age of the
-- purchase, as of a chosen date. Read-only report; tenant-checked.

-- Drop an earlier-draft version of this function (CREATE OR REPLACE cannot
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
      AND p.proname IN ('supplier_aging_report')
  LOOP
    EXECUTE format('DROP FUNCTION public.%I(%s)', r.proname, pg_get_function_identity_arguments(r.oid));
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.supplier_aging_report(_biz uuid, _as_of date DEFAULT current_date)
RETURNS TABLE (
  supplier_id uuid,
  supplier_name text,
  b0_30 numeric,
  b31_60 numeric,
  b61_90 numeric,
  b91_120 numeric,
  b_over_120 numeric,
  total_due numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  IF NOT public.has_biz_role(
    _biz,
    ARRAY['owner','manager','accountant']::public.member_role[]
  ) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;

  RETURN QUERY
  WITH aged AS (
    SELECT
      p.supplier_id AS sid,
      greatest(p.due, 0) AS due_amount,
      (_as_of - p.purchase_date) AS age_days
    FROM public.purchases p
    WHERE p.business_id = _biz
      AND p.purchase_date <= _as_of
      AND p.status <> 'cancelled'
      AND greatest(p.due, 0) > 0
  )
  SELECT
    s.id AS supplier_id,
    s.name AS supplier_name,
    round(COALESCE(SUM(a.due_amount) FILTER (WHERE a.age_days <= 30), 0), 2) AS b0_30,
    round(COALESCE(SUM(a.due_amount) FILTER (WHERE a.age_days BETWEEN 31 AND 60), 0), 2) AS b31_60,
    round(COALESCE(SUM(a.due_amount) FILTER (WHERE a.age_days BETWEEN 61 AND 90), 0), 2) AS b61_90,
    round(COALESCE(SUM(a.due_amount) FILTER (WHERE a.age_days BETWEEN 91 AND 120), 0), 2) AS b91_120,
    round(COALESCE(SUM(a.due_amount) FILTER (WHERE a.age_days > 120), 0), 2) AS b_over_120,
    round(COALESCE(SUM(a.due_amount), 0), 2) AS total_due
  FROM aged a
  JOIN public.suppliers s ON s.id = a.sid
  GROUP BY s.id, s.name
  HAVING COALESCE(SUM(a.due_amount), 0) > 0
  ORDER BY total_due DESC;
END
$func$;

REVOKE ALL ON FUNCTION public.supplier_aging_report(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_aging_report(uuid, date) TO authenticated;

COMMENT ON FUNCTION public.supplier_aging_report(uuid, date) IS
  'Outstanding supplier due bucketed by purchase age (0-30 / 31-60 / 61-90 / 91-120 / >120) as of a date.';
