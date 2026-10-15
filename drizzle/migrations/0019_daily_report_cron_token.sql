CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS private.job_tokens (name text PRIMARY KEY, token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(32),'hex'));
INSERT INTO private.job_tokens(name) SELECT 'daily_report' WHERE NOT EXISTS (SELECT 1 FROM private.job_tokens WHERE name='daily_report');

CREATE OR REPLACE FUNCTION public.verify_job_token(_name text, _token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = private, public AS $$
  SELECT EXISTS (SELECT 1 FROM private.job_tokens WHERE name=_name AND token=_token)
$$;
REVOKE ALL ON FUNCTION public.verify_job_token(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_job_token(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.daily_summary(_biz uuid, _date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' AND NOT public.is_member(_biz) THEN RAISE EXCEPTION 'Not allowed'; END IF;
  SELECT jsonb_build_object('date', _date, 'branches', COALESCE(jsonb_agg(x ORDER BY x->>'kind', x->>'name'), '[]'::jsonb)) INTO r
  FROM (
    SELECT jsonb_build_object(
      'id', b.id, 'name', b.name, 'kind', b.kind,
      'sales_count', (SELECT count(*) FROM sales s WHERE s.branch_id=b.id AND s.sale_date=_date AND s.status<>'cancelled'),
      'sales_total', (SELECT COALESCE(sum(s.total),0) FROM sales s WHERE s.branch_id=b.id AND s.sale_date=_date AND s.status<>'cancelled'),
      'gross_profit', (SELECT COALESCE(sum(s.total - s.tax - s.cogs),0) FROM sales s WHERE s.branch_id=b.id AND s.sale_date=_date AND s.status<>'cancelled'),
      'sales_due', (SELECT COALESCE(sum(s.due),0) FROM sales s WHERE s.branch_id=b.id AND s.sale_date=_date AND s.status<>'cancelled'),
      'returns_total', (SELECT COALESCE(sum(t.total),0) FROM sales_returns t WHERE t.branch_id=b.id AND t.return_date=_date),
      'purchases_total', (SELECT COALESCE(sum(p.total),0) FROM purchases p WHERE p.branch_id=b.id AND p.purchase_date=_date AND p.status<>'cancelled'),
      'expenses_total', (SELECT COALESCE(sum(e.amount),0) FROM expenses e WHERE e.branch_id=b.id AND e.expense_date=_date AND e.reversed_at IS NULL),
      'stock_units', (SELECT COALESCE(sum(st.qty),0) FROM stock st WHERE st.branch_id=b.id),
      'stock_value', (SELECT COALESCE(sum(st.qty*st.avg_cost),0) FROM stock st WHERE st.branch_id=b.id)
    ) x
    FROM branches b WHERE b.business_id=_biz AND b.status='active'
  ) q;
  RETURN r || jsonb_build_object(
    'due_collected', (SELECT COALESCE(sum(amount),0) FROM customer_payments WHERE business_id=_biz AND paid_on=_date),
    'supplier_paid', (SELECT COALESCE(sum(amount),0) FROM supplier_payments WHERE business_id=_biz AND paid_on=_date));
END $$;
GRANT EXECUTE ON FUNCTION public.daily_summary(uuid, date) TO service_role;