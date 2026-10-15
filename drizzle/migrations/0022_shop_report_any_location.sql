CREATE OR REPLACE FUNCTION public.brand_shop_report(_biz uuid, _branch uuid, _from date, _to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE net_sales numeric(14,2); net_purchases numeric(14,2); revenue numeric(14,2); cost numeric(14,2); expense numeric(14,2); stock_value numeric(14,2);
BEGIN
IF NOT public.is_member(_biz) THEN RAISE EXCEPTION 'Access denied'; END IF;
IF _from IS NULL OR _to IS NULL OR _from>_to THEN RAISE EXCEPTION 'Invalid date range'; END IF;
IF NOT EXISTS(SELECT 1 FROM branches WHERE business_id=_biz AND id=_branch) THEN RAISE EXCEPTION 'Shop not found'; END IF;
SELECT COALESCE(sum(total),0),COALESCE(sum(total-tax),0),COALESCE(sum(cogs),0) INTO net_sales,revenue,cost FROM sales WHERE business_id=_biz AND branch_id=_branch AND status='posted' AND sale_date BETWEEN _from AND _to;
SELECT net_sales-COALESCE(sum(total),0),revenue-COALESCE(sum(total-tax_share),0),cost-COALESCE(sum(cost_total),0) INTO net_sales,revenue,cost FROM sales_returns WHERE business_id=_biz AND branch_id=_branch AND return_date BETWEEN _from AND _to;
SELECT COALESCE(sum(total),0) INTO net_purchases FROM purchases WHERE business_id=_biz AND branch_id=_branch AND status='posted' AND purchase_date BETWEEN _from AND _to;
SELECT net_purchases-COALESCE(sum(total),0) INTO net_purchases FROM purchase_returns WHERE business_id=_biz AND branch_id=_branch AND return_date BETWEEN _from AND _to;
SELECT COALESCE(sum(amount),0) INTO expense FROM expenses WHERE business_id=_biz AND branch_id=_branch AND reversed_at IS NULL AND expense_date BETWEEN _from AND _to;
SELECT COALESCE(sum(qty*avg_cost),0) INTO stock_value FROM stock WHERE business_id=_biz AND branch_id=_branch;
RETURN jsonb_build_object('metrics',jsonb_build_object('net_sales',net_sales,'net_purchases',net_purchases,'revenue',revenue,'cost',cost,'expenses',expense,'gross_profit',revenue-cost,'trading_result',revenue-cost-expense,'stock_value',stock_value),
'sales',COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sale_date DESC,s.created_at DESC) FROM sales s WHERE s.business_id=_biz AND s.branch_id=_branch AND s.status='posted' AND s.sale_date BETWEEN _from AND _to),'[]'::jsonb),
'purchases',COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.purchase_date DESC,p.created_at DESC) FROM purchases p WHERE p.business_id=_biz AND p.branch_id=_branch AND p.status='posted' AND p.purchase_date BETWEEN _from AND _to),'[]'::jsonb),
'expenses',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'date',e.expense_date,'description',e.description,'category',c.name,'amount',e.amount) ORDER BY e.expense_date DESC) FROM expenses e JOIN expense_categories c ON c.id=e.category_id AND c.business_id=_biz WHERE e.business_id=_biz AND e.branch_id=_branch AND e.reversed_at IS NULL AND e.expense_date BETWEEN _from AND _to),'[]'::jsonb),
'stock',COALESCE((SELECT jsonb_agg(jsonb_build_object('variant_id',s.variant_id,'sku',v.sku,'product',p.model,'qty',s.qty,'avg_cost',s.avg_cost,'reorder_level',v.reorder_level,'value',s.qty*s.avg_cost) ORDER BY v.sku) FROM stock s JOIN product_variants v ON v.id=s.variant_id AND v.business_id=_biz JOIN products p ON p.id=v.product_id AND p.business_id=_biz WHERE s.business_id=_biz AND s.branch_id=_branch),'[]'::jsonb),
'returns',COALESCE((SELECT jsonb_agg(x ORDER BY x->>'date' DESC) FROM (SELECT jsonb_build_object('id',id,'kind','Sales return','number',return_no,'date',return_date,'total',total,'refund',refund) x FROM sales_returns WHERE business_id=_biz AND branch_id=_branch AND return_date BETWEEN _from AND _to UNION ALL SELECT jsonb_build_object('id',id,'kind','Purchase return','number',return_no,'date',return_date,'total',total,'refund',refund) FROM purchase_returns WHERE business_id=_biz AND branch_id=_branch AND return_date BETWEEN _from AND _to) r),'[]'::jsonb),
'payments',COALESCE((SELECT jsonb_agg(x ORDER BY x->>'date' DESC) FROM (SELECT jsonb_build_object('id',p.id,'kind','Customer receipt','date',p.paid_on,'method',p.method,'amount',p.amount,'invoice',s.invoice_no) x FROM customer_payments p JOIN sales s ON s.id=p.sale_id AND s.business_id=_biz WHERE p.business_id=_biz AND s.branch_id=_branch AND p.paid_on BETWEEN _from AND _to UNION ALL SELECT jsonb_build_object('id',p.id,'kind','Supplier payment','date',p.paid_on,'method',p.method,'amount',p.amount,'invoice',s.invoice_no) FROM supplier_payments p JOIN purchases s ON s.id=p.purchase_id AND s.business_id=_biz WHERE p.business_id=_biz AND s.branch_id=_branch AND p.paid_on BETWEEN _from AND _to) r),'[]'::jsonb));
END $function$;