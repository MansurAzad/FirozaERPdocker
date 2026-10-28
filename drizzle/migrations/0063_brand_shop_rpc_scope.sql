BEGIN;

CREATE OR REPLACE FUNCTION public.can_access_shop_branch(_biz uuid, _branch uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    EXISTS (
      SELECT 1
      FROM public.business_members bm
      WHERE bm.business_id = _biz
        AND bm.user_id = auth.uid()
        AND bm.role = ANY(ARRAY[
          'owner','manager','accountant'
        ]::public.member_role[])
    )
    AND (
      _branch IS NULL
      OR EXISTS (
        SELECT 1 FROM public.branches b
        WHERE b.business_id = _biz AND b.id = _branch
      )
    )
  ) OR (
    _branch IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.branches b
      JOIN public.partner_finance_branch_access a
        ON a.business_id = b.business_id
       AND a.branch_id = b.id
       AND a.user_id = auth.uid()
      WHERE b.business_id = _biz
        AND b.id = _branch
        AND b.kind = 'branch'
        AND b.status = 'active'
    )
  )
$$;

REVOKE ALL ON FUNCTION public.can_access_shop_branch(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_shop_branch(uuid, uuid) TO authenticated;

ALTER FUNCTION public.brand_shop_report(uuid, uuid, date, date, text, integer, integer)
  RENAME TO brand_shop_report_unscoped;
REVOKE ALL ON FUNCTION public.brand_shop_report_unscoped(
  uuid, uuid, date, date, text, integer, integer
) FROM PUBLIC, anon, authenticated;

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
AS $$
BEGIN
  IF NOT public.has_module_access(_biz, 'reports', 'view')
    OR NOT EXISTS (
      SELECT 1 FROM public.business_members bm
      WHERE bm.business_id = _biz
        AND bm.user_id = auth.uid()
        AND bm.role = ANY(ARRAY[
          'owner','manager','accountant','branch_manager'
        ]::public.member_role[])
    )
    OR NOT public.can_access_shop_branch(_biz, _branch) THEN
    RAISE EXCEPTION 'You do not have access to this shop report.';
  END IF;

  IF NOT (
    CASE _section
    WHEN 'report' THEN true
    WHEN 'sales' THEN public.has_module_access(_biz, 'sales', 'view')
    WHEN 'purchases' THEN public.has_module_access(_biz, 'purchases', 'view')
    WHEN 'stock' THEN public.has_module_access(_biz, 'inventory', 'view')
    WHEN 'expenses' THEN public.has_module_access(_biz, 'expenses', 'view')
    WHEN 'returns' THEN
      public.has_module_access(_biz, 'sales', 'view')
      AND public.has_module_access(_biz, 'purchase_returns', 'view')
    WHEN 'payments' THEN
      public.has_module_access(_biz, 'customers', 'view')
      AND public.has_module_access(_biz, 'supplier_payments', 'view')
    ELSE false
    END
  ) THEN
    RAISE EXCEPTION 'You do not have permission to view this report section.';
  END IF;

  RETURN public.brand_shop_report_unscoped(
    _biz, _branch, _from, _to, _section, _offset, _limit
  );
END
$$;

REVOKE ALL ON FUNCTION public.brand_shop_report(
  uuid, uuid, date, date, text, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brand_shop_report(
  uuid, uuid, date, date, text, integer, integer
) TO authenticated;

ALTER FUNCTION public.daily_summary(uuid, date)
  RENAME TO daily_summary_unscoped;
REVOKE ALL ON FUNCTION public.daily_summary_unscoped(uuid, date)
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.daily_summary(_biz uuid, _date date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_branches jsonb;
  v_due_collected numeric(14,2);
  v_supplier_paid numeric(14,2);
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
    AND NOT public.has_module_access(_biz, 'daily_reports', 'view') THEN
    RAISE EXCEPTION 'Daily report access has not been granted.';
  END IF;

  v_result := public.daily_summary_unscoped(_biz, _date);

  IF coalesce(auth.role(), '') = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.business_members bm
      WHERE bm.business_id = _biz
        AND bm.user_id = auth.uid()
        AND bm.role = ANY(ARRAY[
          'owner','manager','accountant'
        ]::public.member_role[])
    ) THEN
    RETURN v_result;
  END IF;

  SELECT coalesce(jsonb_agg(branch), '[]'::jsonb)
    INTO v_branches
    FROM jsonb_array_elements(coalesce(v_result->'branches', '[]'::jsonb)) AS branch
   WHERE public.can_access_shop_branch(_biz, (branch->>'id')::uuid);

  SELECT coalesce(sum(cp.amount), 0)
    INTO v_due_collected
    FROM public.customer_payments cp
   WHERE cp.business_id = _biz
     AND cp.paid_on = _date
     AND public.can_access_shop_branch(_biz, cp.branch_id);

  SELECT coalesce(sum(sp.amount), 0)
    INTO v_supplier_paid
    FROM public.supplier_payments sp
   WHERE sp.business_id = _biz
     AND sp.paid_on = _date
     AND public.can_access_shop_branch(_biz, sp.branch_id);

  RETURN jsonb_set(
    jsonb_set(
      jsonb_set(v_result, '{branches}', v_branches),
      '{due_collected}', to_jsonb(v_due_collected)
    ),
    '{supplier_paid}', to_jsonb(v_supplier_paid)
  );
END
$$;

REVOKE ALL ON FUNCTION public.daily_summary(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_summary(uuid, date)
  TO authenticated, service_role;

CREATE POLICY brand_shop_branches_read_scope
  ON public.branches AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_module_access(business_id, 'branches', 'view')
    AND public.can_access_shop_branch(business_id, id)
  );

CREATE POLICY brand_shop_stock_read_scope
  ON public.stock AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_module_access(business_id, 'inventory', 'view')
    AND public.can_access_shop_branch(business_id, branch_id)
  );
CREATE POLICY brand_shop_stock_movements_read_scope
  ON public.stock_movements AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_module_access(business_id, 'inventory', 'view')
    AND public.can_access_shop_branch(business_id, branch_id)
  );
CREATE POLICY brand_shop_imeis_read_scope
  ON public.product_imeis AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_module_access(business_id, 'imei', 'view')
    AND public.can_access_shop_branch(business_id, branch_id)
  );

CREATE POLICY brand_shop_purchases_read_scope
  ON public.purchases AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_module_access(business_id, 'purchases', 'view')
    AND public.can_access_shop_branch(business_id, branch_id)
  );
CREATE POLICY brand_shop_purchase_items_read_scope
  ON public.purchase_items AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_module_access(business_id, 'purchases', 'view')
    AND EXISTS (
      SELECT 1 FROM public.purchases p
      WHERE p.business_id = purchase_items.business_id
        AND p.id = purchase_items.purchase_id
        AND public.can_access_shop_branch(p.business_id, p.branch_id)
    )
  );
CREATE POLICY brand_shop_supplier_payments_read_scope
  ON public.supplier_payments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_module_access(business_id, 'supplier_payments', 'view')
    AND public.can_access_shop_branch(business_id, branch_id)
  );

CREATE POLICY brand_shop_money_accounts_read_scope
  ON public.money_accounts AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (
      public.has_module_access(business_id, 'cash_bank', 'view')
      OR public.has_module_access(business_id, 'closing', 'view')
    )
    AND public.can_access_shop_branch(business_id, branch_id)
  );
CREATE POLICY brand_shop_money_transactions_read_scope
  ON public.money_transactions AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    (
      public.has_module_access(business_id, 'cash_bank', 'view')
      OR public.has_module_access(business_id, 'closing', 'view')
    )
    AND public.can_access_shop_branch(
      business_id,
      coalesce(
        branch_id,
        (
          SELECT ma.branch_id
          FROM public.money_accounts ma
          WHERE ma.business_id = money_transactions.business_id
            AND ma.id = money_transactions.account_id
        )
      )
    )
  );

CREATE POLICY brand_shop_expenses_read_scope
  ON public.expenses AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_module_access(business_id, 'expenses', 'view')
    AND public.can_access_shop_branch(business_id, branch_id)
  );
CREATE POLICY brand_shop_purchase_returns_read_scope
  ON public.purchase_returns AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_module_access(business_id, 'purchase_returns', 'view')
    AND public.can_access_shop_branch(business_id, branch_id)
  );
CREATE POLICY brand_shop_purchase_return_items_read_scope
  ON public.purchase_return_items AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_module_access(business_id, 'purchase_returns', 'view')
    AND EXISTS (
      SELECT 1 FROM public.purchase_returns r
      WHERE r.business_id = purchase_return_items.business_id
        AND r.id = purchase_return_items.return_id
        AND public.can_access_shop_branch(r.business_id, r.branch_id)
    )
  );

CREATE POLICY brand_shop_purchase_orders_read_scope
  ON public.purchase_orders AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_module_access(business_id, 'purchase_orders', 'view')
    AND public.can_access_shop_branch(business_id, branch_id)
  );
CREATE POLICY brand_shop_purchase_order_items_read_scope
  ON public.purchase_order_items AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_module_access(business_id, 'purchase_orders', 'view')
    AND EXISTS (
      SELECT 1 FROM public.purchase_orders po
      WHERE po.business_id = purchase_order_items.business_id
        AND po.id = purchase_order_items.po_id
        AND public.can_access_shop_branch(po.business_id, po.branch_id)
    )
  );

CREATE POLICY brand_shop_stock_adjustments_read_scope
  ON public.stock_adjustments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_module_access(business_id, 'stock_adjustments', 'view')
    AND public.can_access_shop_branch(business_id, branch_id)
  );
CREATE POLICY brand_shop_stock_adjustment_items_read_scope
  ON public.stock_adjustment_items AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_module_access(business_id, 'stock_adjustments', 'view')
    AND EXISTS (
      SELECT 1 FROM public.stock_adjustments a
      WHERE a.business_id = stock_adjustment_items.business_id
        AND a.id = stock_adjustment_items.adjustment_id
        AND public.can_access_shop_branch(a.business_id, a.branch_id)
    )
  );

CREATE POLICY brand_shop_transfers_read_scope
  ON public.stock_transfers AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_module_access(business_id, 'transfers', 'view')
    AND (
      public.can_access_shop_branch(business_id, from_branch_id)
      OR public.can_access_shop_branch(business_id, to_branch_id)
    )
  );
CREATE POLICY brand_shop_transfer_items_read_scope
  ON public.stock_transfer_items AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_module_access(business_id, 'transfers', 'view')
    AND EXISTS (
      SELECT 1 FROM public.stock_transfers t
      WHERE t.business_id = stock_transfer_items.business_id
        AND t.id = stock_transfer_items.transfer_id
        AND (
          public.can_access_shop_branch(t.business_id, t.from_branch_id)
          OR public.can_access_shop_branch(t.business_id, t.to_branch_id)
        )
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_shop_branch_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
  v_business uuid;
  v_branch uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  IF TG_OP <> 'INSERT' THEN
    v_business := (v_old->>'business_id')::uuid;
    v_branch := (v_old->>'branch_id')::uuid;
    IF NOT public.can_access_shop_branch(v_business, v_branch) THEN
      RAISE EXCEPTION 'You do not have access to this shop.';
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_business := (v_new->>'business_id')::uuid;
    v_branch := (v_new->>'branch_id')::uuid;
    IF NOT public.can_access_shop_branch(v_business, v_branch) THEN
      RAISE EXCEPTION 'You do not have access to this shop.';
    END IF;
    IF TG_OP = 'INSERT' AND v_branch IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.business_id = v_business
        AND b.id = v_branch
        AND b.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Shop operations require an active brand shop.';
    END IF;
    IF TG_OP = 'UPDATE'
      AND v_branch IS NOT NULL
      AND v_branch IS DISTINCT FROM (v_old->>'branch_id')::uuid
      AND NOT EXISTS (
        SELECT 1 FROM public.branches b
        WHERE b.business_id = v_business
          AND b.id = v_branch
          AND b.status = 'active'
      ) THEN
      RAISE EXCEPTION 'Shop operations require an active brand shop.';
    END IF;
  END IF;

  RETURN coalesce(NEW, OLD);
END
$$;

CREATE OR REPLACE FUNCTION public.assign_partner_finance_branch_access(
  _biz uuid, _user uuid, _branch uuid, _enabled boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.member_role;
BEGIN
  IF NOT public.has_module_access(_biz, 'sales', 'view')
    OR NOT (
      public.has_module_access(_biz, 'sales', 'create')
      OR public.has_module_access(_biz, 'sales', 'edit')
    )
    OR NOT public.has_biz_role(_biz, ARRAY['owner','manager']::public.member_role[]) THEN
    RAISE EXCEPTION 'Only an owner or manager with Sales access can assign shop access.';
  END IF;

  SELECT role INTO v_role
  FROM public.business_members
  WHERE business_id = _biz AND user_id = _user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business member not found.'; END IF;
  IF v_role NOT IN ('branch_manager','salesman','store_keeper','purchase_officer') THEN
    RAISE EXCEPTION 'Only shop-scoped staff can be assigned to brand shops.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches
    WHERE business_id = _biz AND id = _branch AND kind = 'branch' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Select an active brand shop.';
  END IF;

  IF _enabled THEN
    INSERT INTO public.partner_finance_branch_access(business_id,user_id,branch_id,granted_by)
    VALUES (_biz,_user,_branch,auth.uid())
    ON CONFLICT (business_id,user_id,branch_id) DO UPDATE SET granted_by = auth.uid();
  ELSE
    DELETE FROM public.partner_finance_branch_access
    WHERE business_id = _biz AND user_id = _user AND branch_id = _branch;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.set_money_transaction_shop_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_branch uuid;
  v_document_branch uuid;
BEGIN
  SELECT branch_id INTO v_account_branch
  FROM public.money_accounts
  WHERE business_id = NEW.business_id AND id = NEW.account_id;

  CASE NEW.ref_type
    WHEN 'sale' THEN
      SELECT branch_id INTO v_document_branch FROM public.sales
      WHERE business_id = NEW.business_id AND id = NEW.ref_id;
    WHEN 'purchase' THEN
      SELECT branch_id INTO v_document_branch FROM public.purchases
      WHERE business_id = NEW.business_id AND id = NEW.ref_id;
    WHEN 'expense' THEN
      SELECT branch_id INTO v_document_branch FROM public.expenses
      WHERE business_id = NEW.business_id AND id = NEW.ref_id;
    WHEN 'sales_return' THEN
      SELECT branch_id INTO v_document_branch FROM public.sales_returns
      WHERE business_id = NEW.business_id AND id = NEW.ref_id;
    WHEN 'purchase_return' THEN
      SELECT branch_id INTO v_document_branch FROM public.purchase_returns
      WHERE business_id = NEW.business_id AND id = NEW.ref_id;
    ELSE
      NULL;
  END CASE;

  IF NEW.branch_id IS NOT NULL AND v_document_branch IS NOT NULL
    AND NEW.branch_id IS DISTINCT FROM v_document_branch THEN
    RAISE EXCEPTION 'Money transaction shop does not match its source document.';
  END IF;
  IF NEW.branch_id IS NOT NULL AND v_account_branch IS NOT NULL
    AND NEW.branch_id IS DISTINCT FROM v_account_branch THEN
    RAISE EXCEPTION 'Money transaction shop does not match its cash/bank account.';
  END IF;
  IF v_account_branch IS NOT NULL AND v_document_branch IS NOT NULL
    AND v_account_branch IS DISTINCT FROM v_document_branch THEN
    RAISE EXCEPTION 'Money account belongs to a different shop than the source document.';
  END IF;

  NEW.branch_id := coalesce(NEW.branch_id, v_document_branch, v_account_branch);
  IF NEW.branch_id IS NULL AND auth.uid() IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.business_members bm
      WHERE bm.business_id = NEW.business_id
        AND bm.user_id = auth.uid()
        AND bm.role = ANY(ARRAY['owner','manager','accountant']::public.member_role[])
    ) THEN
    RAISE EXCEPTION 'Shop-scoped staff must use an account or document assigned to a shop.';
  END IF;

  IF NEW.branch_id IS NOT NULL AND auth.uid() IS NOT NULL
    AND NOT public.can_access_shop_branch(NEW.business_id, NEW.branch_id) THEN
    RAISE EXCEPTION 'You do not have access to this shop.';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS set_money_transaction_shop_branch ON public.money_transactions;
CREATE TRIGGER set_money_transaction_shop_branch
  BEFORE INSERT OR UPDATE OF business_id, account_id, branch_id, ref_type, ref_id
  ON public.money_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_money_transaction_shop_branch();

CREATE OR REPLACE FUNCTION public.set_supplier_payment_shop_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase_branch uuid;
  v_transaction_branch uuid;
BEGIN
  IF NEW.purchase_id IS NOT NULL THEN
    SELECT branch_id INTO v_purchase_branch
    FROM public.purchases
    WHERE business_id = NEW.business_id AND id = NEW.purchase_id;
  END IF;

  IF NEW.money_txn_id IS NOT NULL THEN
    SELECT branch_id INTO v_transaction_branch
    FROM public.money_transactions
    WHERE business_id = NEW.business_id AND id = NEW.money_txn_id;
  END IF;

  IF NEW.branch_id IS NOT NULL AND v_purchase_branch IS NOT NULL
    AND NEW.branch_id IS DISTINCT FROM v_purchase_branch THEN
    RAISE EXCEPTION 'Supplier payment shop does not match its purchase.';
  END IF;
  IF NEW.branch_id IS NOT NULL AND v_transaction_branch IS NOT NULL
    AND NEW.branch_id IS DISTINCT FROM v_transaction_branch THEN
    RAISE EXCEPTION 'Supplier payment shop does not match its money transaction.';
  END IF;
  IF v_purchase_branch IS NOT NULL AND v_transaction_branch IS NOT NULL
    AND v_purchase_branch IS DISTINCT FROM v_transaction_branch THEN
    RAISE EXCEPTION 'Supplier payment account belongs to a different shop than its purchase.';
  END IF;

  NEW.branch_id := coalesce(NEW.branch_id, v_purchase_branch, v_transaction_branch);
  IF NEW.branch_id IS NULL THEN
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.business_members bm
      WHERE bm.business_id = NEW.business_id
        AND bm.user_id = auth.uid()
        AND bm.role = ANY(ARRAY['owner','manager','accountant']::public.member_role[])
    ) THEN
      RAISE EXCEPTION 'Shop-scoped staff must use a shop-assigned account or purchase.';
    END IF;
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL
    AND NOT public.can_access_shop_branch(NEW.business_id, NEW.branch_id) THEN
    RAISE EXCEPTION 'You do not have access to this shop.';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS set_supplier_payment_shop_branch ON public.supplier_payments;
CREATE TRIGGER set_supplier_payment_shop_branch
  BEFORE INSERT OR UPDATE OF business_id, branch_id, purchase_id, money_txn_id
  ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_supplier_payment_shop_branch();

CREATE OR REPLACE FUNCTION public.sync_supplier_payment_money_transaction_shop_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.money_txn_id IS NOT NULL AND NEW.branch_id IS NOT NULL THEN
    UPDATE public.money_transactions
    SET branch_id = NEW.branch_id
    WHERE business_id = NEW.business_id
      AND id = NEW.money_txn_id
      AND branch_id IS DISTINCT FROM NEW.branch_id;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS sync_supplier_payment_money_transaction_shop_branch
  ON public.supplier_payments;
CREATE TRIGGER sync_supplier_payment_money_transaction_shop_branch
  AFTER INSERT OR UPDATE OF branch_id, money_txn_id
  ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_supplier_payment_money_transaction_shop_branch();

CREATE OR REPLACE FUNCTION public.enforce_shop_transfer_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_business uuid := (v_row->>'business_id')::uuid;
  v_from uuid := (v_row->>'from_branch_id')::uuid;
  v_to uuid := (v_row->>'to_branch_id')::uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  IF NOT public.can_access_shop_branch(v_business, v_from)
    OR NOT public.can_access_shop_branch(v_business, v_to) THEN
    RAISE EXCEPTION 'You must have access to both shops in this stock transfer.';
  END IF;
  IF TG_OP = 'INSERT' AND EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.business_id = v_business
        AND b.id IN (v_from, v_to)
        AND b.status <> 'active'
    ) THEN
    RAISE EXCEPTION 'Stock transfers require active brand shops.';
  END IF;
  IF TG_OP = 'UPDATE'
    AND (
      v_from IS DISTINCT FROM (to_jsonb(OLD)->>'from_branch_id')::uuid
      OR v_to IS DISTINCT FROM (to_jsonb(OLD)->>'to_branch_id')::uuid
    )
    AND EXISTS (
      SELECT 1 FROM public.branches b
      WHERE b.business_id = v_business
        AND b.id IN (v_from, v_to)
        AND b.status <> 'active'
    ) THEN
    RAISE EXCEPTION 'Stock transfers require active brand shops.';
  END IF;
  RETURN coalesce(NEW, OLD);
END
$$;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'product_imeis', 'purchases', 'expenses',
    'purchase_returns', 'purchase_orders', 'stock_adjustments', 'stock',
    'stock_movements'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS enforce_shop_branch_write ON public.%I', v_table);
    EXECUTE format(
      'CREATE TRIGGER enforce_shop_branch_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_shop_branch_write()',
      v_table
    );
  END LOOP;
END
$$;

DROP TRIGGER IF EXISTS enforce_shop_branch_write ON public.supplier_payments;
DROP TRIGGER IF EXISTS zz_enforce_shop_branch_write ON public.supplier_payments;
CREATE TRIGGER zz_enforce_shop_branch_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_shop_branch_write();

DROP TRIGGER IF EXISTS enforce_shop_transfer_write ON public.stock_transfers;
CREATE TRIGGER enforce_shop_transfer_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_shop_transfer_write();

REVOKE ALL ON FUNCTION public.enforce_shop_branch_write() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.enforce_shop_transfer_write() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_money_transaction_shop_branch() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_supplier_payment_shop_branch() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_supplier_payment_money_transaction_shop_branch()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_shop_branch_write(),
  public.enforce_shop_transfer_write(),
  public.set_money_transaction_shop_branch(),
  public.set_supplier_payment_shop_branch(),
  public.sync_supplier_payment_money_transaction_shop_branch()
  TO authenticated, service_role;

COMMIT;