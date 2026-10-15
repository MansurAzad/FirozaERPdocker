CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id);
ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES auth.users(id);
ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS notes text;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t 
    JOIN pg_enum e ON t.oid = e.enumtypid  
    WHERE t.typname = 'transfer_status' AND e.enumlabel = 'pending_approval'
  ) THEN
    ALTER TYPE transfer_status ADD VALUE 'pending_approval';
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.stock_transfer_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  transfer_id uuid NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('approve', 'reject', 'request_change')),
  approved_by uuid NOT NULL REFERENCES auth.users(id),
  comments text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_transfer_approvals_business ON public.stock_transfer_approvals(business_id);
CREATE INDEX idx_stock_transfer_approvals_transfer ON public.stock_transfer_approvals(transfer_id);

CREATE TABLE IF NOT EXISTS public.export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  export_type text NOT NULL CHECK (export_type IN (
    'customers', 'suppliers', 'products', 'sales', 'purchases', 
    'stock', 'ledger', 'trial_balance', 'profit_loss', 'balance_sheet',
    'commission', 'dealer_outstanding', 'bank_reconciliation'
  )),
  format text NOT NULL CHECK (format IN ('excel', 'pdf', 'csv')),
  filters jsonb,
  file_name text NOT NULL,
  file_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message text,
  record_count integer DEFAULT 0,
  file_size bigint,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX idx_export_jobs_business ON public.export_jobs(business_id);
CREATE INDEX idx_export_jobs_status ON public.export_jobs(status);
CREATE INDEX idx_export_jobs_created ON public.export_jobs(created_at);
CREATE INDEX idx_export_jobs_type ON public.export_jobs(export_type);

CREATE INDEX IF NOT EXISTS idx_products_business_brand ON public.products(business_id, brand_id);
CREATE INDEX IF NOT EXISTS idx_products_business_category ON public.products(business_id, category_id);
CREATE INDEX IF NOT EXISTS idx_products_model_trgm ON public.products USING gin (model gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_product_variants_sku_trgm ON public.product_variants USING gin (sku gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_product_variants_business_status ON public.product_variants(business_id, status) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_customers_business_type ON public.customers(business_id, type);
CREATE INDEX IF NOT EXISTS idx_customers_business_status ON public.customers(business_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_customers_mobile ON public.customers(mobile);
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON public.customers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_suppliers_business_status ON public.suppliers(business_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm ON public.suppliers USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_sales_business_date ON public.sales(business_id, sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_business_status_date ON public.sales(business_id, status, sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_customer_date ON public.sales(customer_id, sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_branch_date ON public.sales(branch_id, sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_no ON public.sales(invoice_no);
CREATE INDEX IF NOT EXISTS idx_purchases_business_date ON public.purchases(business_id, purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_business_status_date ON public.purchases(business_id, status, purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier_date ON public.purchases(supplier_id, purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchases_branch_date ON public.purchases(branch_id, purchase_date DESC);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON public.sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_variant ON public.sale_items(variant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON public.purchase_items(purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_variant ON public.purchase_items(variant_id);

CREATE INDEX IF NOT EXISTS idx_product_imeis_business_status ON public.product_imeis(business_id, status);
CREATE INDEX IF NOT EXISTS idx_product_imeis_variant_status ON public.product_imeis(variant_id, status);
CREATE INDEX IF NOT EXISTS idx_product_imeis_branch ON public.product_imeis(branch_id);
CREATE INDEX IF NOT EXISTS idx_product_imeis_imei1 ON public.product_imeis(imei1);
CREATE INDEX IF NOT EXISTS idx_product_imeis_imei2 ON public.product_imeis(imei2) WHERE imei2 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_business_branch ON public.stock(business_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_variant ON public.stock(variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_business_date ON public.stock_movements(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_variant_date ON public.stock_movements(variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_branch_ref ON public.stock_movements(branch_id, ref_type, ref_id);

CREATE INDEX IF NOT EXISTS idx_customer_payments_business_date ON public.customer_payments(business_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer_date ON public.customer_payments(customer_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS idx_customer_payments_sale ON public.customer_payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_business_date ON public.supplier_payments(business_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier_date ON public.supplier_payments(supplier_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_purchase ON public.supplier_payments(purchase_id);

CREATE INDEX IF NOT EXISTS idx_expenses_business_date ON public.expenses(business_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_branch_date ON public.expenses(branch_id, expense_date DESC) WHERE reversed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_category ON public.expenses(category_id) WHERE reversed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_business_date ON public.journal_entries(business_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_journal_entries_ref ON public.journal_entries(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON public.journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON public.journal_lines(account_id);

CREATE INDEX IF NOT EXISTS idx_money_accounts_business_kind ON public.money_accounts(business_id, kind);

CREATE INDEX IF NOT EXISTS idx_audit_logs_business_date ON public.audit_logs(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_date ON public.audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_module_action ON public.audit_logs(module, action);

CREATE TABLE IF NOT EXISTS public.realtime_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  channel text NOT NULL,
  subscribed_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, user_id, channel)
);
CREATE INDEX idx_realtime_subscriptions_business ON public.realtime_subscriptions(business_id);
CREATE INDEX idx_realtime_subscriptions_user ON public.realtime_subscriptions(user_id);

CREATE OR REPLACE FUNCTION public.notify_realtime_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  channel text;
  payload jsonb;
BEGIN
  channel := TG_TABLE_NAME || '_changes';
  payload := jsonb_build_object(
    'table', TG_TABLE_NAME,
    'operation', TG_OP,
    'business_id', COALESCE(NEW.business_id, OLD.business_id),
    'record_id', COALESCE(NEW.id, OLD.id),
    'timestamp', now()
  );
  PERFORM pg_notify(channel, payload::text);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER realtime_sales AFTER INSERT OR UPDATE OR DELETE ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.notify_realtime_event();

CREATE TRIGGER realtime_purchases AFTER INSERT OR UPDATE OR DELETE ON public.purchases
FOR EACH ROW EXECUTE FUNCTION public.notify_realtime_event();

CREATE TRIGGER realtime_stock AFTER INSERT OR UPDATE OR DELETE ON public.stock
FOR EACH ROW EXECUTE FUNCTION public.notify_realtime_event();

CREATE TRIGGER realtime_product_imeis AFTER INSERT OR UPDATE OR DELETE ON public.product_imeis
FOR EACH ROW EXECUTE FUNCTION public.notify_realtime_event();

CREATE TRIGGER realtime_customer_payments AFTER INSERT OR UPDATE OR DELETE ON public.customer_payments
FOR EACH ROW EXECUTE FUNCTION public.notify_realtime_event();

CREATE TRIGGER realtime_supplier_payments AFTER INSERT OR UPDATE OR DELETE ON public.supplier_payments
FOR EACH ROW EXECUTE FUNCTION public.notify_realtime_event();

CREATE TABLE IF NOT EXISTS public.backup_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  schedule_type text NOT NULL CHECK (schedule_type IN ('hourly', 'daily', 'weekly', 'monthly')),
  schedule_time time,
  schedule_day integer,
  is_active boolean NOT NULL DEFAULT true,
  retention_days integer NOT NULL DEFAULT 30,
  last_backup_at timestamptz,
  next_backup_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, schedule_type)
);
CREATE INDEX idx_backup_schedules_business ON public.backup_schedules(business_id);
CREATE INDEX idx_backup_schedules_active ON public.backup_schedules(is_active, next_backup_at);

CREATE TABLE IF NOT EXISTS public.backup_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  backup_type text NOT NULL CHECK (backup_type IN ('manual', 'scheduled', 'auto')),
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size bigint,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'failed')),
  error_message text,
  table_count integer,
  record_count integer,
  duration_seconds numeric(10,2),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz
);
CREATE INDEX idx_backup_history_business ON public.backup_history(business_id);
CREATE INDEX idx_backup_history_created ON public.backup_history(created_at DESC);
CREATE INDEX idx_backup_history_status ON public.backup_history(status);
CREATE INDEX idx_backup_history_expires ON public.backup_history(expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE public.stock_transfer_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_transfer_approvals_is_member ON public.stock_transfer_approvals
  USING (public.is_member(business_id));

ALTER TABLE public.export_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY export_jobs_is_member ON public.export_jobs
  USING (public.is_member(business_id));

ALTER TABLE public.realtime_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY realtime_subscriptions_is_member ON public.realtime_subscriptions
  USING (public.is_member(business_id));

ALTER TABLE public.backup_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY backup_schedules_is_member ON public.backup_schedules
  USING (public.is_member(business_id));

ALTER TABLE public.backup_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY backup_history_is_member ON public.backup_history
  USING (public.is_member(business_id));

SELECT public.add_audit_trigger('stock_transfer_approvals');
SELECT public.add_audit_trigger('export_jobs');
SELECT public.add_audit_trigger('realtime_subscriptions');
SELECT public.add_audit_trigger('backup_schedules');
SELECT public.add_audit_trigger('backup_history');

COMMENT ON TABLE public.stock_transfer_approvals IS 'Stock transfer approval workflow history';
COMMENT ON TABLE public.export_jobs IS 'Export job tracking (Excel, PDF, CSV)';
COMMENT ON TABLE public.realtime_subscriptions IS 'Real-time notification subscriptions';
COMMENT ON TABLE public.backup_schedules IS 'Automated backup schedules';
COMMENT ON TABLE public.backup_history IS 'Backup execution history';
COMMENT ON FUNCTION public.notify_realtime_event IS 'Trigger function for real-time notifications via PostgreSQL LISTEN/NOTIFY';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_transfer_approvals TO authenticated;
GRANT ALL ON public.stock_transfer_approvals TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.export_jobs TO authenticated;
GRANT ALL ON public.export_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.realtime_subscriptions TO authenticated;
GRANT ALL ON public.realtime_subscriptions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_schedules TO authenticated;
GRANT ALL ON public.backup_schedules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_history TO authenticated;
GRANT ALL ON public.backup_history TO service_role;