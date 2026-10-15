CREATE TABLE public.report_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, email)
);
GRANT SELECT, INSERT, DELETE ON public.report_recipients TO authenticated;
GRANT ALL ON public.report_recipients TO service_role;
ALTER TABLE public.report_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner/manager read recipients" ON public.report_recipients FOR SELECT TO authenticated
  USING (public.has_biz_role(business_id, ARRAY['owner','manager']::public.member_role[]));
CREATE POLICY "owner add recipients" ON public.report_recipients FOR INSERT TO authenticated
  WITH CHECK (public.has_biz_role(business_id, ARRAY['owner']::public.member_role[])
    AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND length(email) <= 254);
CREATE POLICY "owner remove recipients" ON public.report_recipients FOR DELETE TO authenticated
  USING (public.has_biz_role(business_id, ARRAY['owner']::public.member_role[]));
CREATE TRIGGER audit_report_recipients AFTER INSERT OR UPDATE OR DELETE ON public.report_recipients
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

CREATE OR REPLACE FUNCTION public.daily_summary(_biz uuid, _date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public.is_member(_biz) THEN RAISE EXCEPTION 'Not allowed'; END IF;
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
REVOKE ALL ON FUNCTION public.daily_summary(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_summary(uuid, date) TO authenticated;