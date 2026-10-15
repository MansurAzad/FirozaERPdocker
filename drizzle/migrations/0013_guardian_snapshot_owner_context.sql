DO $$ DECLARE d text; BEGIN
 SELECT pg_get_functiondef(oid) INTO d FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='guardian_snapshot';
 d:=replace(d,$old$'expenses',coalesce((SELECT sum(amount) FROM expenses WHERE business_id=_biz AND reversed_at IS NULL),0)$old$,$new$'today_purchases',coalesce((SELECT sum(total) FROM purchases WHERE business_id=_biz AND status='posted' AND purchase_date=(now() AT TIME ZONE 'Asia/Dhaka')::date),0),'today_receipts',coalesce((SELECT sum(amount) FROM customer_payments WHERE business_id=_biz AND paid_on=(now() AT TIME ZONE 'Asia/Dhaka')::date),0),'today_supplier_payments',coalesce((SELECT sum(amount) FROM supplier_payments WHERE business_id=_biz AND paid_on=(now() AT TIME ZONE 'Asia/Dhaka')::date),0),'expenses',coalesce((SELECT sum(amount) FROM expenses WHERE business_id=_biz AND reversed_at IS NULL),0)$new$);
 d:=replace(d,$old$margin,s.discount,s.paid,s.due FROM sales$old$,$new$margin,s.discount,s.paid,s.due,s.customer_id,(SELECT current_due FROM customer_balances WHERE customer_id=s.customer_id AND business_id=_biz) customer_current_due,coalesce((SELECT sum(amount) FROM customer_payments WHERE customer_id=s.customer_id AND business_id=_biz AND sale_id IS NULL),0) subsequent_party_receipts FROM sales$new$);
 d:=replace(d,$old$'alerts',coalesce($old$,$new$'last_guardian_run',(SELECT last_run FROM guardian_runs WHERE business_id=_biz),'alerts',coalesce($new$);
 EXECUTE d;
END $$;
CREATE OR REPLACE FUNCTION public.resume_guardian_ai(_biz uuid, _confirm text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NOT has_biz_role(_biz,ARRAY['owner']::member_role[]) THEN RAISE EXCEPTION 'Only the owner can resume AI'; END IF;
 IF _confirm <> 'ACCESS RESTORED' THEN RAISE EXCEPTION 'Confirm that access has been restored'; END IF;
 UPDATE businesses SET guardian_ai_block=NULL WHERE id=_biz;
 INSERT INTO audit_logs(business_id,user_id,module,action,record_id) VALUES(_biz,auth.uid(),'guardian_ai','owner_resumed',_biz);
END $$;
REVOKE ALL ON FUNCTION public.resume_guardian_ai(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resume_guardian_ai(uuid,text) TO authenticated;