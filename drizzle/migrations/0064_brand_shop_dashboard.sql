CREATE FUNCTION public.brand_shop_dashboard(
  _biz uuid,
  _branch uuid,
  _date date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sales boolean;
  v_inventory boolean;
  v_money boolean;
BEGIN
  IF NOT public.has_biz_role(
    _biz,
    ARRAY['owner','manager','accountant','branch_manager']::public.member_role[]
  ) OR NOT public.has_module_access(_biz, 'reports', 'view')
    OR NOT public.can_access_shop_branch(_biz, _branch) THEN
    RAISE EXCEPTION 'You do not have access to this shop dashboard.';
  END IF;

  IF _date IS NULL THEN
    RAISE EXCEPTION 'Dashboard date is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.business_id = _biz
      AND b.id = _branch
      AND b.kind = 'branch'
      AND b.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Select an active brand shop.';
  END IF;

  v_sales := public.has_module_access(_biz, 'sales', 'view');
  v_inventory := public.has_module_access(_biz, 'inventory', 'view');
  v_money := public.has_module_access(_biz, 'cash_bank', 'view')
    OR public.has_module_access(_biz, 'closing', 'view');

  RETURN jsonb_build_object(
    'date', _date,
    'branch_id', _branch,
    'sales',
      CASE WHEN v_sales THEN (
        SELECT jsonb_build_object(
          'count', count(*)::integer,
          'total', coalesce(sum(s.total), 0),
          'paid', coalesce(sum(s.paid), 0),
          'due', coalesce(sum(s.due), 0)
        )
        FROM public.sales s
        WHERE s.business_id = _biz
          AND s.branch_id = _branch
          AND s.sale_date = _date
          AND s.status = 'posted'
      ) ELSE NULL END,
    'returns',
      CASE WHEN v_sales THEN (
        SELECT jsonb_build_object(
          'count', count(*)::integer,
          'total', coalesce(sum(r.total), 0),
          'refund', coalesce(sum(r.refund), 0)
        )
        FROM public.sales_returns r
        WHERE r.business_id = _biz
          AND r.branch_id = _branch
          AND r.return_date = _date
      ) ELSE NULL END,
    'cash_balance',
      CASE WHEN v_money THEN (
        SELECT coalesce(sum(
          ma.opening_balance + coalesce((
            SELECT sum(CASE WHEN t.direction = 'in' THEN t.amount ELSE -t.amount END)
            FROM public.money_transactions t
            WHERE t.business_id = _biz
              AND t.account_id = ma.id
          ), 0)
        ), 0)
        FROM public.money_accounts ma
        WHERE ma.business_id = _biz
          AND ma.branch_id = _branch
          AND ma.kind = 'cash'
      ) ELSE NULL END,
    'bank_balance',
      CASE WHEN v_money THEN (
        SELECT coalesce(sum(
          ma.opening_balance + coalesce((
            SELECT sum(CASE WHEN t.direction = 'in' THEN t.amount ELSE -t.amount END)
            FROM public.money_transactions t
            WHERE t.business_id = _biz
              AND t.account_id = ma.id
          ), 0)
        ), 0)
        FROM public.money_accounts ma
        WHERE ma.business_id = _biz
          AND ma.branch_id = _branch
          AND ma.kind <> 'cash'
      ) ELSE NULL END,
    'stock',
      CASE WHEN v_inventory THEN jsonb_build_object(
        'low_stock_count', (
          SELECT count(*)::integer
          FROM public.stock st
          JOIN public.product_variants v
            ON v.business_id = st.business_id
           AND v.id = st.variant_id
          WHERE st.business_id = _biz
            AND st.branch_id = _branch
            AND st.qty <= coalesce(v.reorder_level, 0)
        ),
        'low_stock', coalesce((
          SELECT jsonb_agg(to_jsonb(page))
          FROM (
            SELECT
              st.variant_id,
              v.sku,
              p.model AS product,
              st.qty,
              coalesce(v.reorder_level, 0) AS reorder_level
            FROM public.stock st
            JOIN public.product_variants v
              ON v.business_id = st.business_id
             AND v.id = st.variant_id
            JOIN public.products p
              ON p.business_id = v.business_id
             AND p.id = v.product_id
            WHERE st.business_id = _biz
              AND st.branch_id = _branch
              AND st.qty <= coalesce(v.reorder_level, 0)
            ORDER BY st.qty ASC, v.sku, st.variant_id
            LIMIT 8
          ) page
        ), '[]'::jsonb)
      ) ELSE NULL END
  );
END
$$;

REVOKE ALL ON FUNCTION public.brand_shop_dashboard(uuid, uuid, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_shop_dashboard(uuid, uuid, date)
  TO authenticated;
