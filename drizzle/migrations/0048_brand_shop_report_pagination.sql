DROP FUNCTION IF EXISTS public.brand_shop_report(uuid, uuid, date, date);

CREATE FUNCTION public.brand_shop_report(
  _biz uuid,
  _branch uuid,
  _from date,
  _to date,
  _section text,
  _offset integer,
  _limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  net_sales numeric(14,2);
  net_purchases numeric(14,2);
  revenue numeric(14,2);
  cost numeric(14,2);
  expense numeric(14,2);
  stock_value numeric(14,2);
  row_count bigint := 0;
  page_rows jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.has_biz_role(
    _biz,
    ARRAY['owner','manager','accountant','branch_manager']::public.member_role[]
  ) THEN
    RAISE EXCEPTION 'You do not have permission to view shop financial reports.';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _from > _to THEN
    RAISE EXCEPTION 'Invalid date range.';
  END IF;
  IF _offset IS NULL OR _offset < 0 OR _offset > 1000000
    OR _limit IS NULL OR _limit < 1 OR _limit > 100 THEN
    RAISE EXCEPTION 'Invalid report page.';
  END IF;
  IF _section IS NULL
    OR _section NOT IN ('sales','purchases','stock','expenses','returns','payments','report') THEN
    RAISE EXCEPTION 'Invalid report section.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches
    WHERE business_id = _biz AND id = _branch
  ) THEN
    RAISE EXCEPTION 'Shop not found.';
  END IF;

  SELECT
    COALESCE(sum(s.total), 0),
    COALESCE(sum(s.total - s.tax), 0),
    COALESCE(sum(s.cogs), 0)
  INTO net_sales, revenue, cost
  FROM public.sales s
  WHERE s.business_id = _biz AND s.branch_id = _branch
    AND s.status = 'posted' AND s.sale_date BETWEEN _from AND _to;

  SELECT
    net_sales - COALESCE(sum(r.total), 0),
    revenue - COALESCE(sum(r.total - r.tax_share), 0),
    cost - COALESCE(sum(r.cost_total), 0)
  INTO net_sales, revenue, cost
  FROM public.sales_returns r
  WHERE r.business_id = _biz AND r.branch_id = _branch
    AND r.return_date BETWEEN _from AND _to;

  SELECT COALESCE(sum(p.total), 0)
  INTO net_purchases
  FROM public.purchases p
  WHERE p.business_id = _biz AND p.branch_id = _branch
    AND p.status = 'posted' AND p.purchase_date BETWEEN _from AND _to;

  SELECT
    net_purchases - COALESCE(sum(pr.total), 0)
  INTO net_purchases
  FROM public.purchase_returns pr
  WHERE pr.business_id = _biz AND pr.branch_id = _branch
    AND pr.return_date BETWEEN _from AND _to
    AND EXISTS (
      SELECT 1 FROM public.stock_movements sm
      WHERE sm.business_id = _biz
        AND sm.ref_type = 'purchase_return'
        AND sm.ref_id = pr.id
    );

  SELECT COALESCE(sum(e.amount), 0)
  INTO expense
  FROM public.expenses e
  WHERE e.business_id = _biz AND e.branch_id = _branch
    AND e.reversed_at IS NULL AND e.expense_date BETWEEN _from AND _to;

  SELECT COALESCE(sum(s.qty * s.avg_cost), 0)
  INTO stock_value
  FROM public.stock s
  WHERE s.business_id = _biz AND s.branch_id = _branch;

  CASE _section
    WHEN 'sales' THEN
      SELECT count(*) INTO row_count
      FROM public.sales s
      WHERE s.business_id = _biz AND s.branch_id = _branch
        AND s.status = 'posted' AND s.sale_date BETWEEN _from AND _to;

      SELECT COALESCE(
        jsonb_agg(to_jsonb(page) ORDER BY page.sale_date DESC, page.id DESC),
        '[]'::jsonb
      )
      INTO page_rows
      FROM (
        SELECT s.id, s.invoice_no, s.sale_date, s.total, s.paid, s.due
        FROM public.sales s
        WHERE s.business_id = _biz AND s.branch_id = _branch
          AND s.status = 'posted' AND s.sale_date BETWEEN _from AND _to
        ORDER BY s.sale_date DESC, s.created_at DESC, s.id DESC
        LIMIT _limit OFFSET _offset
      ) page;

    WHEN 'purchases' THEN
      SELECT count(*) INTO row_count
      FROM public.purchases p
      WHERE p.business_id = _biz AND p.branch_id = _branch
        AND p.status = 'posted' AND p.purchase_date BETWEEN _from AND _to;

      SELECT COALESCE(
        jsonb_agg(to_jsonb(page) ORDER BY page.purchase_date DESC, page.id DESC),
        '[]'::jsonb
      )
      INTO page_rows
      FROM (
        SELECT p.id, p.invoice_no, p.purchase_date, p.total, p.paid, p.due
        FROM public.purchases p
        WHERE p.business_id = _biz AND p.branch_id = _branch
          AND p.status = 'posted' AND p.purchase_date BETWEEN _from AND _to
        ORDER BY p.purchase_date DESC, p.created_at DESC, p.id DESC
        LIMIT _limit OFFSET _offset
      ) page;

    WHEN 'stock' THEN
      SELECT count(*) INTO row_count
      FROM public.stock s
      WHERE s.business_id = _biz AND s.branch_id = _branch;

      SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.sku, page.variant_id), '[]'::jsonb)
      INTO page_rows
      FROM (
        SELECT
          s.variant_id,
          v.sku,
          p.model AS product,
          s.qty,
          s.avg_cost,
          v.reorder_level,
          s.qty * s.avg_cost AS value
        FROM public.stock s
        JOIN public.product_variants v
          ON v.id = s.variant_id AND v.business_id = _biz
        JOIN public.products p
          ON p.id = v.product_id AND p.business_id = _biz
        WHERE s.business_id = _biz AND s.branch_id = _branch
        ORDER BY v.sku, s.variant_id
        LIMIT _limit OFFSET _offset
      ) page;

    WHEN 'expenses' THEN
      SELECT count(*) INTO row_count
      FROM public.expenses e
      JOIN public.expense_categories c
        ON c.id = e.category_id AND c.business_id = _biz
      WHERE e.business_id = _biz AND e.branch_id = _branch
        AND e.reversed_at IS NULL AND e.expense_date BETWEEN _from AND _to;

      SELECT COALESCE(
        jsonb_agg(to_jsonb(page) ORDER BY page.date DESC, page.id DESC),
        '[]'::jsonb
      )
      INTO page_rows
      FROM (
        SELECT
          e.id,
          e.expense_date AS date,
          c.name AS category,
          e.description,
          e.amount
        FROM public.expenses e
        JOIN public.expense_categories c
          ON c.id = e.category_id AND c.business_id = _biz
        WHERE e.business_id = _biz AND e.branch_id = _branch
          AND e.reversed_at IS NULL AND e.expense_date BETWEEN _from AND _to
        ORDER BY e.expense_date DESC, e.created_at DESC, e.id DESC
        LIMIT _limit OFFSET _offset
      ) page;

    WHEN 'returns' THEN
      SELECT count(*) INTO row_count
      FROM (
        SELECT r.id
        FROM public.sales_returns r
        WHERE r.business_id = _biz AND r.branch_id = _branch
          AND r.return_date BETWEEN _from AND _to
        UNION ALL
        SELECT pr.id
        FROM public.purchase_returns pr
        WHERE pr.business_id = _biz AND pr.branch_id = _branch
          AND pr.return_date BETWEEN _from AND _to
          AND EXISTS (
            SELECT 1 FROM public.stock_movements sm
            WHERE sm.business_id = _biz
              AND sm.ref_type = 'purchase_return'
              AND sm.ref_id = pr.id
          )
      ) returns;

      SELECT COALESCE(
        jsonb_agg(to_jsonb(page) ORDER BY page.date DESC, page.id DESC),
        '[]'::jsonb
      )
      INTO page_rows
      FROM (
        SELECT r.id, 'Sales return'::text AS kind, r.return_no AS number,
          r.return_date AS date, r.total, r.refund
        FROM public.sales_returns r
        WHERE r.business_id = _biz AND r.branch_id = _branch
          AND r.return_date BETWEEN _from AND _to
        UNION ALL
        SELECT pr.id, 'Purchase return'::text AS kind, pr.return_no AS number,
          pr.return_date AS date, pr.total, pr.refund
        FROM public.purchase_returns pr
        WHERE pr.business_id = _biz AND pr.branch_id = _branch
          AND pr.return_date BETWEEN _from AND _to
          AND EXISTS (
            SELECT 1 FROM public.stock_movements sm
            WHERE sm.business_id = _biz
              AND sm.ref_type = 'purchase_return'
              AND sm.ref_id = pr.id
          )
        ORDER BY date DESC, id DESC
        LIMIT _limit OFFSET _offset
      ) page;

    WHEN 'payments' THEN
      SELECT count(*) INTO row_count
      FROM (
        SELECT cp.id
        FROM public.customer_payments cp
        JOIN public.sales s ON s.id = cp.sale_id AND s.business_id = _biz
        WHERE cp.business_id = _biz AND s.branch_id = _branch
          AND cp.paid_on BETWEEN _from AND _to
        UNION ALL
        SELECT sp.id
        FROM public.supplier_payments sp
        JOIN public.purchases p ON p.id = sp.purchase_id AND p.business_id = _biz
        WHERE sp.business_id = _biz AND p.branch_id = _branch
          AND sp.paid_on BETWEEN _from AND _to
      ) payments;

      SELECT COALESCE(
        jsonb_agg(to_jsonb(page) ORDER BY page.date DESC, page.id DESC),
        '[]'::jsonb
      )
      INTO page_rows
      FROM (
        SELECT cp.id, 'Customer receipt'::text AS kind,
          cp.paid_on AS date, cp.method, cp.amount, s.invoice_no AS invoice
        FROM public.customer_payments cp
        JOIN public.sales s ON s.id = cp.sale_id AND s.business_id = _biz
        WHERE cp.business_id = _biz AND s.branch_id = _branch
          AND cp.paid_on BETWEEN _from AND _to
        UNION ALL
        SELECT sp.id, 'Supplier payment'::text AS kind,
          sp.paid_on AS date, sp.method, sp.amount, p.invoice_no AS invoice
        FROM public.supplier_payments sp
        JOIN public.purchases p ON p.id = sp.purchase_id AND p.business_id = _biz
        WHERE sp.business_id = _biz AND p.branch_id = _branch
          AND sp.paid_on BETWEEN _from AND _to
        ORDER BY date DESC, id DESC
        LIMIT _limit OFFSET _offset
      ) page;

    WHEN 'report' THEN
      row_count := 8;
      page_rows := '[]'::jsonb;
  END CASE;

  RETURN jsonb_build_object(
    'metrics',
    jsonb_build_object(
      'net_sales', net_sales,
      'net_purchases', net_purchases,
      'revenue', revenue,
      'cost', cost,
      'expenses', expense,
      'gross_profit', revenue - cost,
      'trading_result', revenue - cost - expense,
      'stock_value', stock_value
    ),
    'rows', page_rows,
    'total', row_count
  );
END
$function$;

REVOKE ALL ON FUNCTION public.brand_shop_report(uuid, uuid, date, date, text, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_shop_report(uuid, uuid, date, date, text, integer, integer)
  TO authenticated;
