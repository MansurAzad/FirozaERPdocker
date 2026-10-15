DO $$ DECLARE d text; BEGIN
SELECT pg_get_functiondef(oid) INTO d FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='_guardian_run';
d:=replace(d,$old$s.invoice_no||' · '||p.model||': sold ৳'||si.price||', cost ৳'||si.unit_cost$old$,$new$s.invoice_no||' · '||p.model||': net revenue after discount ৳'||round(si.line_total*(1-s.discount/nullif(s.subtotal,0)),2)||', line cost ৳'||(si.qty*si.unit_cost)||', net loss ৳'||round(si.qty*si.unit_cost-si.line_total*(1-s.discount/nullif(s.subtotal,0)),2)$new$);
d:=replace(d,$old$i.status='IN_STOCK'$old$,$new$i.status IN ('IN_STOCK','RESERVED') AND i.business_id=_biz$new$);
EXECUTE d;
SELECT pg_get_functiondef(oid) INTO d FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='guardian_snapshot';
d:=replace(d,$old$UNION ALL SELECT 'negative_stock'$old$,$new$UNION ALL SELECT 'warranty_replacement_review',count(*) FROM warranty_claims WHERE business_id=_biz AND status='replaced'
 UNION ALL SELECT 'negative_stock'$new$); EXECUTE d;
SELECT pg_get_functiondef(oid) INTO d FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='update_warranty_claim';
d:=replace(d,$old$  update warranty_claims set status=_status$old$,$new$  IF _status='replaced' THEN RAISE EXCEPTION 'Replacement requires a linked replacement IMEI and stock/accounting transaction. Use the approved return/re-entry workflow; status-only replacement is not allowed.'; END IF;
  update warranty_claims set status=_status$new$); EXECUTE d;
END $$;