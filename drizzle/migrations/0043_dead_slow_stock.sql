-- 0043_dead_slow_stock.sql
-- Module 10: Dead / slow moving stock report.
--
-- Lists variants that still have stock but have not sold recently (or ever),
-- based on the last sale date versus configurable slow/dead thresholds.

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
      AND p.proname IN ('dead_slow_stock_report')
  LOOP
    EXECUTE format('DROP FUNCTION public.%I(%s)', r.proname, pg_get_function_identity_arguments(r.oid));
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.dead_slow_stock_report(
  _biz uuid,
  _slow_days integer DEFAULT 60,
  _dead_days integer DEFAULT 120
)
RETURNS TABLE (
  variant_id uuid,
  sku text,
  product text,
  brand text,
  qty integer,
  avg_cost numeric,
  stock_value numeric,
  last_sale date,
  days_since integer,
  bucket text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  IF NOT public.has_biz_role(
    _biz,
    ARRAY['owner','manager','accountant','store_keeper']::public.member_role[]
  ) THEN
    RAISE EXCEPTION 'You do not have permission.';
  END IF;

  RETURN QUERY
  WITH last_sales AS (
    SELECT si.variant_id AS vid, MAX(s.sale_date) AS last_sale
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    WHERE si.business_id = _biz
      AND s.status NOT IN ('cancelled', 'returned')
    GROUP BY si.variant_id
  ),
  rows AS (
    SELECT
      v.id AS vid,
      v.sku AS sku,
      p.model AS product,
      b.name AS brand,
      s.qty AS qty,
      s.avg_cost AS avg_cost,
      round(s.qty * s.avg_cost, 2) AS stock_value,
      ls.last_sale AS last_sale,
      (current_date - COALESCE(ls.last_sale, DATE '1900-01-01')) AS days_since
    FROM public.stock s
    JOIN public.product_variants v ON v.id = s.variant_id
    JOIN public.products p ON p.id = v.product_id
    LEFT JOIN public.brands b ON b.id = p.brand_id
    LEFT JOIN last_sales ls ON ls.vid = v.id
    WHERE s.business_id = _biz
      AND s.qty > 0
  )
  SELECT
    r.vid,
    r.sku,
    r.product,
    COALESCE(r.brand, ''),
    r.qty,
    r.avg_cost,
    r.stock_value,
    r.last_sale,
    r.days_since,
    (CASE
      WHEN r.last_sale IS NULL OR r.days_since >= _dead_days THEN 'dead'
      WHEN r.days_since >= _slow_days THEN 'slow'
      ELSE 'active'
    END)::text
  FROM rows r
  WHERE (r.last_sale IS NULL OR r.days_since >= _dead_days)
     OR r.days_since >= _slow_days
  ORDER BY r.stock_value DESC;
END
$func$;

REVOKE ALL ON FUNCTION public.dead_slow_stock_report(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dead_slow_stock_report(uuid, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.dead_slow_stock_report(uuid, integer, integer) IS
  'Dead / slow moving stock by last sale date versus the slow and dead thresholds.';
