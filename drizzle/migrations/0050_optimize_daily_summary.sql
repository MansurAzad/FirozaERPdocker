CREATE INDEX IF NOT EXISTS idx_sales_returns_branch_date
  ON public.sales_returns(branch_id, return_date);

CREATE OR REPLACE FUNCTION public.daily_summary(_biz uuid, _date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' AND NOT public.is_member(_biz) THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  WITH branch_scope AS MATERIALIZED (
    SELECT id, name, kind
    FROM public.branches
    WHERE business_id = _biz AND status = 'active'
  ),
  sales_by_branch AS (
    SELECT s.branch_id,
      count(*) AS sales_count,
      sum(s.total) AS sales_total,
      sum(s.total - s.tax - s.cogs) AS gross_profit,
      sum(s.due) AS sales_due
    FROM public.sales s
    JOIN branch_scope b ON b.id = s.branch_id
    WHERE s.sale_date = _date AND s.status <> 'cancelled'
    GROUP BY s.branch_id
  ),
  returns_by_branch AS (
    SELECT t.branch_id, sum(t.total) AS returns_total
    FROM public.sales_returns t
    JOIN branch_scope b ON b.id = t.branch_id
    WHERE t.return_date = _date
    GROUP BY t.branch_id
  ),
  purchases_by_branch AS (
    SELECT p.branch_id, sum(p.total) AS purchases_total
    FROM public.purchases p
    JOIN branch_scope b ON b.id = p.branch_id
    WHERE p.purchase_date = _date AND p.status <> 'cancelled'
    GROUP BY p.branch_id
  ),
  expenses_by_branch AS (
    SELECT e.branch_id, sum(e.amount) AS expenses_total
    FROM public.expenses e
    JOIN branch_scope b ON b.id = e.branch_id
    WHERE e.expense_date = _date AND e.reversed_at IS NULL
    GROUP BY e.branch_id
  ),
  stock_by_branch AS (
    SELECT st.branch_id, sum(st.qty) AS stock_units, sum(st.qty * st.avg_cost) AS stock_value
    FROM public.stock st
    JOIN branch_scope b ON b.id = st.branch_id
    WHERE st.business_id = _biz
    GROUP BY st.branch_id
  )
  SELECT jsonb_build_object(
    'date', _date,
    'branches', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'name', b.name,
          'kind', b.kind,
          'sales_count', coalesce(s.sales_count, 0),
          'sales_total', coalesce(s.sales_total, 0),
          'gross_profit', coalesce(s.gross_profit, 0),
          'sales_due', coalesce(s.sales_due, 0),
          'returns_total', coalesce(rt.returns_total, 0),
          'purchases_total', coalesce(p.purchases_total, 0),
          'expenses_total', coalesce(e.expenses_total, 0),
          'stock_units', coalesce(st.stock_units, 0),
          'stock_value', coalesce(st.stock_value, 0)
        )
        ORDER BY b.kind, b.name
      ),
      '[]'::jsonb
    ),
    'due_collected', (
      SELECT coalesce(sum(cp.amount), 0)
      FROM public.customer_payments cp
      WHERE cp.business_id = _biz AND cp.paid_on = _date
    ),
    'supplier_paid', (
      SELECT coalesce(sum(sp.amount), 0)
      FROM public.supplier_payments sp
      WHERE sp.business_id = _biz AND sp.paid_on = _date
    )
  )
  INTO r
  FROM branch_scope b
  LEFT JOIN sales_by_branch s ON s.branch_id = b.id
  LEFT JOIN returns_by_branch rt ON rt.branch_id = b.id
  LEFT JOIN purchases_by_branch p ON p.branch_id = b.id
  LEFT JOIN expenses_by_branch e ON e.branch_id = b.id
  LEFT JOIN stock_by_branch st ON st.branch_id = b.id;

  RETURN r;
END;
$$;

GRANT EXECUTE ON FUNCTION public.daily_summary(uuid, date) TO authenticated, service_role;
