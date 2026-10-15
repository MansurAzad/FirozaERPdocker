CREATE TABLE public.guardian_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  check_code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  title text NOT NULL,
  detail text,
  ref_type text,
  ref_id uuid,
  fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','resolved','auto_fixed')),
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  UNIQUE (business_id, fingerprint)
);
CREATE INDEX guardian_alerts_biz_status ON public.guardian_alerts(business_id, status, severity);
GRANT SELECT ON public.guardian_alerts TO authenticated;
GRANT ALL ON public.guardian_alerts TO service_role;
ALTER TABLE public.guardian_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read guardian alerts" ON public.guardian_alerts FOR SELECT TO authenticated USING (public.is_member(business_id));

CREATE TABLE public.guardian_runs (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  last_run timestamptz NOT NULL DEFAULT now(),
  summary jsonb
);
GRANT SELECT ON public.guardian_runs TO authenticated;
GRANT ALL ON public.guardian_runs TO service_role;
ALTER TABLE public.guardian_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read guardian runs" ON public.guardian_runs FOR SELECT TO authenticated USING (public.is_member(business_id));

CREATE OR REPLACE FUNCTION public._guardian_run(_biz uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _now timestamptz := clock_timestamp(); _fixed int := 0; r record; _new text; _res jsonb;
BEGIN
  -- Auto-fix (low risk): normalize BD mobile numbers like +880 17-1234 5678 -> 01712345678
  FOR r IN SELECT id, name, mobile, 'customer' AS kind FROM customers WHERE business_id=_biz
           UNION ALL SELECT id, name, mobile, 'supplier' FROM suppliers WHERE business_id=_biz LOOP
    _new := regexp_replace(regexp_replace(coalesce(r.mobile,''), '\D', '', 'g'), '^88', '');
    IF _new <> r.mobile AND _new ~ '^01[3-9][0-9]{8}$' THEN
      IF r.kind='customer' THEN UPDATE customers SET mobile=_new WHERE id=r.id; ELSE UPDATE suppliers SET mobile=_new WHERE id=r.id; END IF;
      INSERT INTO guardian_alerts(business_id,check_code,severity,title,detail,ref_type,ref_id,fingerprint,status,resolved_at)
      VALUES (_biz,'mobile_format','low','Mobile number format corrected', r.name||': '||r.mobile||' → '||_new, r.kind, r.id,
              'mobile_fix:'||r.id||':'||_new, 'auto_fixed', now()) ON CONFLICT DO NOTHING;
      _fixed := _fixed + 1;
    END IF;
  END LOOP;

  CREATE TEMP TABLE IF NOT EXISTS _g(code text, sev text, title text, detail text, rtype text, rid uuid, fp text) ON COMMIT DROP;
  DELETE FROM _g;

  INSERT INTO _g SELECT 'unbalanced_journal','critical','Journal entry does not balance',
    'Entry #'||je.entry_no||': debit '||sum(jl.debit)||' vs credit '||sum(jl.credit),'journal',je.id,'unbalanced:'||je.id
  FROM journal_entries je JOIN journal_lines jl ON jl.entry_id=je.id WHERE je.business_id=_biz
  GROUP BY je.id, je.entry_no HAVING sum(jl.debit)<>sum(jl.credit);

  INSERT INTO _g SELECT 'below_cost','high','Sold below cost (loss)',
    s.invoice_no||' · '||p.model||': sold ৳'||si.price||', cost ৳'||si.unit_cost,'sale',s.id,'below_cost:'||si.id
  FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN product_variants v ON v.id=si.variant_id JOIN products p ON p.id=v.product_id
  WHERE si.business_id=_biz AND s.status='posted' AND si.price < si.unit_cost AND s.sale_date > current_date-90;

  INSERT INTO _g SELECT 'below_min','medium','Sold below minimum price',
    s.invoice_no||' · '||p.model||': ৳'||si.price||' (minimum ৳'||v.min_price||')','sale',s.id,'below_min:'||si.id
  FROM sale_items si JOIN sales s ON s.id=si.sale_id JOIN product_variants v ON v.id=si.variant_id JOIN products p ON p.id=v.product_id
  WHERE si.business_id=_biz AND s.status='posted' AND v.min_price>0 AND si.price < v.min_price AND si.price >= si.unit_cost AND s.sale_date > current_date-90;

  INSERT INTO _g SELECT 'stock_imei_mismatch','high','Stock count does not match IMEIs',
    p.model||' at '||b.name||': stock '||st.qty||', IMEIs in stock '||(SELECT count(*) FROM product_imeis i WHERE i.variant_id=st.variant_id AND i.branch_id=st.branch_id AND i.status='IN_STOCK'),
    'variant',st.variant_id,'stock_imei:'||st.variant_id||':'||st.branch_id
  FROM stock st JOIN product_variants v ON v.id=st.variant_id JOIN products p ON p.id=v.product_id JOIN categories c ON c.id=p.category_id JOIN branches b ON b.id=st.branch_id
  WHERE st.business_id=_biz AND c.is_serialized
    AND st.qty <> (SELECT count(*) FROM product_imeis i WHERE i.variant_id=st.variant_id AND i.branch_id=st.branch_id AND i.status='IN_STOCK');

  INSERT INTO _g SELECT 'sold_no_invoice','high','IMEI marked sold without a sale','IMEI '||i.imei1,'imei',i.id,'sold_no_inv:'||i.id
  FROM product_imeis i WHERE i.business_id=_biz AND i.status='SOLD' AND i.sale_item_id IS NULL;

  INSERT INTO _g SELECT 'negative_stock','high','Negative stock', p.model||' at '||b.name||': '||st.qty,'variant',st.variant_id,'neg_stock:'||st.variant_id||':'||st.branch_id
  FROM stock st JOIN product_variants v ON v.id=st.variant_id JOIN products p ON p.id=v.product_id JOIN branches b ON b.id=st.branch_id
  WHERE st.business_id=_biz AND st.qty<0;

  INSERT INTO _g SELECT 'negative_money','high','Account balance below zero', m.name||': ৳'||m.balance,'money_account',m.id,'neg_money:'||m.id
  FROM money_account_balances m WHERE m.business_id=_biz AND m.balance<0;

  INSERT INTO _g SELECT 'over_credit','medium','Customer over credit limit', c.name||': due ৳'||c.current_due||', limit ৳'||c.credit_limit,'customer',c.customer_id,'over_credit:'||c.customer_id
  FROM customer_balances c WHERE c.business_id=_biz AND c.credit_limit>0 AND c.current_due > c.credit_limit;

  INSERT INTO _g SELECT 'stale_due','medium','Customer due unpaid for 30+ days', c.name||' ('||c.mobile||'): due ৳'||c.current_due,'customer',c.customer_id,'stale_due:'||c.customer_id
  FROM customer_balances c WHERE c.business_id=_biz AND c.current_due>0
    AND coalesce(c.last_payment::date, c.last_sale::date, current_date) < current_date-30;

  INSERT INTO _g SELECT 'dup_mobile','low','Same mobile used by several customers', x.mobile||': '||x.names,'customer',x.id,'dup_cust:'||x.mobile
  FROM (SELECT mobile, string_agg(name, ', ') names, (array_agg(id))[1] id FROM customers WHERE business_id=_biz AND status='active' GROUP BY mobile HAVING count(*)>1) x;

  INSERT INTO _g SELECT 'dup_mobile','low','Same mobile used by several suppliers', x.mobile||': '||x.names,'supplier',x.id,'dup_sup:'||x.mobile
  FROM (SELECT mobile, string_agg(name, ', ') names, (array_agg(id))[1] id FROM suppliers WHERE business_id=_biz AND status='active' GROUP BY mobile HAVING count(*)>1) x;

  INSERT INTO _g SELECT 'unusual_expense','medium','Unusually large expense', ec.name||' on '||e.expense_date||': ৳'||e.amount||' (usual ~৳'||round(a.avg_amt)||')','expense',e.id,'big_exp:'||e.id
  FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id
  JOIN LATERAL (SELECT avg(amount) avg_amt, count(*) n FROM expenses x WHERE x.category_id=e.category_id AND x.id<>e.id AND x.reversed_at IS NULL AND x.expense_date > current_date-120) a ON true
  WHERE e.business_id=_biz AND e.reversed_at IS NULL AND e.expense_date > current_date-30 AND a.n>=3 AND e.amount > 3*a.avg_amt;

  INSERT INTO _g SELECT 'low_stock','low','Low stock', p.model||coalesce(' '||v.storage,'')||': '||coalesce(sum(st.qty),0)||' left (reorder at '||v.reorder_level||')','variant',v.id,'low_stock:'||v.id
  FROM product_variants v JOIN products p ON p.id=v.product_id LEFT JOIN stock st ON st.variant_id=v.id
  WHERE v.business_id=_biz AND v.status='active' AND v.reorder_level>0
  GROUP BY v.id, p.model, v.storage, v.reorder_level HAVING coalesce(sum(st.qty),0) <= v.reorder_level;

  INSERT INTO guardian_alerts(business_id,check_code,severity,title,detail,ref_type,ref_id,fingerprint,last_seen)
  SELECT _biz, code, sev, title, detail, rtype, rid, fp, _now FROM _g
  ON CONFLICT (business_id, fingerprint) DO UPDATE SET last_seen=_now, detail=EXCLUDED.detail,
    status = CASE WHEN guardian_alerts.status='resolved' THEN 'open' ELSE guardian_alerts.status END,
    resolved_at = CASE WHEN guardian_alerts.status='resolved' THEN NULL ELSE guardian_alerts.resolved_at END;

  -- problems that disappeared are closed automatically
  UPDATE guardian_alerts SET status='resolved', resolved_at=now()
  WHERE business_id=_biz AND status='open' AND last_seen < _now;

  SELECT jsonb_build_object('open', count(*) FILTER (WHERE status='open'),
    'critical', count(*) FILTER (WHERE status='open' AND severity='critical'),
    'high', count(*) FILTER (WHERE status='open' AND severity='high'),
    'auto_fixed_now', _fixed) INTO _res FROM guardian_alerts WHERE business_id=_biz;
  INSERT INTO guardian_runs(business_id,last_run,summary) VALUES (_biz, now(), _res)
  ON CONFLICT (business_id) DO UPDATE SET last_run=now(), summary=_res;
  RETURN _res;
END $$;
REVOKE EXECUTE ON FUNCTION public._guardian_run(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.run_guardian_checks(_biz uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager','accountant']::member_role[]) THEN
    RAISE EXCEPTION 'Only owner, manager or accountant can run the Guardian checks.';
  END IF;
  RETURN public._guardian_run(_biz);
END $$;
REVOKE EXECUTE ON FUNCTION public.run_guardian_checks(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_guardian_checks(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_guardian_alert(_biz uuid, _id uuid, _status text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager']::member_role[]) THEN
    RAISE EXCEPTION 'Only owner or manager can update alerts.';
  END IF;
  IF _status NOT IN ('open','dismissed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  UPDATE guardian_alerts SET status=_status, resolved_at = CASE WHEN _status='dismissed' THEN now() END,
    resolved_by = CASE WHEN _status='dismissed' THEN auth.uid() END
  WHERE id=_id AND business_id=_biz;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_guardian_alert(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_guardian_alert(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public._guardian_run_all() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record;
BEGIN
  FOR b IN SELECT id FROM businesses LOOP
    BEGIN PERFORM public._guardian_run(b.id); EXCEPTION WHEN others THEN RAISE WARNING 'guardian % failed: %', b.id, SQLERRM; END;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public._guardian_run_all() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('guardian-hourly', '7 * * * *', 'SELECT public._guardian_run_all()');