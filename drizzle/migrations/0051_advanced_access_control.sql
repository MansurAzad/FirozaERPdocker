CREATE TABLE public.access_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  UNIQUE (business_id, name)
);

CREATE TABLE public.business_access_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  access_role_id uuid,
  user_id uuid,
  module text NOT NULL,
  permission text NOT NULL,
  allowed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, access_role_id)
    REFERENCES public.access_roles (business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, user_id)
    REFERENCES public.business_members (business_id, user_id) ON DELETE CASCADE,
  CHECK ((access_role_id IS NOT NULL) <> (user_id IS NOT NULL)),
  CHECK (module IN (
    'dashboard','guardian','branches','products','brands','categories','sales','quotations',
    'orders','courier','emi','due_collection','customers','customer_portal','suppliers','ledger',
    'purchases','purchase_orders','purchase_returns','inventory','stock_adjustments','reorder',
    'labels','bulk_price','imei','transfers','service','warranty','supplier_payments','cash_bank',
    'bank_reconciliation','expenses','closing','accounting','reports','supplier_aging',
    'dead_slow_stock','tasks','commission','dealers','company_profile','daily_reports','team',
    'audit','attachments','sync_history','usage','backup','guide'
  )),
  CHECK (permission IN ('view','create','edit','delete','approve','export'))
);

CREATE UNIQUE INDEX business_access_permissions_role_key
  ON public.business_access_permissions (business_id, access_role_id, module, permission)
  WHERE access_role_id IS NOT NULL;
CREATE UNIQUE INDEX business_access_permissions_user_key
  ON public.business_access_permissions (business_id, user_id, module, permission)
  WHERE user_id IS NOT NULL;

ALTER TABLE public.business_members
  ADD COLUMN access_role_id uuid;
ALTER TABLE public.business_members
  ADD CONSTRAINT business_members_access_role_fkey
  FOREIGN KEY (business_id, access_role_id)
  REFERENCES public.access_roles (business_id, id) ON DELETE RESTRICT;

ALTER TABLE public.access_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_access_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY access_roles_owner_all ON public.access_roles
  FOR ALL TO authenticated
  USING (public.has_biz_role(business_id, ARRAY['owner']::public.member_role[]))
  WITH CHECK (public.has_biz_role(business_id, ARRAY['owner']::public.member_role[]));
CREATE POLICY business_access_permissions_owner_all ON public.business_access_permissions
  FOR ALL TO authenticated
  USING (public.has_biz_role(business_id, ARRAY['owner']::public.member_role[]))
  WITH CHECK (public.has_biz_role(business_id, ARRAY['owner']::public.member_role[]));

CREATE TRIGGER audit_access_roles
  AFTER INSERT OR UPDATE OR DELETE ON public.access_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_business_access_permissions
  AFTER INSERT OR UPDATE OR DELETE ON public.business_access_permissions
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

CREATE OR REPLACE FUNCTION public.access_module_for_table(_table text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _table
    WHEN 'access_roles' THEN 'team'
    WHEN 'business_access_permissions' THEN 'team'
    WHEN 'accounts' THEN 'accounting'
    WHEN 'attachments' THEN 'attachments'
    WHEN 'audit_logs' THEN 'audit'
    WHEN 'backup_history' THEN 'backup'
    WHEN 'backup_schedules' THEN 'backup'
    WHEN 'bank_reconciliation_items' THEN 'bank_reconciliation'
    WHEN 'bank_reconciliations' THEN 'bank_reconciliation'
    WHEN 'branches' THEN 'branches'
    WHEN 'brands' THEN 'brands'
    WHEN 'bulk_price_updates' THEN 'bulk_price'
    WHEN 'categories' THEN 'categories'
    WHEN 'commission_rules' THEN 'commission'
    WHEN 'commission_transactions' THEN 'commission'
    WHEN 'customer_payment_requests' THEN 'customer_portal'
    WHEN 'customer_payments' THEN 'customers'
    WHEN 'customer_portal_sessions' THEN 'customer_portal'
    WHEN 'customer_portal_tokens' THEN 'customer_portal'
    WHEN 'customers' THEN 'customers'
    WHEN 'daily_closings' THEN 'closing'
    WHEN 'dealer_credit' THEN 'dealers'
    WHEN 'dealer_payments' THEN 'dealers'
    WHEN 'emi_installments' THEN 'emi'
    WHEN 'emi_payments' THEN 'emi'
    WHEN 'emi_plans' THEN 'emi'
    WHEN 'entity_comments' THEN 'tasks'
    WHEN 'expense_categories' THEN 'expenses'
    WHEN 'expenses' THEN 'expenses'
    WHEN 'export_jobs' THEN 'reports'
    WHEN 'guardian_alerts' THEN 'guardian'
    WHEN 'guardian_runs' THEN 'guardian'
    WHEN 'import_jobs' THEN 'reports'
    WHEN 'journal_entries' THEN 'accounting'
    WHEN 'journal_lines' THEN 'accounting'
    WHEN 'kpi_snapshots' THEN 'reports'
    WHEN 'label_templates' THEN 'labels'
    WHEN 'money_accounts' THEN 'cash_bank'
    WHEN 'money_transactions' THEN 'cash_bank'
    WHEN 'order_items' THEN 'orders'
    WHEN 'order_payments' THEN 'orders'
    WHEN 'orders' THEN 'orders'
    WHEN 'page_visits' THEN 'usage'
    WHEN 'product_imeis' THEN 'imei'
    WHEN 'product_variants' THEN 'products'
    WHEN 'products' THEN 'products'
    WHEN 'purchase_items' THEN 'purchases'
    WHEN 'purchase_order_items' THEN 'purchase_orders'
    WHEN 'purchase_orders' THEN 'purchase_orders'
    WHEN 'purchase_return_items' THEN 'purchase_returns'
    WHEN 'purchase_returns' THEN 'purchase_returns'
    WHEN 'purchases' THEN 'purchases'
    WHEN 'quotation_items' THEN 'quotations'
    WHEN 'quotations' THEN 'quotations'
    WHEN 'realtime_subscriptions' THEN 'team'
    WHEN 'report_executions' THEN 'reports'
    WHEN 'report_recipients' THEN 'daily_reports'
    WHEN 'sale_items' THEN 'sales'
    WHEN 'sales' THEN 'sales'
    WHEN 'sales_emi' THEN 'emi'
    WHEN 'sales_return_items' THEN 'sales'
    WHEN 'sales_returns' THEN 'sales'
    WHEN 'salesmen' THEN 'commission'
    WHEN 'saved_reports' THEN 'reports'
    WHEN 'service_items' THEN 'service'
    WHEN 'service_jobs' THEN 'service'
    WHEN 'site_branding' THEN 'company_profile'
    WHEN 'stock' THEN 'inventory'
    WHEN 'stock_adjustment_items' THEN 'stock_adjustments'
    WHEN 'stock_adjustments' THEN 'stock_adjustments'
    WHEN 'stock_movements' THEN 'inventory'
    WHEN 'stock_transfer_approvals' THEN 'transfers'
    WHEN 'stock_transfer_items' THEN 'transfers'
    WHEN 'stock_transfers' THEN 'transfers'
    WHEN 'supplier_payments' THEN 'supplier_payments'
    WHEN 'suppliers' THEN 'suppliers'
    WHEN 'tasks' THEN 'tasks'
    WHEN 'user_activities' THEN 'team'
    WHEN 'user_notifications' THEN 'team'
    WHEN 'user_report_favorites' THEN 'reports'
    WHEN 'warranty_claims' THEN 'warranty'
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.access_rpc_allowed(_biz uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_path text := current_setting('request.path', true);
  v_rpc text;
  v_module text;
  v_permission text;
BEGIN
  IF v_path IS NULL OR v_path NOT LIKE '/rpc/%' THEN
    RETURN true;
  END IF;

  v_rpc := split_part(substring(v_path FROM 6), '/', 1);
  IF v_rpc IN ('has_biz_role', 'is_member', 'get_effective_access') THEN
    RETURN true;
  END IF;

  v_module := CASE v_rpc
    WHEN 'account_totals' THEN 'accounting'
    WHEN 'accrue_salesman_commission' THEN 'commission'
    WHEN 'add_entity_comment' THEN 'tasks'
    WHEN 'add_expense_category' THEN 'expenses'
    WHEN 'add_order_payment' THEN 'orders'
    WHEN 'apply_bulk_price_update' THEN 'bulk_price'
    WHEN 'approve_stock_transfer' THEN 'transfers'
    WHEN 'brand_shop_report' THEN 'reports'
    WHEN 'close_day' THEN 'closing'
    WHEN 'complete_bank_reconciliation' THEN 'bank_reconciliation'
    WHEN 'create_account' THEN 'accounting'
    WHEN 'create_attachment' THEN 'attachments'
    WHEN 'create_emi_sale_full' THEN 'emi'
    WHEN 'create_expense' THEN 'expenses'
    WHEN 'create_manual_journal' THEN 'accounting'
    WHEN 'create_money_account' THEN 'cash_bank'
    WHEN 'create_notification' THEN 'team'
    WHEN 'create_payment_request' THEN 'customer_portal'
    WHEN 'create_purchase' THEN 'purchases'
    WHEN 'create_purchase_return' THEN 'purchase_returns'
    WHEN 'create_sale' THEN 'sales'
    WHEN 'create_sales_return' THEN 'sales'
    WHEN 'create_stock_transfer' THEN 'transfers'
    WHEN 'create_task' THEN 'tasks'
    WHEN 'create_warranty_claim' THEN 'warranty'
    WHEN 'daily_summary' THEN 'daily_reports'
    WHEN 'dead_slow_stock_report' THEN 'dead_slow_stock'
    WHEN 'delete_account' THEN 'accounting'
    WHEN 'delete_attachment' THEN 'attachments'
    WHEN 'delete_expense_category' THEN 'expenses'
    WHEN 'delete_money_account' THEN 'cash_bank'
    WHEN 'delete_access_role' THEN 'team'
    WHEN 'emi_summary' THEN 'emi'
    WHEN 'export_business' THEN 'backup'
    WHEN 'generate_customer_portal_token' THEN 'customer_portal'
    WHEN 'get_attachments_for_record' THEN 'attachments'
    WHEN 'get_bank_reconciliation_summary' THEN 'bank_reconciliation'
    WHEN 'get_company_profile' THEN 'company_profile'
    WHEN 'get_entity_comments' THEN 'tasks'
    WHEN 'get_guardian_runtime_config' THEN 'guardian'
    WHEN 'get_pending_transfer_approvals' THEN 'transfers'
    WHEN 'get_member_access_config' THEN 'team'
    WHEN 'get_user_notifications' THEN 'team'
    WHEN 'get_user_tasks' THEN 'tasks'
    WHEN 'guardian_snapshot' THEN 'guardian'
    WHEN 'mark_all_notifications_read' THEN 'team'
    WHEN 'mark_notification_read' THEN 'team'
    WHEN 'mark_order_converted' THEN 'orders'
    WHEN 'mark_quotation_converted' THEN 'quotations'
    WHEN 'mark_reconciliation_item_cleared' THEN 'bank_reconciliation'
    WHEN 'pay_salesman_commission' THEN 'commission'
    WHEN 'pay_supplier' THEN 'supplier_payments'
    WHEN 'post_purchase_return' THEN 'purchase_returns'
    WHEN 'post_stock_adjustment' THEN 'stock_adjustments'
    WHEN 'receive_customer_payment' THEN 'due_collection'
    WHEN 'receive_emi_payment' THEN 'emi'
    WHEN 'receive_po_items' THEN 'purchase_orders'
    WHEN 'receive_stock_transfer' THEN 'transfers'
    WHEN 'record_money_txn' THEN 'cash_bank'
    WHEN 'reject_stock_transfer' THEN 'transfers'
    WHEN 'request_transfer_approval' THEN 'transfers'
    WHEN 'reset_business' THEN 'backup'
    WHEN 'restore_business' THEN 'backup'
    WHEN 'resume_guardian_ai' THEN 'guardian'
    WHEN 'reverse_expense' THEN 'expenses'
    WHEN 'reverse_journal' THEN 'accounting'
    WHEN 'reverse_money_txn' THEN 'cash_bank'
    WHEN 'run_guardian_checks' THEN 'guardian'
    WHEN 'save_emi_plan' THEN 'emi'
    WHEN 'save_access_role' THEN 'team'
    WHEN 'save_member_access' THEN 'team'
    WHEN 'save_label_template' THEN 'labels'
    WHEN 'save_order' THEN 'orders'
    WHEN 'save_purchase_order' THEN 'purchase_orders'
    WHEN 'save_purchase_return' THEN 'purchase_returns'
    WHEN 'save_quotation' THEN 'quotations'
    WHEN 'save_service_items' THEN 'service'
    WHEN 'save_service_job' THEN 'service'
    WHEN 'save_stock_adjustment' THEN 'stock_adjustments'
    WHEN 'set_dealer_credit' THEN 'dealers'
    WHEN 'set_guardian_alert' THEN 'guardian'
    WHEN 'set_order_delivery' THEN 'courier'
    WHEN 'start_bank_reconciliation' THEN 'bank_reconciliation'
    WHEN 'supplier_aging_report' THEN 'supplier_aging'
    WHEN 'transfer_money' THEN 'cash_bank'
    WHEN 'update_account' THEN 'accounting'
    WHEN 'update_expense' THEN 'expenses'
    WHEN 'update_expense_category' THEN 'expenses'
    WHEN 'update_money_account' THEN 'cash_bank'
    WHEN 'update_order_status' THEN 'orders'
    WHEN 'update_po_status' THEN 'purchase_orders'
    WHEN 'update_quotation_status' THEN 'quotations'
    WHEN 'update_service_status' THEN 'service'
    WHEN 'update_task_status' THEN 'tasks'
    WHEN 'update_warranty_claim' THEN 'warranty'
    WHEN 'visit_log' THEN 'usage'
    ELSE NULL
  END;

  IF v_rpc IN (
    'create_business','get_effective_access','verify_customer_portal_token','verify_job_token'
  ) THEN
    RETURN true;
  END IF;
  IF v_module IS NULL THEN
    RETURN false;
  END IF;

  v_permission := CASE
    WHEN v_rpc IN (
      'account_totals','brand_shop_report','daily_summary','dead_slow_stock_report','emi_summary',
      'get_attachments_for_record','get_bank_reconciliation_summary','get_company_profile',
      'get_entity_comments','get_guardian_runtime_config',
      'get_pending_transfer_approvals','get_user_notifications','get_user_tasks',
      'guardian_snapshot','supplier_aging_report','visit_log'
    ) THEN 'view'
    WHEN v_rpc LIKE 'delete_%' THEN 'delete'
    WHEN v_rpc IN (
      'approve_stock_transfer','close_day','complete_bank_reconciliation','mark_order_converted',
      'mark_quotation_converted','post_purchase_return','post_stock_adjustment',
      'reject_stock_transfer','reset_business','restore_business','set_guardian_alert'
    ) THEN 'approve'
    WHEN v_rpc IN (
      'update_account','update_expense','update_expense_category','update_money_account',
      'update_order_status','update_po_status','update_quotation_status','update_service_status',
      'update_task_status','update_warranty_claim','mark_all_notifications_read',
      'mark_notification_read','mark_reconciliation_item_cleared','reverse_expense',
      'reverse_journal','reverse_money_txn','resume_guardian_ai','set_order_delivery'
    ) THEN 'edit'
    WHEN v_rpc IN ('export_business') THEN 'export'
    WHEN v_rpc = 'get_member_access_config' THEN 'view'
    WHEN v_rpc = 'save_access_role' THEN 'edit'
    WHEN v_rpc = 'save_member_access' THEN 'edit'
    WHEN v_rpc = 'delete_access_role' THEN 'delete'
    ELSE 'create'
  END;

  IF v_rpc IN (
    'save_emi_plan','save_label_template','save_order','save_purchase_order',
    'save_purchase_return','save_quotation','save_service_items','save_service_job',
    'save_stock_adjustment','set_dealer_credit'
  ) THEN
    RETURN public.has_module_access(_biz, v_module, 'create')
      OR public.has_module_access(_biz, v_module, 'edit');
  END IF;

  RETURN public.has_module_access(_biz, v_module, v_permission);
END
$$;

CREATE OR REPLACE FUNCTION public.has_module_access(
  _biz uuid,
  _module text,
  _permission text DEFAULT 'view'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN NOT EXISTS (
      SELECT 1 FROM public.business_members bm
      WHERE bm.business_id = _biz AND bm.user_id = auth.uid()
    ) THEN false
    WHEN EXISTS (
      SELECT 1 FROM public.business_members bm
      WHERE bm.business_id = _biz AND bm.user_id = auth.uid() AND bm.role = 'owner'
    ) THEN true
    ELSE coalesce(
      (
        SELECT p.allowed
        FROM public.business_access_permissions p
        WHERE p.business_id = _biz
          AND p.user_id = auth.uid()
          AND p.module = _module
          AND p.permission = _permission
      ),
      (
        SELECT p.allowed
        FROM public.business_members bm
        JOIN public.business_access_permissions p
          ON p.access_role_id = bm.access_role_id
         AND p.business_id = bm.business_id
        WHERE bm.business_id = _biz
          AND bm.user_id = auth.uid()
          AND p.module = _module
          AND p.permission = _permission
      ),
      false
    )
  END
$$;

ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY acl_business_members_select ON public.business_members
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_module_access(business_id, 'team', 'view')
  );

CREATE OR REPLACE FUNCTION public.get_effective_access(_biz uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role uuid;
  v_result jsonb;
BEGIN
  SELECT access_role_id INTO v_role
  FROM public.business_members
  WHERE business_id = _biz AND user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a member of this business';
  END IF;

  SELECT coalesce(jsonb_object_agg(module, permissions), '{}'::jsonb)
  INTO v_result
  FROM (
    SELECT module, jsonb_object_agg(permission, allowed) AS permissions
    FROM (
      SELECT DISTINCT ON (module, permission) module, permission, allowed
      FROM public.business_access_permissions
      WHERE business_id = _biz
        AND (user_id = auth.uid() OR access_role_id = v_role)
      ORDER BY module, permission, (user_id = auth.uid()) DESC
    ) resolved
    GROUP BY module
  ) grouped;
  RETURN v_result;
END
$$;

CREATE OR REPLACE FUNCTION public.get_member_access_config(_biz uuid, _user uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role uuid;
  v_overrides jsonb;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner']::public.member_role[]) THEN
    RAISE EXCEPTION 'Only the business owner can view access settings';
  END IF;

  SELECT access_role_id INTO v_role FROM public.business_members
  WHERE business_id = _biz AND user_id = _user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'module', module, 'permission', permission, 'allowed', allowed
  )), '[]'::jsonb)
  INTO v_overrides
  FROM public.business_access_permissions
  WHERE business_id = _biz AND user_id = _user;

  RETURN jsonb_build_object('access_role_id', v_role, 'overrides', v_overrides);
END
$$;

CREATE OR REPLACE FUNCTION public.save_access_role(
  _biz uuid,
  _role_id uuid,
  _name text,
  _description text,
  _permissions jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role uuid;
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner']::public.member_role[]) THEN
    RAISE EXCEPTION 'Only the business owner can manage access roles';
  END IF;
  IF length(trim(_name)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'Role name must be between 1 and 80 characters';
  END IF;
  IF jsonb_typeof(_permissions) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid role permission matrix';
  END IF;
  IF jsonb_array_length(_permissions) > 300 THEN
    RAISE EXCEPTION 'Role permission matrix is too large';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(_permissions) AS p(module text, permission text, allowed boolean)
    WHERE p.module IS NULL OR p.permission IS NULL OR p.allowed IS NULL
      OR p.module NOT IN (
      'dashboard','guardian','branches','products','brands','categories','sales','quotations',
      'orders','courier','emi','due_collection','customers','customer_portal','suppliers','ledger',
      'purchases','purchase_orders','purchase_returns','inventory','stock_adjustments','reorder',
      'labels','bulk_price','imei','transfers','service','warranty','supplier_payments','cash_bank',
      'bank_reconciliation','expenses','closing','accounting','reports','supplier_aging',
      'dead_slow_stock','tasks','commission','dealers','company_profile','daily_reports','team',
      'audit','attachments','sync_history','usage','backup','guide'
    ) OR p.permission NOT IN ('view','create','edit','delete','approve','export')
  ) THEN
    RAISE EXCEPTION 'Invalid permission in role matrix';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(_permissions) AS p(module text, permission text, allowed boolean)
    GROUP BY p.module, p.permission
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate permission in role matrix';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(_permissions) AS p(module text, permission text, allowed boolean)
    WHERE p.allowed AND p.permission <> 'view'
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(_permissions) AS v(module text, permission text, allowed boolean)
        WHERE v.module = p.module AND v.permission = 'view' AND v.allowed
      )
  ) THEN
    RAISE EXCEPTION 'A module must be viewable before other actions can be granted';
  END IF;

  IF _role_id IS NULL THEN
    INSERT INTO public.access_roles (business_id, name, description)
    VALUES (_biz, trim(_name), coalesce(_description, ''))
    RETURNING id INTO v_role;
  ELSE
    UPDATE public.access_roles SET name = trim(_name), description = coalesce(_description, '')
    WHERE business_id = _biz AND id = _role_id
    RETURNING id INTO v_role;
    IF v_role IS NULL THEN RAISE EXCEPTION 'Access role not found'; END IF;
  END IF;

  DELETE FROM public.business_access_permissions
  WHERE business_id = _biz AND access_role_id = v_role;
  INSERT INTO public.business_access_permissions
    (business_id, access_role_id, module, permission, allowed)
  SELECT _biz, v_role, p.module, p.permission, p.allowed
  FROM jsonb_to_recordset(_permissions) AS p(module text, permission text, allowed boolean)
  WHERE p.allowed;
  RETURN v_role;
END
$$;

CREATE OR REPLACE FUNCTION public.save_member_access(
  _biz uuid,
  _user uuid,
  _role_id uuid,
  _overrides jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner']::public.member_role[]) THEN
    RAISE EXCEPTION 'Only the business owner can assign access';
  END IF;
  IF jsonb_typeof(_overrides) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid member permission matrix';
  END IF;
  IF jsonb_array_length(_overrides) > 300 THEN
    RAISE EXCEPTION 'Member permission matrix is too large';
  END IF;
  IF _role_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.access_roles WHERE business_id = _biz AND id = _role_id
  ) THEN
    RAISE EXCEPTION 'Access role not found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(_overrides) AS p(module text, permission text, allowed boolean)
    WHERE p.module IS NULL OR p.permission IS NULL OR p.allowed IS NULL
      OR p.module NOT IN (
      'dashboard','guardian','branches','products','brands','categories','sales','quotations',
      'orders','courier','emi','due_collection','customers','customer_portal','suppliers','ledger',
      'purchases','purchase_orders','purchase_returns','inventory','stock_adjustments','reorder',
      'labels','bulk_price','imei','transfers','service','warranty','supplier_payments','cash_bank',
      'bank_reconciliation','expenses','closing','accounting','reports','supplier_aging',
      'dead_slow_stock','tasks','commission','dealers','company_profile','daily_reports','team',
      'audit','attachments','sync_history','usage','backup','guide'
    ) OR p.permission NOT IN ('view','create','edit','delete','approve','export')
  ) THEN
    RAISE EXCEPTION 'Invalid member permission matrix';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(_overrides) AS p(module text, permission text, allowed boolean)
    GROUP BY p.module, p.permission
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate permission in member matrix';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(_overrides) AS p(module text, permission text, allowed boolean)
    WHERE p.allowed AND p.permission <> 'view'
      AND NOT coalesce(
        (
          SELECT v.allowed
          FROM jsonb_to_recordset(_overrides) AS v(module text, permission text, allowed boolean)
          WHERE v.module = p.module AND v.permission = 'view'
        ),
        (
          SELECT r.allowed
          FROM public.business_access_permissions r
          WHERE r.business_id = _biz
            AND r.access_role_id = _role_id
            AND r.module = p.module AND r.permission = 'view'
        ),
        false
      )
  ) THEN
    RAISE EXCEPTION 'A module must be viewable before other actions can be granted';
  END IF;

  UPDATE public.business_members SET access_role_id = _role_id
  WHERE business_id = _biz AND user_id = _user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;

  DELETE FROM public.business_access_permissions
  WHERE business_id = _biz AND user_id = _user;
  INSERT INTO public.business_access_permissions (business_id, user_id, module, permission, allowed)
  SELECT _biz, _user, p.module, p.permission, p.allowed
  FROM jsonb_to_recordset(_overrides) AS p(module text, permission text, allowed boolean)
  LEFT JOIN public.business_access_permissions inherited
    ON inherited.business_id = _biz
   AND inherited.access_role_id = _role_id
   AND inherited.module = p.module
   AND inherited.permission = p.permission
  WHERE p.allowed IS DISTINCT FROM coalesce(inherited.allowed, false);
END
$$;

CREATE OR REPLACE FUNCTION public.delete_access_role(_biz uuid, _role_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner']::public.member_role[]) THEN
    RAISE EXCEPTION 'Only the business owner can delete access roles';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.business_members
    WHERE business_id = _biz AND access_role_id = _role_id
  ) THEN
    RAISE EXCEPTION 'Unassign this access role before deleting it';
  END IF;
  DELETE FROM public.access_roles WHERE business_id = _biz AND id = _role_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Access role not found'; END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.is_member(_biz uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_members bm
    WHERE bm.business_id = _biz
      AND bm.user_id = auth.uid()
      AND public.access_rpc_allowed(_biz)
  )
$$;

CREATE OR REPLACE FUNCTION public.has_biz_role(_biz uuid, _roles public.member_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_members bm
    WHERE bm.business_id = _biz
      AND bm.user_id = auth.uid()
      AND public.access_rpc_allowed(_biz)
      AND (
        bm.role = ANY(_roles)
        OR (
          NOT ('owner'::public.member_role = ANY(_roles))
          AND current_setting('request.path', true) LIKE '/rpc/%'
          AND split_part(substring(current_setting('request.path', true) FROM 6), '/', 1)
            <> 'has_biz_role'
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.get_company_profile(_biz uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile jsonb;
BEGIN
  IF NOT public.has_module_access(_biz, 'company_profile', 'view') THEN
    RAISE EXCEPTION 'Company profile access has not been granted';
  END IF;
  SELECT jsonb_build_object(
    'name', name,
    'phone', phone,
    'address', address,
    'trade_license', trade_license,
    'guardian_profile', guardian_profile
  )
  INTO v_profile
  FROM public.businesses
  WHERE id = _biz;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business not found'; END IF;
  RETURN v_profile;
END
$$;

CREATE OR REPLACE FUNCTION public.get_guardian_runtime_config(_biz uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config jsonb;
BEGIN
  IF NOT public.has_module_access(_biz, 'guardian', 'view') THEN
    RAISE EXCEPTION 'Guardian access has not been granted';
  END IF;
  SELECT jsonb_build_object('name', name, 'guardian_ai_block', guardian_ai_block)
  INTO v_config
  FROM public.businesses
  WHERE id = _biz;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business not found'; END IF;
  RETURN v_config;
END
$$;

CREATE OR REPLACE FUNCTION public.guard_business_module_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_business uuid;
  v_new_business uuid;
  v_module text := public.access_module_for_table(TG_TABLE_NAME);
  v_path text := current_setting('request.path', true);
  v_permission text := CASE TG_OP
    WHEN 'INSERT' THEN 'create'
    WHEN 'UPDATE' THEN 'edit'
    ELSE 'delete'
  END;
BEGIN
  IF auth.uid() IS NULL OR TG_TABLE_NAME = 'audit_logs' THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  IF v_path LIKE '/rpc/%' THEN
    IF TG_OP <> 'INSERT' THEN
      v_old_business := (to_jsonb(OLD)->>'business_id')::uuid;
      IF NOT public.access_rpc_allowed(v_old_business) THEN
        RAISE EXCEPTION 'Permission denied for this operation' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      v_new_business := (to_jsonb(NEW)->>'business_id')::uuid;
      IF NOT public.access_rpc_allowed(v_new_business) THEN
        RAISE EXCEPTION 'Permission denied for this operation' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN coalesce(NEW, OLD);
  END IF;

  IF TG_OP <> 'INSERT' THEN
    v_old_business := (to_jsonb(OLD)->>'business_id')::uuid;
    IF NOT public.has_module_access(v_old_business, v_module, v_permission) THEN
      RAISE EXCEPTION 'Permission denied for module %', v_module USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_business := (to_jsonb(NEW)->>'business_id')::uuid;
    IF NOT public.has_module_access(v_new_business, v_module, v_permission) THEN
      RAISE EXCEPTION 'Permission denied for module %', v_module USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN coalesce(NEW, OLD);
END
$$;

DO $$
DECLARE
  v record;
BEGIN
  FOR v IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v.relname);
  END LOOP;
END
$$;

DO $$
DECLARE
  t record;
  v_module text;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'business_id'
      AND a.attnum > 0 AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
      AND c.relname NOT IN (
        'businesses','business_members','access_roles','business_access_permissions'
      )
  LOOP
    v_module := public.access_module_for_table(t.relname);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_module_access(business_id, %L, %L))',
      'module_' || t.relname || '_select', t.relname, coalesce(v_module, '__unmapped__'), 'view'
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.has_module_access(business_id, %L, %L))',
      'acl_' || t.relname || '_select', t.relname, coalesce(v_module, '__unmapped__'), 'view'
    );
    IF t.relname NOT IN ('page_visits', 'audit_logs') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_module_access(business_id, %L, %L))',
        'module_' || t.relname || '_insert', t.relname, coalesce(v_module, '__unmapped__'), 'create'
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.has_module_access(business_id, %L, %L))',
        'acl_' || t.relname || '_insert', t.relname, coalesce(v_module, '__unmapped__'), 'create'
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.has_module_access(business_id, %L, %L)) WITH CHECK (public.has_module_access(business_id, %L, %L))',
        'module_' || t.relname || '_update', t.relname, coalesce(v_module, '__unmapped__'), 'edit',
        coalesce(v_module, '__unmapped__'), 'edit'
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.has_module_access(business_id, %L, %L)) WITH CHECK (public.has_module_access(business_id, %L, %L))',
        'acl_' || t.relname || '_update', t.relname, coalesce(v_module, '__unmapped__'), 'edit',
        coalesce(v_module, '__unmapped__'), 'edit'
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.has_module_access(business_id, %L, %L))',
        'module_' || t.relname || '_delete', t.relname, coalesce(v_module, '__unmapped__'), 'delete'
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.has_module_access(business_id, %L, %L))',
        'acl_' || t.relname || '_delete', t.relname, coalesce(v_module, '__unmapped__'), 'delete'
      );
    END IF;
    IF t.relname NOT IN ('audit_logs', 'page_visits') THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_business_module_write()',
        'acl_' || t.relname || '_write_guard', t.relname
      );
    END IF;
  END LOOP;
END
$$;

GRANT EXECUTE ON FUNCTION public.has_module_access(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_effective_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_company_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_guardian_runtime_config(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_member_access_config(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_access_role(uuid, uuid, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_member_access(uuid, uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_access_role(uuid, uuid) TO authenticated;

REVOKE SELECT ON public.businesses FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, name, phone, address, currency, type)
  ON public.businesses TO authenticated;
