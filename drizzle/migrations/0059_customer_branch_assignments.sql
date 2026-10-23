CREATE TABLE public.customer_branch_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  assigned_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, customer_id, branch_id),
  FOREIGN KEY (business_id, customer_id)
    REFERENCES public.customers(business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, branch_id)
    REFERENCES public.branches(business_id, id) ON DELETE CASCADE
);

CREATE INDEX customer_branch_assignments_customer_idx
  ON public.customer_branch_assignments(business_id, customer_id);
CREATE INDEX customer_branch_assignments_branch_idx
  ON public.customer_branch_assignments(business_id, branch_id);

CREATE TRIGGER audit_customer_branch_assignments
  AFTER INSERT OR UPDATE OR DELETE ON public.customer_branch_assignments
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

ALTER TABLE public.customer_branch_assignments ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.customer_branch_assignments TO authenticated;
REVOKE ALL ON public.customer_branch_assignments FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.can_access_customer_branch(_biz uuid, _branch uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _branch IS NOT NULL
    AND public.has_module_access(_biz, 'customers', 'view')
    AND (
      public.has_biz_role(_biz, ARRAY['owner','manager','accountant']::public.member_role[])
      OR EXISTS (
        SELECT 1
          FROM public.partner_finance_branch_access a
         WHERE a.business_id = _biz
           AND a.user_id = auth.uid()
           AND a.branch_id = _branch
      )
    )
$$;

CREATE POLICY customer_branch_assignments_read
  ON public.customer_branch_assignments
  FOR SELECT TO authenticated
  USING (
    public.can_access_customer_branch(business_id, branch_id)
  );

CREATE OR REPLACE FUNCTION public.can_access_customer(_biz uuid, _customer uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_module_access(_biz, 'customers', 'view')
    AND (
      public.has_biz_role(_biz, ARRAY['owner','manager','accountant']::public.member_role[])
      OR EXISTS (
      SELECT 1
        FROM public.customer_branch_assignments a
       WHERE a.business_id = _biz
         AND a.customer_id = _customer
         AND public.can_access_customer_branch(_biz, a.branch_id)
      )
    )
$$;

INSERT INTO public.customer_branch_assignments (business_id, customer_id, branch_id, assigned_by)
SELECT DISTINCT s.business_id, s.customer_id, s.branch_id, s.created_by
  FROM public.sales s
 WHERE s.customer_id IS NOT NULL
ON CONFLICT (business_id, customer_id, branch_id) DO NOTHING;

WITH first_shop AS (
  SELECT DISTINCT ON (s.business_id, s.customer_id)
         s.business_id, s.customer_id, s.branch_id
    FROM public.sales s
   WHERE s.customer_id IS NOT NULL
   ORDER BY s.business_id, s.customer_id, s.sale_date, s.created_at, s.id
)
UPDATE public.customer_branch_assignments a
   SET opening_balance = c.opening_balance
  FROM first_shop fs
  JOIN public.customers c
    ON c.business_id = fs.business_id AND c.id = fs.customer_id
 WHERE a.business_id = fs.business_id
   AND a.customer_id = fs.customer_id
   AND a.branch_id = fs.branch_id
   AND c.opening_balance <> 0;

UPDATE public.customers c
   SET opening_balance = 0
 WHERE c.opening_balance <> 0
   AND EXISTS (
     SELECT 1 FROM public.customer_branch_assignments a
      WHERE a.business_id = c.business_id AND a.customer_id = c.id
   );

DROP POLICY "members read customers" ON public.customers;
DROP POLICY IF EXISTS acl_customers_select ON public.customers;
DROP POLICY IF EXISTS module_customers_select ON public.customers;
CREATE POLICY customers_read_assigned_shops
  ON public.customers
  FOR SELECT TO authenticated
  USING (public.is_member(business_id) AND public.can_access_customer(business_id, id));

DROP POLICY "sales staff write customers" ON public.customers;
REVOKE INSERT ON public.customers FROM authenticated;

DROP POLICY "sales staff update customers" ON public.customers;
DROP POLICY IF EXISTS acl_customers_update ON public.customers;
DROP POLICY IF EXISTS module_customers_update ON public.customers;
CREATE POLICY customers_update_central
  ON public.customers
  FOR UPDATE TO authenticated
  USING (
    public.has_biz_role(business_id, ARRAY['owner','manager']::public.member_role[])
    AND public.has_module_access(business_id, 'customers', 'edit')
  )
  WITH CHECK (
    public.has_biz_role(business_id, ARRAY['owner','manager']::public.member_role[])
    AND public.has_module_access(business_id, 'customers', 'edit')
  );

DROP POLICY "admins delete customers" ON public.customers;
DROP POLICY IF EXISTS acl_customers_delete ON public.customers;
DROP POLICY IF EXISTS module_customers_delete ON public.customers;
CREATE POLICY customers_delete_central
  ON public.customers
  FOR DELETE TO authenticated
  USING (
    public.has_biz_role(business_id, ARRAY['owner','manager']::public.member_role[])
    AND public.has_module_access(business_id, 'customers', 'delete')
  );

CREATE OR REPLACE FUNCTION public.guard_customer_global_opening_balance()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.opening_balance <> 0 AND EXISTS (
    SELECT 1 FROM public.customer_branch_assignments a
     WHERE a.business_id = NEW.business_id AND a.customer_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Opening due must be recorded against a specific shop assignment.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER guard_customer_global_opening_balance
  BEFORE INSERT OR UPDATE OF opening_balance ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.guard_customer_global_opening_balance();

CREATE OR REPLACE FUNCTION public.create_customer_for_branch(_biz uuid, _branch uuid, _data jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer uuid;
BEGIN
  IF NOT public.has_module_access(_biz, 'customers', 'create')
    OR NOT public.can_access_customer_branch(_biz, _branch) THEN
    RAISE EXCEPTION 'You do not have permission to add customers to this shop.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches
     WHERE business_id = _biz AND id = _branch AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Select an active shop.';
  END IF;

  INSERT INTO public.customers (
    business_id, name, business_name, mobile, alt_mobile, address, nid,
    trade_license, type, price_level, credit_limit, payment_terms_days,
    dealer_discount, dealer_level, dealer_type, opening_balance, status, notes
  ) VALUES (
    _biz,
    NULLIF(trim(_data->>'name'), ''),
    NULLIF(trim(_data->>'business_name'), ''),
    trim(COALESCE(_data->>'mobile', '')),
    NULLIF(trim(_data->>'alt_mobile'), ''),
    NULLIF(trim(_data->>'address'), ''),
    NULLIF(trim(_data->>'nid'), ''),
    NULLIF(trim(_data->>'trade_license'), ''),
    COALESCE(NULLIF(_data->>'type', '')::public.customer_type, 'retail'),
    COALESCE(NULLIF(_data->>'price_level', '')::public.price_level, 'retail'),
    COALESCE(NULLIF(_data->>'credit_limit', '')::numeric, 0),
    COALESCE(NULLIF(_data->>'payment_terms_days', '')::integer, 0),
    COALESCE(NULLIF(_data->>'dealer_discount', '')::numeric, 0),
    NULLIF(trim(_data->>'dealer_level'), ''),
    NULLIF(trim(_data->>'dealer_type'), ''),
    0,
    COALESCE(NULLIF(_data->>'status', '')::public.record_status, 'active'),
    NULLIF(trim(_data->>'notes'), '')
  )
  RETURNING id INTO v_customer;

  INSERT INTO public.customer_branch_assignments (
    business_id, customer_id, branch_id, opening_balance, assigned_by
  ) VALUES (
    _biz, v_customer, _branch,
    COALESCE(NULLIF(_data->>'opening_balance', '')::numeric, 0),
    auth.uid()
  );
  RETURN v_customer;
END $$;

CREATE OR REPLACE FUNCTION public.assign_customer_to_branch(_biz uuid, _customer uuid, _branch uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_opening_balance numeric(14,2);
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager']::public.member_role[])
    OR NOT public.has_module_access(_biz, 'customers', 'edit') THEN
    RAISE EXCEPTION 'Only an authorized central administrator can assign an existing customer to another shop.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches
     WHERE business_id = _biz AND id = _branch AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Select an active shop.';
  END IF;
  SELECT opening_balance INTO v_opening_balance
    FROM public.customers
   WHERE business_id = _biz AND id = _customer
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found.'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.customer_branch_assignments
     WHERE business_id = _biz AND customer_id = _customer AND branch_id = _branch
  ) THEN
    RAISE EXCEPTION 'This customer is already assigned to the selected shop.';
  END IF;

  INSERT INTO public.customer_branch_assignments (
    business_id, customer_id, branch_id, opening_balance, assigned_by
  ) VALUES (
    _biz, _customer, _branch,
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM public.customer_branch_assignments
       WHERE business_id = _biz AND customer_id = _customer
    ) THEN v_opening_balance ELSE 0 END,
    auth.uid()
  );
  IF v_opening_balance <> 0 THEN
    UPDATE public.customers SET opening_balance = 0
     WHERE business_id = _biz AND id = _customer;
  END IF;
END $$;

ALTER TABLE public.customer_payments ADD COLUMN branch_id uuid;
ALTER TABLE public.customer_payments
  ADD CONSTRAINT customer_payments_business_branch_fkey
  FOREIGN KEY (business_id, branch_id) REFERENCES public.branches(business_id, id);
CREATE INDEX customer_payments_branch_customer_idx
  ON public.customer_payments(business_id, branch_id, customer_id);

UPDATE public.customer_payments p
   SET branch_id = COALESCE(
     (SELECT s.branch_id FROM public.sales s WHERE s.id = p.sale_id),
     (SELECT mt.branch_id FROM public.money_transactions mt WHERE mt.id = p.money_txn_id),
     ma.branch_id
   )
  FROM public.money_accounts ma
 WHERE ma.id = p.account_id AND p.branch_id IS NULL;

UPDATE public.customer_payments p
   SET branch_id = a.branch_id
  FROM public.customer_branch_assignments a
 WHERE p.branch_id IS NULL
   AND p.business_id = a.business_id
   AND p.customer_id = a.customer_id
   AND 1 = (
     SELECT count(*) FROM public.customer_branch_assignments x
      WHERE x.business_id = p.business_id AND x.customer_id = p.customer_id
   );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.customer_payments
     WHERE customer_id IS NOT NULL AND branch_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Some customer payments cannot be assigned to a shop; resolve them before enabling shop isolation.';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.customer_payments p
      JOIN public.money_accounts ma
        ON ma.business_id = p.business_id AND ma.id = p.account_id
     WHERE p.branch_id IS NOT NULL
       AND ma.branch_id IS NOT NULL
       AND ma.branch_id IS DISTINCT FROM p.branch_id
  ) OR EXISTS (
    SELECT 1
      FROM public.customer_payments p
      JOIN public.money_transactions mt
        ON mt.business_id = p.business_id AND mt.id = p.money_txn_id
     WHERE p.branch_id IS NOT NULL
       AND mt.branch_id IS NOT NULL
       AND mt.branch_id IS DISTINCT FROM p.branch_id
  ) OR EXISTS (
    SELECT 1
      FROM public.customer_payments p
      JOIN public.journal_entries je
        ON je.business_id = p.business_id AND je.id = p.journal_entry_id
     WHERE p.branch_id IS NOT NULL
       AND je.branch_id IS NOT NULL
       AND je.branch_id IS DISTINCT FROM p.branch_id
  ) THEN
    RAISE EXCEPTION 'A customer payment ledger reference already belongs to a different shop.';
  END IF;
END $$;

UPDATE public.money_transactions mt
   SET branch_id = p.branch_id
  FROM public.customer_payments p
 WHERE mt.business_id = p.business_id
   AND mt.id = p.money_txn_id
   AND p.branch_id IS NOT NULL
   AND mt.branch_id IS NULL;

UPDATE public.journal_entries je
   SET branch_id = p.branch_id
  FROM public.customer_payments p
 WHERE je.business_id = p.business_id
   AND je.id = p.journal_entry_id
   AND p.branch_id IS NOT NULL
   AND je.branch_id IS NULL;

CREATE OR REPLACE FUNCTION public.set_customer_payment_branch()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch uuid;
  v_sale_branch uuid;
  v_account_branch uuid;
  v_assignment_count integer;
BEGIN
  IF NEW.sale_id IS NOT NULL THEN
    SELECT branch_id INTO v_sale_branch
      FROM public.sales
     WHERE business_id = NEW.business_id AND id = NEW.sale_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Sale not found for this customer payment.'; END IF;
  END IF;
  SELECT branch_id INTO v_account_branch
    FROM public.money_accounts
   WHERE business_id = NEW.business_id AND id = NEW.account_id;

  v_branch := COALESCE(NEW.branch_id, v_sale_branch, v_account_branch);
  IF v_branch IS NULL AND NEW.customer_id IS NOT NULL THEN
    SELECT count(*), min(branch_id) INTO v_assignment_count, v_branch
      FROM public.customer_branch_assignments
     WHERE business_id = NEW.business_id AND customer_id = NEW.customer_id
       AND public.can_access_customer_branch(NEW.business_id, branch_id);
    IF v_assignment_count <> 1 THEN
      RAISE EXCEPTION 'Select the shop for this customer payment.';
    END IF;
  END IF;
  IF v_account_branch IS NOT NULL AND v_account_branch IS DISTINCT FROM v_branch THEN
    RAISE EXCEPTION 'The receiving account belongs to a different shop.';
  END IF;
  IF v_branch IS NULL OR (
    NEW.customer_id IS NOT NULL
    AND NOT public.can_access_customer_branch(NEW.business_id, v_branch)
  ) OR (
    NEW.customer_id IS NULL
    AND NOT public.can_access_partner_finance_branch(NEW.business_id, v_branch)
  ) THEN
    RAISE EXCEPTION 'You do not have permission to record a payment for this shop.';
  END IF;
  IF NEW.customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customer_branch_assignments
     WHERE business_id = NEW.business_id AND customer_id = NEW.customer_id AND branch_id = v_branch
  ) THEN
    RAISE EXCEPTION 'Customer is not assigned to the selected shop.';
  END IF;
  IF v_sale_branch IS NOT NULL AND v_sale_branch <> v_branch THEN
    RAISE EXCEPTION 'Payment shop does not match the sale shop.';
  END IF;
  NEW.branch_id := v_branch;
  RETURN NEW;
END $$;

CREATE TRIGGER set_customer_payment_branch
  BEFORE INSERT OR UPDATE OF business_id, branch_id, customer_id, sale_id, account_id
  ON public.customer_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_customer_payment_branch();

CREATE OR REPLACE FUNCTION public.sync_customer_payment_money_transaction_branch()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.money_txn_id IS NOT NULL THEN
    UPDATE public.money_transactions
       SET branch_id = NEW.branch_id
     WHERE business_id = NEW.business_id
       AND id = NEW.money_txn_id
       AND branch_id IS DISTINCT FROM NEW.branch_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER sync_customer_payment_money_transaction_branch
  AFTER INSERT OR UPDATE OF branch_id, money_txn_id ON public.customer_payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_customer_payment_money_transaction_branch();

CREATE OR REPLACE FUNCTION public.enforce_customer_sale_assignment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customer_branch_assignments
     WHERE business_id = NEW.business_id
       AND customer_id = NEW.customer_id
       AND branch_id = NEW.branch_id
  ) THEN
    RAISE EXCEPTION 'Customer must be assigned to the selected shop before creating a sale.';
  END IF;
  IF NOT public.can_access_partner_finance_branch(NEW.business_id, NEW.branch_id) THEN
    RAISE EXCEPTION 'You do not have permission to create a sale for this shop.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER enforce_customer_sale_assignment
  BEFORE INSERT OR UPDATE OF business_id, branch_id, customer_id ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_sale_assignment();

CREATE OR REPLACE FUNCTION public.enforce_customer_return_assignment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
BEGIN
  SELECT * INTO v_sale
    FROM public.sales
   WHERE business_id = NEW.business_id AND id = NEW.sale_id;
  IF NOT FOUND OR v_sale.branch_id <> NEW.branch_id
    OR v_sale.customer_id IS DISTINCT FROM NEW.customer_id THEN
    RAISE EXCEPTION 'Return customer and shop must match the original sale.';
  END IF;
  IF v_sale.customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customer_branch_assignments
     WHERE business_id = NEW.business_id
       AND customer_id = v_sale.customer_id
       AND branch_id = v_sale.branch_id
  ) THEN
    RAISE EXCEPTION 'Customer is not assigned to the original sale shop.';
  END IF;
  IF NOT public.can_access_partner_finance_branch(NEW.business_id, NEW.branch_id) THEN
    RAISE EXCEPTION 'You do not have permission to return sales for this shop.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER enforce_customer_return_assignment
  BEFORE INSERT OR UPDATE OF business_id, branch_id, customer_id, sale_id
  ON public.sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_return_assignment();

DROP POLICY "members read sales" ON public.sales;
DROP POLICY IF EXISTS acl_sales_select ON public.sales;
DROP POLICY IF EXISTS module_sales_select ON public.sales;
CREATE POLICY sales_read_assigned_shops
  ON public.sales
  FOR SELECT TO authenticated
  USING (
    public.is_member(business_id)
    AND (
      (customer_id IS NOT NULL AND public.can_access_partner_finance_branch(business_id, branch_id)
        AND EXISTS (
          SELECT 1 FROM public.customer_branch_assignments a
           WHERE a.business_id = sales.business_id
             AND a.customer_id = sales.customer_id
             AND a.branch_id = sales.branch_id
        ))
      OR (customer_id IS NULL AND public.can_access_partner_finance_branch(business_id, branch_id))
    )
  );
CREATE POLICY sales_shop_scope_guard
  ON public.sales AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_module_access(business_id, 'sales', 'view')
    AND public.can_access_partner_finance_branch(business_id, branch_id)
    AND (
      customer_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.customer_branch_assignments a
         WHERE a.business_id = sales.business_id
           AND a.customer_id = sales.customer_id
           AND a.branch_id = sales.branch_id
      )
    )
  )
  WITH CHECK (
    public.has_module_access(business_id, 'sales', 'view')
    AND public.can_access_partner_finance_branch(business_id, branch_id)
    AND (
      customer_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.customer_branch_assignments a
         WHERE a.business_id = sales.business_id
           AND a.customer_id = sales.customer_id
           AND a.branch_id = sales.branch_id
      )
    )
  );

DROP POLICY "members read sale items" ON public.sale_items;
DROP POLICY IF EXISTS acl_sale_items_select ON public.sale_items;
DROP POLICY IF EXISTS module_sale_items_select ON public.sale_items;
CREATE POLICY sale_items_read_assigned_shops
  ON public.sale_items
  FOR SELECT TO authenticated
  USING (
    public.is_member(business_id)
    AND EXISTS (
      SELECT 1 FROM public.sales s
       WHERE s.business_id = sale_items.business_id AND s.id = sale_items.sale_id
    )
  );
CREATE POLICY sale_items_shop_scope_guard
  ON public.sale_items AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_module_access(business_id, 'sales', 'view')
    AND EXISTS (
      SELECT 1 FROM public.sales s
       WHERE s.business_id = sale_items.business_id AND s.id = sale_items.sale_id
    )
  )
  WITH CHECK (
    public.has_module_access(business_id, 'sales', 'view')
    AND EXISTS (
      SELECT 1 FROM public.sales s
       WHERE s.business_id = sale_items.business_id AND s.id = sale_items.sale_id
    )
  );

DROP POLICY "members read customer payments" ON public.customer_payments;
DROP POLICY IF EXISTS acl_customer_payments_select ON public.customer_payments;
DROP POLICY IF EXISTS module_customer_payments_select ON public.customer_payments;
CREATE POLICY customer_payments_read_assigned_shops
  ON public.customer_payments
  FOR SELECT TO authenticated
  USING (
    public.is_member(business_id)
    AND public.can_access_customer_branch(business_id, branch_id)
  );
CREATE POLICY customer_payments_shop_scope_guard
  ON public.customer_payments AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_module_access(business_id, 'customers', 'view')
    AND public.can_access_customer_branch(business_id, branch_id)
    AND (
      customer_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.customer_branch_assignments a
         WHERE a.business_id = customer_payments.business_id
           AND a.customer_id = customer_payments.customer_id
           AND a.branch_id = customer_payments.branch_id
      )
    )
  )
  WITH CHECK (
    public.has_module_access(business_id, 'customers', 'view')
    AND public.can_access_customer_branch(business_id, branch_id)
    AND (
      customer_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.customer_branch_assignments a
         WHERE a.business_id = customer_payments.business_id
           AND a.customer_id = customer_payments.customer_id
           AND a.branch_id = customer_payments.branch_id
      )
    )
  );

DROP POLICY "members read sales returns" ON public.sales_returns;
DROP POLICY IF EXISTS acl_sales_returns_select ON public.sales_returns;
DROP POLICY IF EXISTS module_sales_returns_select ON public.sales_returns;
CREATE POLICY sales_returns_read_assigned_shops
  ON public.sales_returns
  FOR SELECT TO authenticated
  USING (
    public.is_member(business_id)
    AND public.can_access_customer_branch(business_id, branch_id)
    AND EXISTS (
      SELECT 1 FROM public.sales s
       WHERE s.business_id = sales_returns.business_id AND s.id = sales_returns.sale_id
    )
  );
CREATE POLICY sales_returns_shop_scope_guard
  ON public.sales_returns AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_module_access(business_id, 'sales', 'view')
    AND public.can_access_partner_finance_branch(business_id, branch_id)
    AND (
      customer_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.customer_branch_assignments a
         WHERE a.business_id = sales_returns.business_id
           AND a.customer_id = sales_returns.customer_id
           AND a.branch_id = sales_returns.branch_id
      )
    )
  )
  WITH CHECK (
    public.has_module_access(business_id, 'sales', 'view')
    AND public.can_access_partner_finance_branch(business_id, branch_id)
    AND (
      customer_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.customer_branch_assignments a
         WHERE a.business_id = sales_returns.business_id
           AND a.customer_id = sales_returns.customer_id
           AND a.branch_id = sales_returns.branch_id
      )
    )
  );

DROP POLICY "members read sales return items" ON public.sales_return_items;
DROP POLICY IF EXISTS acl_sales_return_items_select ON public.sales_return_items;
DROP POLICY IF EXISTS module_sales_return_items_select ON public.sales_return_items;
CREATE POLICY sales_return_items_read_assigned_shops
  ON public.sales_return_items
  FOR SELECT TO authenticated
  USING (
    public.is_member(business_id)
    AND EXISTS (
      SELECT 1 FROM public.sales_returns r
       WHERE r.business_id = sales_return_items.business_id AND r.id = sales_return_items.return_id
    )
  );
CREATE POLICY sales_return_items_shop_scope_guard
  ON public.sales_return_items AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_module_access(business_id, 'sales', 'view')
    AND EXISTS (
      SELECT 1 FROM public.sales_returns r
       WHERE r.business_id = sales_return_items.business_id
         AND r.id = sales_return_items.return_id
    )
  )
  WITH CHECK (
    public.has_module_access(business_id, 'sales', 'view')
    AND EXISTS (
      SELECT 1 FROM public.sales_returns r
       WHERE r.business_id = sales_return_items.business_id
         AND r.id = sales_return_items.return_id
    )
  );

CREATE OR REPLACE FUNCTION public.customer_due(_c uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT sum(a.opening_balance)
      FROM public.customer_branch_assignments a
     WHERE a.business_id = c.business_id
       AND a.customer_id = c.id
       AND public.can_access_customer_branch(a.business_id, a.branch_id)
  ), CASE WHEN public.has_biz_role(c.business_id, ARRAY['owner','manager','accountant']::public.member_role[])
          THEN c.opening_balance ELSE 0 END)
   + COALESCE((
     SELECT sum(s.total) FROM public.sales s
      WHERE s.customer_id = c.id AND s.status = 'posted'
        AND NOT s.partner_financed
        AND public.can_access_customer_branch(s.business_id, s.branch_id)
   ), 0)
   - COALESCE((
     SELECT sum(p.amount) FROM public.customer_payments p
      WHERE p.customer_id = c.id
        AND public.can_access_customer_branch(p.business_id, p.branch_id)
   ), 0)
   - COALESCE((
     SELECT sum(r.total - r.refund) FROM public.sales_returns r
      WHERE r.customer_id = c.id
        AND public.can_access_customer_branch(r.business_id, r.branch_id)
   ), 0)
  FROM public.customers c
  WHERE c.id = _c
$$;
REVOKE ALL ON FUNCTION public.customer_due(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.customer_balances WITH (security_invoker = true) AS
SELECT c.id AS customer_id, c.business_id, c.name, c.business_name, c.mobile, c.type,
       c.credit_limit, c.payment_terms_days,
       COALESCE((
         SELECT sum(a.opening_balance)
           FROM public.customer_branch_assignments a
          WHERE a.business_id = c.business_id AND a.customer_id = c.id
       ), c.opening_balance)::numeric(14,2) AS opening_balance,
       COALESCE((SELECT sum(s.total) FROM public.sales s
                  WHERE s.customer_id = c.id AND s.status = 'posted'
                    AND NOT s.partner_financed), 0) AS sales_total,
       COALESCE((SELECT sum(p.amount) FROM public.customer_payments p
                  WHERE p.customer_id = c.id), 0) AS payments_total,
       COALESCE((
         SELECT sum(a.opening_balance) FROM public.customer_branch_assignments a
          WHERE a.business_id = c.business_id AND a.customer_id = c.id
       ), c.opening_balance)
         + COALESCE((SELECT sum(s.total) FROM public.sales s
                      WHERE s.customer_id = c.id AND s.status = 'posted'
                        AND NOT s.partner_financed), 0)
         - COALESCE((SELECT sum(p.amount) FROM public.customer_payments p
                      WHERE p.customer_id = c.id), 0)
         - COALESCE((SELECT sum(r.total - r.refund) FROM public.sales_returns r
                      WHERE r.customer_id = c.id), 0) AS current_due,
       (SELECT max(s.sale_date) FROM public.sales s
         WHERE s.customer_id = c.id AND NOT s.partner_financed) AS last_sale,
       (SELECT max(p.paid_on) FROM public.customer_payments p WHERE p.customer_id = c.id) AS last_payment,
       COALESCE((SELECT sum(r.total) FROM public.sales_returns r
                  WHERE r.customer_id = c.id), 0) AS returns_total
  FROM public.customers c;
GRANT SELECT ON public.customer_balances TO authenticated;

CREATE OR REPLACE VIEW public.customer_branch_balances WITH (security_invoker = true) AS
SELECT c.business_id, a.branch_id, c.id AS customer_id, c.name, c.business_name, c.mobile,
       c.type, c.price_level, c.status, c.credit_limit, c.payment_terms_days, a.opening_balance,
       COALESCE((SELECT sum(s.total) FROM public.sales s
                  WHERE s.business_id = a.business_id AND s.branch_id = a.branch_id
                    AND s.customer_id = a.customer_id AND s.status = 'posted'
                    AND NOT s.partner_financed), 0) AS sales_total,
       COALESCE((SELECT sum(p.amount) FROM public.customer_payments p
                  WHERE p.business_id = a.business_id AND p.branch_id = a.branch_id
                    AND p.customer_id = a.customer_id), 0) AS payments_total,
       a.opening_balance
         + COALESCE((SELECT sum(s.total) FROM public.sales s
                      WHERE s.business_id = a.business_id AND s.branch_id = a.branch_id
                        AND s.customer_id = a.customer_id AND s.status = 'posted'
                        AND NOT s.partner_financed), 0)
         - COALESCE((SELECT sum(p.amount) FROM public.customer_payments p
                      WHERE p.business_id = a.business_id AND p.branch_id = a.branch_id
                        AND p.customer_id = a.customer_id), 0)
         - COALESCE((SELECT sum(r.total - r.refund) FROM public.sales_returns r
                      WHERE r.business_id = a.business_id AND r.branch_id = a.branch_id
                        AND r.customer_id = a.customer_id), 0) AS current_due,
       (SELECT max(s.sale_date) FROM public.sales s
         WHERE s.business_id = a.business_id AND s.branch_id = a.branch_id
           AND s.customer_id = a.customer_id AND NOT s.partner_financed) AS last_sale,
       (SELECT max(p.paid_on) FROM public.customer_payments p
         WHERE p.business_id = a.business_id AND p.branch_id = a.branch_id
           AND p.customer_id = a.customer_id) AS last_payment,
       COALESCE((SELECT sum(r.total) FROM public.sales_returns r
                  WHERE r.business_id = a.business_id AND r.branch_id = a.branch_id
                    AND r.customer_id = a.customer_id), 0) AS returns_total
  FROM public.customer_branch_assignments a
  JOIN public.customers c
    ON c.business_id = a.business_id AND c.id = a.customer_id;
GRANT SELECT ON public.customer_branch_balances TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_customer_branch_reference()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL AND (
    NOT EXISTS (
      SELECT 1 FROM public.customer_branch_assignments a
       WHERE a.business_id = NEW.business_id
         AND a.customer_id = NEW.customer_id
         AND a.branch_id = NEW.branch_id
    )
    OR NOT public.can_access_customer_branch(NEW.business_id, NEW.branch_id)
  ) THEN
    RAISE EXCEPTION 'Customer must be assigned to an authorized shop before this record can be saved.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER enforce_order_customer_shop
  BEFORE INSERT OR UPDATE OF business_id, branch_id, customer_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_branch_reference();
CREATE TRIGGER enforce_service_customer_shop
  BEFORE INSERT OR UPDATE OF business_id, branch_id, customer_id ON public.service_jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_branch_reference();
CREATE TRIGGER enforce_quotation_customer_shop
  BEFORE INSERT OR UPDATE OF business_id, branch_id, customer_id ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_branch_reference();

DROP POLICY IF EXISTS orders_select ON public.orders;
DROP POLICY IF EXISTS acl_orders_select ON public.orders;
DROP POLICY IF EXISTS module_orders_select ON public.orders;
CREATE POLICY orders_read_assigned_shops
  ON public.orders
  FOR SELECT TO authenticated
  USING (
    public.is_member(business_id)
    AND public.has_module_access(business_id, 'orders', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR (
        public.can_access_partner_finance_branch(business_id, branch_id)
        AND (
          customer_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.customer_branch_assignments a
             WHERE a.business_id = orders.business_id
               AND a.customer_id = orders.customer_id
               AND a.branch_id = orders.branch_id
          )
        )
      )
    )
  );
CREATE POLICY orders_shop_scope_guard
  ON public.orders AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_module_access(business_id, 'orders', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR (
        public.can_access_partner_finance_branch(business_id, branch_id)
        AND (
          customer_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.customer_branch_assignments a
             WHERE a.business_id = orders.business_id
               AND a.customer_id = orders.customer_id
               AND a.branch_id = orders.branch_id
          )
        )
      )
    )
  )
  WITH CHECK (
    public.has_module_access(business_id, 'orders', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR (
        public.can_access_partner_finance_branch(business_id, branch_id)
        AND (
          customer_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.customer_branch_assignments a
             WHERE a.business_id = orders.business_id
               AND a.customer_id = orders.customer_id
               AND a.branch_id = orders.branch_id
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS quotations_select ON public.quotations;
DROP POLICY IF EXISTS acl_quotations_select ON public.quotations;
DROP POLICY IF EXISTS module_quotations_select ON public.quotations;
CREATE POLICY quotations_read_assigned_shops
  ON public.quotations
  FOR SELECT TO authenticated
  USING (
    public.is_member(business_id)
    AND public.has_module_access(business_id, 'quotations', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR (
        public.can_access_partner_finance_branch(business_id, branch_id)
        AND (
          customer_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.customer_branch_assignments a
             WHERE a.business_id = quotations.business_id
               AND a.customer_id = quotations.customer_id
               AND a.branch_id = quotations.branch_id
          )
        )
      )
    )
  );
CREATE POLICY quotations_shop_scope_guard
  ON public.quotations AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_module_access(business_id, 'quotations', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR (
        public.can_access_partner_finance_branch(business_id, branch_id)
        AND (
          customer_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.customer_branch_assignments a
             WHERE a.business_id = quotations.business_id
               AND a.customer_id = quotations.customer_id
               AND a.branch_id = quotations.branch_id
          )
        )
      )
    )
  )
  WITH CHECK (
    public.has_module_access(business_id, 'quotations', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR (
        public.can_access_partner_finance_branch(business_id, branch_id)
        AND (
          customer_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.customer_branch_assignments a
             WHERE a.business_id = quotations.business_id
               AND a.customer_id = quotations.customer_id
               AND a.branch_id = quotations.branch_id
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS sj_read ON public.service_jobs;
DROP POLICY IF EXISTS acl_service_jobs_select ON public.service_jobs;
DROP POLICY IF EXISTS module_service_jobs_select ON public.service_jobs;
CREATE POLICY service_jobs_read_assigned_shops
  ON public.service_jobs
  FOR SELECT TO authenticated
  USING (
    public.is_member(business_id)
    AND public.has_module_access(business_id, 'service', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR (
        public.can_access_partner_finance_branch(business_id, branch_id)
        AND (
          customer_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.customer_branch_assignments a
             WHERE a.business_id = service_jobs.business_id
               AND a.customer_id = service_jobs.customer_id
               AND a.branch_id = service_jobs.branch_id
          )
        )
      )
    )
  );
CREATE POLICY service_jobs_shop_scope_guard
  ON public.service_jobs AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_module_access(business_id, 'service', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR (
        public.can_access_partner_finance_branch(business_id, branch_id)
        AND (
          customer_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.customer_branch_assignments a
             WHERE a.business_id = service_jobs.business_id
               AND a.customer_id = service_jobs.customer_id
               AND a.branch_id = service_jobs.branch_id
          )
        )
      )
    )
  )
  WITH CHECK (
    public.has_module_access(business_id, 'service', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR (
        public.can_access_partner_finance_branch(business_id, branch_id)
        AND (
          customer_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.customer_branch_assignments a
             WHERE a.business_id = service_jobs.business_id
               AND a.customer_id = service_jobs.customer_id
               AND a.branch_id = service_jobs.branch_id
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS si_read ON public.service_items;
DROP POLICY IF EXISTS acl_service_items_select ON public.service_items;
DROP POLICY IF EXISTS module_service_items_select ON public.service_items;
CREATE POLICY service_items_read_assigned_shops
  ON public.service_items
  FOR SELECT TO authenticated
  USING (
    public.is_member(business_id)
    AND public.has_module_access(business_id, 'service', 'view')
    AND EXISTS (
      SELECT 1 FROM public.service_jobs j
       WHERE j.business_id = service_items.business_id
         AND j.id = service_items.job_id
    )
  );
CREATE POLICY service_items_shop_scope_guard
  ON public.service_items AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_module_access(business_id, 'service', 'view')
    AND EXISTS (
      SELECT 1 FROM public.service_jobs j
       WHERE j.business_id = service_items.business_id
         AND j.id = service_items.job_id
    )
  )
  WITH CHECK (
    public.has_module_access(business_id, 'service', 'view')
    AND EXISTS (
      SELECT 1 FROM public.service_jobs j
       WHERE j.business_id = service_items.business_id
         AND j.id = service_items.job_id
    )
  );

DROP POLICY IF EXISTS sales_emi_read ON public.sales_emi;
DROP POLICY IF EXISTS acl_sales_emi_select ON public.sales_emi;
DROP POLICY IF EXISTS module_sales_emi_select ON public.sales_emi;
CREATE POLICY sales_emi_read_assigned_shops
  ON public.sales_emi
  FOR SELECT TO authenticated
  USING (
    public.is_member(business_id)
    AND public.has_module_access(business_id, 'emi', 'view')
    AND public.can_access_customer_branch(business_id, branch_id)
    AND EXISTS (
      SELECT 1 FROM public.customer_branch_assignments a
       WHERE a.business_id = sales_emi.business_id
         AND a.customer_id = sales_emi.customer_id
         AND a.branch_id = sales_emi.branch_id
    )
  );
CREATE POLICY sales_emi_shop_scope_guard
  ON public.sales_emi AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_module_access(business_id, 'emi', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR (
        public.can_access_customer_branch(business_id, branch_id)
        AND EXISTS (
          SELECT 1 FROM public.customer_branch_assignments a
           WHERE a.business_id = sales_emi.business_id
             AND a.customer_id = sales_emi.customer_id
             AND a.branch_id = sales_emi.branch_id
        )
      )
    )
  )
  WITH CHECK (
    public.has_module_access(business_id, 'emi', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR (
        public.can_access_customer_branch(business_id, branch_id)
        AND EXISTS (
          SELECT 1 FROM public.customer_branch_assignments a
           WHERE a.business_id = sales_emi.business_id
             AND a.customer_id = sales_emi.customer_id
             AND a.branch_id = sales_emi.branch_id
        )
      )
    )
  );

DROP POLICY IF EXISTS emi_inst_read ON public.emi_installments;
DROP POLICY IF EXISTS acl_emi_installments_select ON public.emi_installments;
DROP POLICY IF EXISTS module_emi_installments_select ON public.emi_installments;
CREATE POLICY emi_installments_read_assigned_shops
  ON public.emi_installments
  FOR SELECT TO authenticated
  USING (
    public.is_member(business_id)
    AND public.has_module_access(business_id, 'emi', 'view')
    AND EXISTS (
      SELECT 1 FROM public.sales_emi e
       WHERE e.business_id = emi_installments.business_id
         AND e.id = emi_installments.emi_id
         AND public.can_access_customer_branch(e.business_id, e.branch_id)
         AND EXISTS (
           SELECT 1 FROM public.customer_branch_assignments a
            WHERE a.business_id = e.business_id
              AND a.customer_id = e.customer_id
              AND a.branch_id = e.branch_id
         )
    )
  );
CREATE POLICY emi_installments_shop_scope_guard
  ON public.emi_installments AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_module_access(business_id, 'emi', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR EXISTS (
        SELECT 1 FROM public.sales_emi e
         WHERE e.business_id = emi_installments.business_id
           AND e.id = emi_installments.emi_id
           AND public.can_access_customer_branch(e.business_id, e.branch_id)
           AND EXISTS (
             SELECT 1 FROM public.customer_branch_assignments a
              WHERE a.business_id = e.business_id
                AND a.customer_id = e.customer_id
                AND a.branch_id = e.branch_id
           )
      )
    )
  )
  WITH CHECK (
    public.has_module_access(business_id, 'emi', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR EXISTS (
        SELECT 1 FROM public.sales_emi e
         WHERE e.business_id = emi_installments.business_id
           AND e.id = emi_installments.emi_id
           AND public.can_access_customer_branch(e.business_id, e.branch_id)
           AND EXISTS (
             SELECT 1 FROM public.customer_branch_assignments a
              WHERE a.business_id = e.business_id
                AND a.customer_id = e.customer_id
                AND a.branch_id = e.branch_id
           )
      )
    )
  );

DROP POLICY IF EXISTS emi_payments_read ON public.emi_payments;
DROP POLICY IF EXISTS acl_emi_payments_select ON public.emi_payments;
DROP POLICY IF EXISTS module_emi_payments_select ON public.emi_payments;
CREATE POLICY emi_payments_read_assigned_shops
  ON public.emi_payments
  FOR SELECT TO authenticated
  USING (
    public.is_member(business_id)
    AND public.has_module_access(business_id, 'emi', 'view')
    AND public.can_access_customer_branch(business_id, branch_id)
    AND EXISTS (
      SELECT 1 FROM public.customer_branch_assignments a
       WHERE a.business_id = emi_payments.business_id
         AND a.customer_id = emi_payments.customer_id
         AND a.branch_id = emi_payments.branch_id
    )
  );
CREATE POLICY emi_payments_shop_scope_guard
  ON public.emi_payments AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_module_access(business_id, 'emi', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR (
        public.can_access_customer_branch(business_id, branch_id)
        AND EXISTS (
          SELECT 1 FROM public.customer_branch_assignments a
           WHERE a.business_id = emi_payments.business_id
             AND a.customer_id = emi_payments.customer_id
             AND a.branch_id = emi_payments.branch_id
        )
      )
    )
  )
  WITH CHECK (
    public.has_module_access(business_id, 'emi', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR (
        public.can_access_customer_branch(business_id, branch_id)
        AND EXISTS (
          SELECT 1 FROM public.customer_branch_assignments a
           WHERE a.business_id = emi_payments.business_id
             AND a.customer_id = emi_payments.customer_id
             AND a.branch_id = emi_payments.branch_id
        )
      )
    )
  );

DROP POLICY IF EXISTS members_read_claims ON public.warranty_claims;
DROP POLICY IF EXISTS "members read claims" ON public.warranty_claims;
DROP POLICY IF EXISTS acl_warranty_claims_select ON public.warranty_claims;
DROP POLICY IF EXISTS module_warranty_claims_select ON public.warranty_claims;
CREATE POLICY warranty_claims_read_assigned_shops
  ON public.warranty_claims
  FOR SELECT TO authenticated
  USING (
    public.is_member(business_id)
    AND public.has_module_access(business_id, 'warranty', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR EXISTS (
        SELECT 1
          FROM public.sale_items si
          JOIN public.sales s
            ON s.business_id = si.business_id AND s.id = si.sale_id
         WHERE si.business_id = warranty_claims.business_id
           AND si.id = warranty_claims.sale_item_id
           AND s.customer_id = warranty_claims.customer_id
           AND public.can_access_customer_branch(s.business_id, s.branch_id)
           AND EXISTS (
             SELECT 1 FROM public.customer_branch_assignments a
              WHERE a.business_id = s.business_id
                AND a.customer_id = s.customer_id
                AND a.branch_id = s.branch_id
           )
      )
    )
  );
CREATE POLICY warranty_claims_shop_scope_guard
  ON public.warranty_claims AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_module_access(business_id, 'warranty', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR EXISTS (
        SELECT 1
          FROM public.sale_items si
          JOIN public.sales s
            ON s.business_id = si.business_id AND s.id = si.sale_id
         WHERE si.business_id = warranty_claims.business_id
           AND si.id = warranty_claims.sale_item_id
           AND s.customer_id = warranty_claims.customer_id
           AND public.can_access_customer_branch(s.business_id, s.branch_id)
           AND EXISTS (
             SELECT 1 FROM public.customer_branch_assignments a
              WHERE a.business_id = s.business_id
                AND a.customer_id = s.customer_id
                AND a.branch_id = s.branch_id
           )
      )
    )
  )
  WITH CHECK (
    public.has_module_access(business_id, 'warranty', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR EXISTS (
        SELECT 1
          FROM public.sale_items si
          JOIN public.sales s
            ON s.business_id = si.business_id AND s.id = si.sale_id
         WHERE si.business_id = warranty_claims.business_id
           AND si.id = warranty_claims.sale_item_id
           AND s.customer_id = warranty_claims.customer_id
           AND public.can_access_customer_branch(s.business_id, s.branch_id)
           AND EXISTS (
             SELECT 1 FROM public.customer_branch_assignments a
              WHERE a.business_id = s.business_id
                AND a.customer_id = s.customer_id
                AND a.branch_id = s.branch_id
           )
      )
    )
  );

DROP POLICY IF EXISTS payment_requests_select ON public.customer_payment_requests;
DROP POLICY IF EXISTS acl_customer_payment_requests_select ON public.customer_payment_requests;
DROP POLICY IF EXISTS module_customer_payment_requests_select ON public.customer_payment_requests;
CREATE POLICY customer_payment_requests_central_scope
  ON public.customer_payment_requests
  FOR ALL TO authenticated
  USING (
    public.has_module_access(business_id, 'customer_portal', 'view')
    AND public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
  )
  WITH CHECK (
    public.has_module_access(business_id, 'customer_portal', 'view')
    AND public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
  );

CREATE OR REPLACE FUNCTION public.enforce_partner_finance_customer_assignment()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_branch_assignments a
     WHERE a.business_id = NEW.business_id
       AND a.customer_id = NEW.customer_id
       AND a.branch_id = NEW.branch_id
  ) THEN
    RAISE EXCEPTION 'Customer must be assigned to the selected shop before Partner Finance can be created.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER enforce_partner_finance_customer_assignment
  BEFORE INSERT OR UPDATE OF business_id, branch_id, customer_id
  ON public.partner_financed_sales
  FOR EACH ROW EXECUTE FUNCTION public.enforce_partner_finance_customer_assignment();

DROP POLICY partner_financed_sales_read ON public.partner_financed_sales;
DROP POLICY IF EXISTS acl_partner_financed_sales_select ON public.partner_financed_sales;
DROP POLICY IF EXISTS module_partner_financed_sales_select ON public.partner_financed_sales;
CREATE POLICY partner_financed_sales_read_assigned_shop
  ON public.partner_financed_sales
  FOR SELECT TO authenticated
  USING (
    public.is_member(business_id)
    AND public.can_access_partner_finance_branch(business_id, branch_id)
    AND EXISTS (
      SELECT 1 FROM public.customer_branch_assignments a
       WHERE a.business_id = partner_financed_sales.business_id
         AND a.customer_id = partner_financed_sales.customer_id
         AND a.branch_id = partner_financed_sales.branch_id
    )
  );

DROP POLICY dealer_credit_select ON public.dealer_credit;
DROP POLICY IF EXISTS acl_dealer_credit_select ON public.dealer_credit;
DROP POLICY IF EXISTS module_dealer_credit_select ON public.dealer_credit;
CREATE POLICY dealer_credit_select_assigned_customer
  ON public.dealer_credit
  FOR SELECT TO authenticated
  USING (
    public.is_member(business_id)
    AND public.has_module_access(business_id, 'dealers', 'view')
    AND public.can_access_customer(business_id, customer_id)
  );
CREATE POLICY dealer_credit_shop_scope_guard
  ON public.dealer_credit AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_module_access(business_id, 'dealers', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR public.can_access_customer(business_id, customer_id)
    )
  )
  WITH CHECK (
    public.has_module_access(business_id, 'dealers', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR public.can_access_customer(business_id, customer_id)
    )
  );

DROP POLICY dealer_payments_select ON public.dealer_payments;
DROP POLICY IF EXISTS acl_dealer_payments_select ON public.dealer_payments;
DROP POLICY IF EXISTS module_dealer_payments_select ON public.dealer_payments;
CREATE POLICY dealer_payments_select_central
  ON public.dealer_payments
  FOR SELECT TO authenticated
  USING (
    public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
    AND public.has_module_access(business_id, 'dealers', 'view')
  );
CREATE POLICY dealer_payments_central_scope_guard
  ON public.dealer_payments AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    public.has_module_access(business_id, 'dealers', 'view')
    AND public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
  )
  WITH CHECK (
    public.has_module_access(business_id, 'dealers', 'view')
    AND public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
  );

CREATE OR REPLACE FUNCTION public.partner_finance_customer_options(_biz uuid, _branch uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_module_access(_biz, 'sales', 'view') THEN
    RAISE EXCEPTION 'You do not have permission to view Partner Finance customers.';
  END IF;
  IF _branch IS NULL
    AND NOT public.has_biz_role(_biz, ARRAY['owner','manager','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'Select an assigned brand shop to view its Partner Finance customers.';
  END IF;
  IF _branch IS NOT NULL AND NOT public.can_access_partner_finance_branch(_biz, _branch) THEN
    RAISE EXCEPTION 'You do not have access to this brand shop.';
  END IF;
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'mobile', x.mobile) ORDER BY x.name),
    '[]'::jsonb
  )
    INTO v_result
    FROM (
      SELECT DISTINCT c.id, c.name, c.mobile
        FROM public.customer_branch_assignments a
        JOIN public.customers c
          ON c.business_id = a.business_id AND c.id = a.customer_id
       WHERE a.business_id = _biz
         AND c.status = 'active'
         AND (_branch IS NULL OR a.branch_id = _branch)
         AND public.can_access_partner_finance_branch(_biz, a.branch_id)
    ) x;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.receive_customer_payment_for_branch(
  _biz uuid, _customer uuid, _branch uuid, _account uuid, _amount numeric,
  _date date, _method public.payment_method, _txn_ref text, _note text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_led uuid;
  v_due numeric;
  v_id uuid := gen_random_uuid();
  v_j uuid;
  v_t uuid;
  v_name text;
  v_account_branch uuid;
BEGIN
  IF NOT public.has_module_access(_biz, 'due_collection', 'create')
    OR NOT public.can_access_customer_branch(_biz, _branch) THEN
    RAISE EXCEPTION 'You do not have permission to collect for this shop.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_branch_assignments
     WHERE business_id = _biz AND customer_id = _customer AND branch_id = _branch
  ) THEN
    RAISE EXCEPTION 'Customer is not assigned to the selected shop.';
  END IF;
  SELECT name INTO v_name FROM public.customers WHERE id = _customer AND business_id = _biz;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Invalid customer.'; END IF;
  SELECT ledger_account_id, branch_id INTO v_led, v_account_branch
    FROM public.money_accounts
   WHERE id = _account AND business_id = _biz AND status = 'active';
  IF v_led IS NULL THEN RAISE EXCEPTION 'Select the receiving account.'; END IF;
  IF v_account_branch IS NOT NULL AND v_account_branch <> _branch THEN
    RAISE EXCEPTION 'The receiving account belongs to another shop.';
  END IF;
  IF COALESCE(_amount, 0) <= 0 THEN RAISE EXCEPTION 'Invalid payment amount.'; END IF;

  v_due := COALESCE((
    SELECT sum(a.opening_balance) FROM public.customer_branch_assignments a
     WHERE a.business_id = _biz AND a.customer_id = _customer AND a.branch_id = _branch
  ), 0)
    + COALESCE((
      SELECT sum(s.total) FROM public.sales s
       WHERE s.business_id = _biz AND s.customer_id = _customer AND s.branch_id = _branch
         AND s.status = 'posted' AND NOT s.partner_financed
    ), 0)
    - COALESCE((
      SELECT sum(p.amount) FROM public.customer_payments p
       WHERE p.business_id = _biz AND p.customer_id = _customer AND p.branch_id = _branch
    ), 0)
    - COALESCE((
      SELECT sum(r.total - r.refund) FROM public.sales_returns r
       WHERE r.business_id = _biz AND r.customer_id = _customer AND r.branch_id = _branch
    ), 0);
  IF _amount > v_due THEN
    RAISE EXCEPTION 'Payment (৳%) is more than the shop due (৳%).', _amount, v_due;
  END IF;

  v_j := public.post_journal(_biz, COALESCE(_date, current_date), 'customer_payment', v_id,
    'Collection from ' || v_name,
    jsonb_build_array(public.jl(v_led, _amount, 0), public.jl(public.acct(_biz, '1100'), 0, _amount)));
  INSERT INTO public.money_transactions(
    business_id, account_id, branch_id, txn_date, direction, amount, kind, method, txn_ref,
    note, ref_type, ref_id, journal_entry_id
  ) VALUES (
    _biz, _account, _branch, COALESCE(_date, current_date), 'in', _amount, 'customer_payment',
    _method, NULLIF(_txn_ref, ''), 'Collection from ' || v_name, 'customer_payment', v_id, v_j
  ) RETURNING id INTO v_t;
  INSERT INTO public.customer_payments(
    id, business_id, branch_id, customer_id, account_id, amount, method, txn_ref,
    paid_on, notes, money_txn_id, journal_entry_id
  ) VALUES (
    v_id, _biz, _branch, _customer, _account, _amount, COALESCE(_method, 'cash'),
    NULLIF(_txn_ref, ''), COALESCE(_date, current_date), NULLIF(_note, ''), v_t, v_j
  );
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.receive_customer_payment(
  _biz uuid, _customer uuid, _account uuid, _amount numeric, _date date,
  _method public.payment_method, _txn_ref text, _note text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch uuid;
  v_account_branch uuid;
  v_match_count integer;
BEGIN
  SELECT branch_id INTO v_account_branch
    FROM public.money_accounts
   WHERE business_id = _biz AND id = _account;
  IF v_account_branch IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.customer_branch_assignments
       WHERE business_id = _biz AND customer_id = _customer AND branch_id = v_account_branch
    )
    AND public.can_access_customer_branch(_biz, v_account_branch) THEN
    v_branch := v_account_branch;
  ELSE
    SELECT count(*) INTO v_match_count
      FROM public.customer_branch_assignments a
     WHERE a.business_id = _biz AND a.customer_id = _customer
       AND public.can_access_customer_branch(_biz, a.branch_id);
    IF v_match_count <> 1 THEN
      RAISE EXCEPTION 'Choose the shop for this payment.';
    END IF;
    SELECT a.branch_id INTO v_branch
      FROM public.customer_branch_assignments a
     WHERE a.business_id = _biz AND a.customer_id = _customer
       AND public.can_access_customer_branch(_biz, a.branch_id);
  END IF;
  RETURN public.receive_customer_payment_for_branch(
    _biz, _customer, v_branch, _account, _amount, _date, _method, _txn_ref, _note
  );
END $$;

DO $$
DECLARE
  v_definition text := pg_get_functiondef('public.access_rpc_allowed(uuid)'::regprocedure);
  v_updated text;
BEGIN
  v_updated := replace(
    v_definition,
    $find$WHEN 'receive_customer_payment' THEN 'due_collection'$find$,
    $replace$WHEN 'receive_customer_payment' THEN 'due_collection'
    WHEN 'receive_customer_payment_for_branch' THEN 'due_collection'
    WHEN 'create_customer_for_branch' THEN 'customers'
    WHEN 'assign_customer_to_branch' THEN 'customers'$replace$
  );
  IF v_updated = v_definition THEN
    RAISE EXCEPTION 'Could not extend customer RPC access mapping.';
  END IF;
  EXECUTE v_updated;
END $$;

REVOKE ALL ON FUNCTION public.can_access_customer_branch(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_customer(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_customer_for_branch(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_customer_to_branch(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.receive_customer_payment_for_branch(
  uuid, uuid, uuid, uuid, numeric, date, public.payment_method, text, text
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.receive_customer_payment(
  uuid, uuid, uuid, numeric, date, public.payment_method, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_customer_for_branch(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_customer_to_branch(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_customer_payment_for_branch(
  uuid, uuid, uuid, uuid, numeric, date, public.payment_method, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_customer_payment(
  uuid, uuid, uuid, numeric, date, public.payment_method, text, text
) TO authenticated;
