ALTER TYPE public.customer_type ADD VALUE IF NOT EXISTS 'dealer';
ALTER TYPE public.customer_type ADD VALUE IF NOT EXISTS 'sub_dealer';

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS dealer_type text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS dealer_level text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS dealer_discount numeric(14,2) DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS payment_days integer DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.dealer_credit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  credit_limit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  current_due numeric(14,2) NOT NULL DEFAULT 0 CHECK (current_due >= 0),
  last_payment_date timestamptz,
  payment_terms_days integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'suspended')),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, customer_id)
);
CREATE INDEX idx_dealer_credit_business ON public.dealer_credit(business_id);
CREATE INDEX idx_dealer_credit_customer ON public.dealer_credit(customer_id);

CREATE TABLE IF NOT EXISTS public.dealer_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'bkash', 'nagad', 'rocket', 'card', 'cheque')),
  transaction_ref text,
  note text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dealer_payments_business ON public.dealer_payments(business_id);
CREATE INDEX idx_dealer_payments_customer ON public.dealer_payments(customer_id);
CREATE INDEX idx_dealer_payments_date ON public.dealer_payments(payment_date);

CREATE TABLE IF NOT EXISTS public.salesmen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  mobile text CHECK (mobile ~ '^01[3-9][0-9]{8}$'),
  email text,
  address text,
  join_date date NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'terminated', 'on_leave')),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, mobile)
);
CREATE INDEX idx_salesmen_business ON public.salesmen(business_id);

CREATE TABLE IF NOT EXISTS public.commission_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  salesman_id uuid NOT NULL REFERENCES public.salesmen(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES public.commission_rules(id) ON DELETE SET NULL,
  reference_type text NOT NULL CHECK (reference_type IN ('sale', 'purchase_return', 'sales_return')),
  reference_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  pending_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (pending_amount >= 0),
  payment_date date,
  payment_method text CHECK (payment_method IN ('cash', 'bkash', 'nagad', 'rocket', 'card', 'cheque')),
  transaction_ref text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  note text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_commission_transactions_business ON public.commission_transactions(business_id);
CREATE INDEX idx_commission_transactions_salesman ON public.commission_transactions(salesman_id);
CREATE INDEX idx_commission_transactions_status ON public.commission_transactions(status);
CREATE INDEX idx_commission_transactions_date ON public.commission_transactions(created_at);

CREATE TABLE IF NOT EXISTS public.attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  record_type text NOT NULL CHECK (record_type IN (
    'sale', 'purchase', 'sale_return', 'purchase_return',
    'payment', 'expense', 'customer', 'supplier', 'product',
    'warranty', 'transfer', 'commission'
  )),
  record_id uuid NOT NULL,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size bigint,
  mime_type text,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_attachments_business ON public.attachments(business_id);
CREATE INDEX idx_attachments_record ON public.attachments(record_type, record_id);
CREATE INDEX idx_attachments_created ON public.attachments(created_at);

ALTER TABLE public.money_accounts ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz;
ALTER TABLE public.money_accounts ADD COLUMN IF NOT EXISTS last_reconciled_by uuid REFERENCES auth.users(id);
ALTER TABLE public.money_accounts ADD COLUMN IF NOT EXISTS statement_closing_balance numeric(14,2);

CREATE TABLE IF NOT EXISTS public.bank_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.money_accounts(id) ON DELETE CASCADE,
  reconciliation_date date NOT NULL,
  statement_balance numeric(14,2) NOT NULL,
  book_balance numeric(14,2) NOT NULL,
  difference numeric(14,2) NOT NULL DEFAULT 0,
  outstanding_deposits numeric(14,2) NOT NULL DEFAULT 0,
  outstanding_checks numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reconciled', 'approved')),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  note text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, account_id, reconciliation_date)
);
CREATE INDEX idx_bank_reconciliations_business ON public.bank_reconciliations(business_id);
CREATE INDEX idx_bank_reconciliations_account ON public.bank_reconciliations(account_id);
CREATE INDEX idx_bank_reconciliations_date ON public.bank_reconciliations(reconciliation_date);

CREATE TABLE IF NOT EXISTS public.bank_reconciliation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES public.bank_reconciliations(id) ON DELETE CASCADE,
  transaction_type text NOT NULL CHECK (transaction_type IN ('deposit', 'withdrawal')),
  transaction_id uuid NOT NULL,
  reference_type text,
  reference_id uuid,
  amount numeric(14,2) NOT NULL,
  cleared boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reconciliation_items_recon ON public.bank_reconciliation_items(reconciliation_id);
CREATE INDEX idx_reconciliation_items_cleared ON public.bank_reconciliation_items(cleared);

CREATE TABLE IF NOT EXISTS public.import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  import_type text NOT NULL CHECK (import_type IN ('products', 'customers', 'suppliers', 'stock', 'purchases')),
  file_name text NOT NULL,
  file_url text NOT NULL,
  total_records integer NOT NULL DEFAULT 0,
  success_records integer NOT NULL DEFAULT 0,
  failed_records integer NOT NULL DEFAULT 0,
  errors text[],
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  processed_by uuid REFERENCES auth.users(id),
  processed_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_import_jobs_business ON public.import_jobs(business_id);
CREATE INDEX idx_import_jobs_status ON public.import_jobs(status);
CREATE INDEX idx_import_jobs_created ON public.import_jobs(created_at);

CREATE OR REPLACE FUNCTION public.add_audit_trigger(_table text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format($f$
    CREATE TRIGGER audit_%1$I
    AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
    FOR EACH ROW EXECUTE FUNCTION public.audit_row();
  $f$, _table);
END;
$$;

SELECT public.add_audit_trigger('dealer_credit');
SELECT public.add_audit_trigger('dealer_payments');
SELECT public.add_audit_trigger('salesmen');
SELECT public.add_audit_trigger('commission_transactions');
SELECT public.add_audit_trigger('attachments');
SELECT public.add_audit_trigger('bank_reconciliations');
SELECT public.add_audit_trigger('import_jobs');

ALTER TABLE public.dealer_credit ENABLE ROW LEVEL SECURITY;
CREATE POLICY dealer_credit_is_member ON public.dealer_credit
  USING (public.is_member(business_id));

ALTER TABLE public.dealer_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY dealer_payments_is_member ON public.dealer_payments
  USING (public.is_member(business_id));

ALTER TABLE public.salesmen ENABLE ROW LEVEL SECURITY;
CREATE POLICY salesmen_is_member ON public.salesmen
  USING (public.is_member(business_id));

ALTER TABLE public.commission_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY commission_transactions_is_member ON public.commission_transactions
  USING (public.is_member(business_id));

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY attachments_is_member ON public.attachments
  USING (public.is_member(business_id));

ALTER TABLE public.bank_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY bank_reconciliations_is_member ON public.bank_reconciliations
  USING (public.is_member(business_id));

ALTER TABLE public.bank_reconciliation_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY bank_reconciliation_items_is_member ON public.bank_reconciliation_items
  USING (EXISTS (
    SELECT 1 FROM public.bank_reconciliations r
    WHERE r.id = reconciliation_id AND public.is_member(r.business_id)
  ));

ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY import_jobs_is_member ON public.import_jobs
  USING (public.is_member(business_id));

CREATE OR REPLACE VIEW public.dealer_outstanding AS
SELECT 
  d.business_id,
  d.customer_id,
  c.name,
  c.mobile,
  d.credit_limit,
  d.current_due,
  d.payment_terms_days,
  d.status,
  (now()::date - d.last_payment_date::date) as days_since_last_payment
FROM public.dealer_credit d
JOIN public.customers c ON c.id = d.customer_id AND c.business_id = d.business_id
WHERE d.status = 'active';

CREATE OR REPLACE VIEW public.salesman_commission_summary AS
SELECT 
  s.business_id,
  s.id as salesman_id,
  s.name,
  s.mobile,
  COUNT(ct.id) as transaction_count,
  COALESCE(SUM(ct.amount), 0) as total_commission,
  COALESCE(SUM(ct.paid_amount), 0) as paid_commission,
  COALESCE(SUM(ct.pending_amount), 0) as pending_commission
FROM public.salesmen s
LEFT JOIN public.commission_transactions ct ON ct.salesman_id = s.id AND ct.business_id = s.business_id
GROUP BY s.business_id, s.id, s.name, s.mobile;

CREATE OR REPLACE VIEW public.bank_reconciliation_summary AS
SELECT 
  r.business_id,
  r.account_id,
  r.reconciliation_date,
  r.status,
  r.statement_balance,
  r.book_balance,
  r.difference,
  r.created_by,
  r.created_at
FROM public.bank_reconciliations r;

COMMENT ON TABLE public.dealer_credit IS 'Dealer-specific credit management';
COMMENT ON TABLE public.dealer_payments IS 'Payments made to dealers';
COMMENT ON TABLE public.salesmen IS 'Salesmen/collectors profile';
COMMENT ON TABLE public.commission_rules IS 'Commission calculation rules';
COMMENT ON TABLE public.commission_transactions IS 'Commission earnings and payments';
COMMENT ON TABLE public.attachments IS 'Document attachments for records';
COMMENT ON TABLE public.bank_reconciliations IS 'Bank reconciliation records';
COMMENT ON TABLE public.bank_reconciliation_items IS 'Unreconciled items for bank statements';
COMMENT ON TABLE public.import_jobs IS 'Excel import job tracking';
COMMENT ON VIEW public.dealer_outstanding IS 'Dealer outstanding balances with aging';
COMMENT ON VIEW public.salesman_commission_summary IS 'Salesman commission summary';
COMMENT ON VIEW public.bank_reconciliation_summary IS 'Bank reconciliation status';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dealer_credit TO authenticated;
GRANT ALL ON public.dealer_credit TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dealer_payments TO authenticated;
GRANT ALL ON public.dealer_payments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.salesmen TO authenticated;
GRANT ALL ON public.salesmen TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.commission_transactions TO authenticated;
GRANT ALL ON public.commission_transactions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attachments TO authenticated;
GRANT ALL ON public.attachments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_reconciliations TO authenticated;
GRANT ALL ON public.bank_reconciliations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_reconciliation_items TO authenticated;
GRANT ALL ON public.bank_reconciliation_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_jobs TO authenticated;
GRANT ALL ON public.import_jobs TO service_role;