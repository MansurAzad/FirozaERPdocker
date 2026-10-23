ALTER TABLE public.branches
  ADD CONSTRAINT branches_business_id_id_unique UNIQUE (business_id, id);

ALTER TABLE public.customers
  ADD CONSTRAINT customers_business_id_id_unique UNIQUE (business_id, id);

ALTER TABLE public.money_transactions
  ADD CONSTRAINT money_transactions_business_id_id_unique UNIQUE (business_id, id);

CREATE OR REPLACE VIEW public.money_account_balances
  WITH (security_invoker = true) AS
SELECT ma.id, ma.business_id, ma.kind, ma.name, ma.bank_name, ma.bank_branch,
       ma.account_no, ma.opening_balance, ma.status,
       ma.opening_balance + COALESCE(
         (SELECT sum(CASE WHEN t.direction='in' THEN t.amount ELSE -t.amount END)
            FROM public.money_transactions t WHERE t.account_id=ma.id), 0
       ) AS balance,
       ma.branch_id
  FROM public.money_accounts ma;

CREATE TABLE public.partner_finance_branch_access (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  granted_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, user_id, branch_id),
  FOREIGN KEY (business_id, user_id)
    REFERENCES public.business_members(business_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, branch_id)
    REFERENCES public.branches(business_id, id) ON DELETE CASCADE
);

CREATE TRIGGER audit_partner_finance_branch_access
  AFTER INSERT OR UPDATE OR DELETE ON public.partner_finance_branch_access
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

ALTER TABLE public.partner_finance_branch_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_finance_branch_access_read
  ON public.partner_finance_branch_access
  FOR SELECT TO authenticated
  USING (
    public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
    OR user_id = auth.uid()
  );
GRANT SELECT ON public.partner_finance_branch_access TO authenticated;
REVOKE ALL ON public.partner_finance_branch_access FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.can_access_partner_finance_branch(_biz uuid, _branch uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _branch IS NOT NULL
    AND public.has_module_access(_biz, 'sales', 'view')
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

CREATE OR REPLACE FUNCTION public.can_access_daily_closing_branch(_biz uuid, _branch uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _branch IS NOT NULL
    AND public.has_module_access(_biz,'closing','view')
    AND (
      public.has_biz_role(_biz,ARRAY['owner','manager','accountant']::public.member_role[])
      OR EXISTS (
        SELECT 1 FROM public.partner_finance_branch_access a
         WHERE a.business_id=_biz AND a.user_id=auth.uid() AND a.branch_id=_branch
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.assign_partner_finance_branch_access(
  _biz uuid, _user uuid, _branch uuid, _enabled boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role public.member_role;
BEGIN
  IF NOT public.has_module_access(_biz, 'sales', 'view')
    OR NOT (public.has_module_access(_biz, 'sales', 'create')
      OR public.has_module_access(_biz, 'sales', 'edit'))
    OR NOT public.has_biz_role(_biz, ARRAY['owner','manager']::public.member_role[]) THEN
    RAISE EXCEPTION 'Only an owner or manager with Sales access can assign Partner Finance shops.';
  END IF;
  SELECT role INTO v_role
    FROM public.business_members
   WHERE business_id = _biz AND user_id = _user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business member not found.'; END IF;
  IF v_role NOT IN ('branch_manager','salesman','store_keeper') THEN
    RAISE EXCEPTION 'Only shop-scoped members can be assigned to Partner Finance shops.';
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
END $$;

ALTER TABLE public.partner_settlement_lines
  ADD COLUMN branch_id uuid;

UPDATE public.partner_settlement_lines l
   SET branch_id = pfs.branch_id
  FROM public.partner_financed_sales pfs
 WHERE pfs.business_id = l.business_id
   AND pfs.id = l.financed_sale_id
   AND l.branch_id IS NULL;

ALTER TABLE public.partner_settlement_lines
  ADD CONSTRAINT partner_settlement_lines_business_branch_fkey
    FOREIGN KEY (business_id, branch_id)
    REFERENCES public.branches(business_id, id);

ALTER TABLE public.partner_settlement_lines
  ADD COLUMN accounting_status text NOT NULL DEFAULT 'unposted',
  ADD COLUMN money_account_id uuid,
  ADD COLUMN money_transaction_id uuid,
  ADD COLUMN journal_entry_id uuid,
  ADD COLUMN idempotency_key text,
  ADD COLUMN reversal_money_transaction_id uuid,
  ADD COLUMN reversal_journal_entry_id uuid,
  ADD COLUMN reversal_idempotency_key text,
  ADD COLUMN reversed_by uuid,
  ADD COLUMN reversed_at timestamptz,
  ADD CONSTRAINT partner_settlement_lines_accounting_status_check
    CHECK (accounting_status IN ('unposted','posted','reversed')),
  ADD CONSTRAINT partner_settlement_lines_accounting_fields_check CHECK (
    (accounting_status='unposted' AND money_account_id IS NULL
      AND money_transaction_id IS NULL AND journal_entry_id IS NULL
      AND reversal_money_transaction_id IS NULL AND reversal_journal_entry_id IS NULL
      AND reversal_idempotency_key IS NULL AND reversed_by IS NULL AND reversed_at IS NULL)
    OR (accounting_status='posted' AND money_account_id IS NOT NULL
      AND money_transaction_id IS NOT NULL AND journal_entry_id IS NOT NULL
      AND reversal_money_transaction_id IS NULL AND reversal_journal_entry_id IS NULL
      AND reversal_idempotency_key IS NULL AND reversed_by IS NULL AND reversed_at IS NULL)
    OR (accounting_status='reversed' AND money_account_id IS NOT NULL
      AND money_transaction_id IS NOT NULL AND journal_entry_id IS NOT NULL
      AND reversal_money_transaction_id IS NOT NULL AND reversal_journal_entry_id IS NOT NULL
      AND length(trim(COALESCE(reversal_idempotency_key,''))) BETWEEN 1 AND 120
      AND reversed_by IS NOT NULL AND reversed_at IS NOT NULL)
  ),
  ADD CONSTRAINT partner_settlement_lines_account_fkey
    FOREIGN KEY (business_id,money_account_id)
    REFERENCES public.money_accounts(business_id,id),
  ADD CONSTRAINT partner_settlement_lines_money_txn_fkey
    FOREIGN KEY (business_id,money_transaction_id)
    REFERENCES public.money_transactions(business_id,id),
  ADD CONSTRAINT partner_settlement_lines_journal_fkey
    FOREIGN KEY (business_id,journal_entry_id)
    REFERENCES public.journal_entries(business_id,id),
  ADD CONSTRAINT partner_settlement_lines_reversal_money_txn_fkey
    FOREIGN KEY (business_id,reversal_money_transaction_id)
    REFERENCES public.money_transactions(business_id,id),
  ADD CONSTRAINT partner_settlement_lines_reversal_journal_fkey
    FOREIGN KEY (business_id,reversal_journal_entry_id)
    REFERENCES public.journal_entries(business_id,id);

CREATE OR REPLACE FUNCTION public.set_partner_settlement_branch()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.accounting_status='reversed' THEN
    RAISE EXCEPTION 'A reversed provider settlement cannot be matched to a finance agreement.';
  END IF;
  IF NEW.financed_sale_id IS NOT NULL THEN
    SELECT branch_id INTO NEW.branch_id
      FROM public.partner_financed_sales
     WHERE business_id = NEW.business_id AND id = NEW.financed_sale_id;
    IF NEW.branch_id IS NULL THEN RAISE EXCEPTION 'Matched finance agreement not found.'; END IF;
  ELSIF NEW.branch_id IS NOT NULL THEN
    RAISE EXCEPTION 'An unmatched provider settlement cannot be assigned to a shop.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER set_partner_settlement_branch
  BEFORE INSERT OR UPDATE OF financed_sale_id, business_id
  ON public.partner_settlement_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_partner_settlement_branch();

CREATE OR REPLACE FUNCTION public.validate_posted_settlement_branch()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_account_branch uuid;
BEGIN
  IF NEW.financed_sale_id IS NOT NULL AND NEW.accounting_status='posted'
    AND NEW.money_account_id IS NOT NULL THEN
    SELECT branch_id INTO v_account_branch
      FROM public.money_accounts
     WHERE business_id=NEW.business_id AND id=NEW.money_account_id;
    IF v_account_branch IS NOT NULL AND v_account_branch<>NEW.branch_id THEN
      RAISE EXCEPTION 'Posted settlement cash account does not belong to the matched brand shop.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER validate_posted_settlement_branch
  BEFORE UPDATE OF financed_sale_id, accounting_status
  ON public.partner_settlement_lines
  FOR EACH ROW EXECUTE FUNCTION public.validate_posted_settlement_branch();

CREATE UNIQUE INDEX partner_settlement_idempotency_once
  ON public.partner_settlement_lines(business_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX partner_settlement_money_posting_once
  ON public.money_transactions(business_id,ref_type,ref_id)
  WHERE ref_type='partner_finance_settlement' AND ref_id IS NOT NULL;
CREATE UNIQUE INDEX partner_settlement_journal_posting_once
  ON public.journal_entries(business_id,ref_type,ref_id)
  WHERE ref_type='partner_finance_settlement' AND ref_id IS NOT NULL;
CREATE UNIQUE INDEX partner_settlement_reversal_money_once
  ON public.money_transactions(business_id,ref_type,ref_id)
  WHERE ref_type='partner_finance_settlement_reversal' AND ref_id IS NOT NULL;
CREATE UNIQUE INDEX partner_settlement_reversal_journal_once
  ON public.journal_entries(business_id,ref_type,ref_id)
  WHERE ref_type='partner_finance_settlement_reversal' AND ref_id IS NOT NULL;
CREATE UNIQUE INDEX partner_settlement_reversal_idempotency_once
  ON public.partner_settlement_lines(business_id,reversal_idempotency_key)
  WHERE reversal_idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.propagate_partner_settlement_branch()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id AND NEW.branch_id IS NOT NULL THEN
    UPDATE public.money_transactions
       SET branch_id=NEW.branch_id
     WHERE business_id=NEW.business_id AND id=NEW.money_transaction_id;
    UPDATE public.journal_entries
       SET branch_id=NEW.branch_id
     WHERE business_id=NEW.business_id AND id=NEW.journal_entry_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER propagate_partner_settlement_branch
  AFTER UPDATE OF branch_id ON public.partner_settlement_lines
  FOR EACH ROW EXECUTE FUNCTION public.propagate_partner_settlement_branch();

CREATE TABLE public.partner_finance_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  agreement_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  installment_no integer NOT NULL CHECK (installment_no > 0),
  due_date date NOT NULL,
  scheduled_amount numeric(14,2) NOT NULL CHECK (scheduled_amount > 0),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  waived_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (waived_amount >= 0),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  UNIQUE (business_id, agreement_id, installment_no),
  FOREIGN KEY (business_id, agreement_id)
    REFERENCES public.partner_financed_sales(business_id, id),
  FOREIGN KEY (business_id, branch_id)
    REFERENCES public.branches(business_id, id),
  FOREIGN KEY (business_id, customer_id)
    REFERENCES public.customers(business_id, id),
  CHECK (paid_amount + waived_amount <= scheduled_amount)
);

CREATE INDEX partner_finance_installments_branch_due_idx
  ON public.partner_finance_installments(business_id, branch_id, due_date);

CREATE TABLE public.partner_finance_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  agreement_id uuid NOT NULL,
  installment_id uuid,
  branch_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  event_type text NOT NULL CONSTRAINT partner_finance_transactions_event_type_check
    CHECK (event_type IN ('payment','refund','downpayment_refund','waiver')),
  transaction_status text NOT NULL DEFAULT 'posted' CHECK (transaction_status IN ('posted','reversed')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  transaction_date date NOT NULL,
  money_account_id uuid,
  money_transaction_id uuid,
  source_money_transaction_id uuid,
  journal_entry_id uuid,
  idempotency_key text NOT NULL CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 120),
  reversal_of uuid,
  approved_by uuid,
  remarks text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, id),
  UNIQUE (business_id, idempotency_key),
  UNIQUE (business_id, money_transaction_id),
  UNIQUE (business_id, journal_entry_id),
  FOREIGN KEY (business_id, agreement_id)
    REFERENCES public.partner_financed_sales(business_id, id),
  FOREIGN KEY (business_id, installment_id)
    REFERENCES public.partner_finance_installments(business_id, id),
  FOREIGN KEY (business_id, branch_id)
    REFERENCES public.branches(business_id, id),
  FOREIGN KEY (business_id, customer_id)
    REFERENCES public.customers(business_id, id),
  FOREIGN KEY (business_id, money_account_id)
    REFERENCES public.money_accounts(business_id, id),
  FOREIGN KEY (business_id, money_transaction_id)
    REFERENCES public.money_transactions(business_id, id),
  FOREIGN KEY (business_id, source_money_transaction_id)
    REFERENCES public.money_transactions(business_id, id),
  FOREIGN KEY (business_id, journal_entry_id)
    REFERENCES public.journal_entries(business_id, id),
  FOREIGN KEY (business_id, reversal_of)
    REFERENCES public.partner_finance_transactions(business_id, id),
  CONSTRAINT partner_finance_transactions_accounting_check CHECK (
    (event_type = 'waiver' AND approved_by IS NOT NULL AND money_account_id IS NULL AND installment_id IS NOT NULL)
    OR (event_type IN ('payment','refund') AND money_account_id IS NOT NULL AND installment_id IS NOT NULL)
    OR (event_type = 'downpayment_refund' AND money_account_id IS NOT NULL
      AND installment_id IS NULL AND source_money_transaction_id IS NOT NULL)
  ),
  CONSTRAINT partner_finance_transactions_reversal_check CHECK (
    (event_type='refund' AND reversal_of IS NOT NULL AND source_money_transaction_id IS NULL)
    OR (event_type='downpayment_refund' AND reversal_of IS NULL AND source_money_transaction_id IS NOT NULL)
    OR (event_type IN ('payment','waiver') AND reversal_of IS NULL AND source_money_transaction_id IS NULL)
  )
);

CREATE INDEX partner_finance_transactions_branch_date_idx
  ON public.partner_finance_transactions(business_id, branch_id, transaction_date DESC);

CREATE TRIGGER audit_partner_finance_installments
  AFTER INSERT OR UPDATE OR DELETE ON public.partner_finance_installments
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();
CREATE TRIGGER audit_partner_finance_transactions
  AFTER INSERT OR UPDATE OR DELETE ON public.partner_finance_transactions
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

ALTER TABLE public.partner_finance_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_finance_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_finance_installments_read
  ON public.partner_finance_installments FOR SELECT TO authenticated
  USING (public.can_access_partner_finance_branch(business_id, branch_id));
CREATE POLICY partner_finance_transactions_read
  ON public.partner_finance_transactions FOR SELECT TO authenticated
  USING (public.can_access_partner_finance_branch(business_id, branch_id));
GRANT SELECT ON public.partner_finance_installments, public.partner_finance_transactions TO authenticated;
REVOKE ALL ON public.partner_finance_installments, public.partner_finance_transactions FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.create_partner_finance_installments()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_base numeric(14,2);
  v_amount numeric(14,2);
  v_remaining numeric(14,2) := NEW.customer_total_repayment;
  v_no integer;
BEGIN
  v_base := ROUND(NEW.customer_total_repayment / NEW.installment_count, 2);
  IF v_base <= 0 THEN
    RAISE EXCEPTION 'Customer repayment total is too small to create positive installments.';
  END IF;
  FOR v_no IN 1..NEW.installment_count LOOP
    v_amount := CASE WHEN v_no = NEW.installment_count
      THEN v_remaining ELSE v_base END;
    INSERT INTO public.partner_finance_installments(
      business_id,agreement_id,branch_id,customer_id,installment_no,due_date,scheduled_amount
    ) VALUES (
      NEW.business_id,NEW.id,NEW.branch_id,NEW.customer_id,v_no,
      (NEW.transaction_date + make_interval(months => v_no))::date,v_amount
    );
    v_remaining := v_remaining - v_amount;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER create_partner_finance_installments
  AFTER INSERT ON public.partner_financed_sales
  FOR EACH ROW EXECUTE FUNCTION public.create_partner_finance_installments();

INSERT INTO public.partner_finance_installments(
  business_id,agreement_id,branch_id,customer_id,installment_no,due_date,scheduled_amount
)
SELECT pfs.business_id,pfs.id,pfs.branch_id,pfs.customer_id,n,
       (pfs.transaction_date + make_interval(months => n))::date,
       CASE WHEN n = pfs.installment_count
         THEN pfs.customer_total_repayment
           - ROUND(pfs.customer_total_repayment / pfs.installment_count,2) * (pfs.installment_count - 1)
         ELSE ROUND(pfs.customer_total_repayment / pfs.installment_count,2)
       END
  FROM public.partner_financed_sales pfs
 CROSS JOIN LATERAL generate_series(1,pfs.installment_count) AS seq(n)
 WHERE ROUND(pfs.customer_total_repayment / pfs.installment_count,2) > 0
ON CONFLICT (business_id,agreement_id,installment_no) DO NOTHING;

CREATE OR REPLACE FUNCTION public.enforce_partner_finance_branch_access()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
    AND NOT public.can_access_partner_finance_branch(NEW.business_id,NEW.branch_id) THEN
    RAISE EXCEPTION 'You do not have access to this brand shop.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER enforce_partner_finance_branch_access
  BEFORE INSERT ON public.partner_financed_sales
  FOR EACH ROW EXECUTE FUNCTION public.enforce_partner_finance_branch_access();

CREATE UNIQUE INDEX partner_finance_operational_journal_once
  ON public.journal_entries (business_id, ref_type, ref_id)
  WHERE ref_type IN ('partner_finance_installment','partner_finance_refund','partner_finance_waiver')
    AND ref_id IS NOT NULL;

CREATE UNIQUE INDEX partner_finance_operational_money_once
  ON public.money_transactions (business_id, ref_type, ref_id)
  WHERE ref_type IN ('partner_finance_installment','partner_finance_refund')
    AND ref_id IS NOT NULL;

DROP POLICY partner_financed_sales_read ON public.partner_financed_sales;
CREATE POLICY partner_financed_sales_read
  ON public.partner_financed_sales FOR SELECT TO authenticated
  USING (public.can_access_partner_finance_branch(business_id, branch_id));

DROP POLICY partner_settlement_lines_read ON public.partner_settlement_lines;
CREATE POLICY partner_settlement_lines_read
  ON public.partner_settlement_lines FOR SELECT TO authenticated
  USING (
    public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
    OR public.can_access_partner_finance_branch(business_id, branch_id)
  );

DROP POLICY partner_settlement_batches_read ON public.partner_settlement_batches;
CREATE POLICY partner_settlement_batches_read
  ON public.partner_settlement_batches FOR SELECT TO authenticated
  USING (
    public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
    OR EXISTS (
      SELECT 1 FROM public.partner_settlement_lines l
       WHERE l.business_id = partner_settlement_batches.business_id
         AND l.batch_id = partner_settlement_batches.id
         AND public.can_access_partner_finance_branch(l.business_id, l.branch_id)
    )
  );

CREATE POLICY partner_finance_accounts_branch_scope
  ON public.money_accounts AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
    OR public.can_access_partner_finance_branch(business_id, branch_id)
    OR public.can_access_daily_closing_branch(business_id, branch_id)
  );

CREATE POLICY partner_finance_journal_entries_read
  ON public.journal_entries FOR SELECT TO authenticated
  USING (
    ref_type IN (
      'partner_finance_sale','partner_finance_cogs','partner_finance_downpayment',
      'partner_finance_settlement','partner_finance_settlement_reversal',
      'partner_finance_installment','partner_finance_refund','partner_finance_waiver'
    )
    AND public.can_access_partner_finance_branch(business_id,branch_id)
  );

CREATE POLICY partner_finance_journal_lines_read
  ON public.journal_lines FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.journal_entries e
       WHERE e.business_id=journal_lines.business_id
         AND e.id=journal_lines.entry_id
         AND e.ref_type IN (
           'partner_finance_sale','partner_finance_cogs','partner_finance_downpayment',
           'partner_finance_settlement','partner_finance_settlement_reversal',
           'partner_finance_installment','partner_finance_refund','partner_finance_waiver'
         )
         AND public.can_access_partner_finance_branch(e.business_id,e.branch_id)
    )
  );

CREATE POLICY partner_finance_money_txns_branch_scope
  ON public.money_transactions AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
    OR public.can_access_partner_finance_branch(business_id, branch_id)
    OR public.can_access_daily_closing_branch(business_id, branch_id)
  );

CREATE POLICY partner_finance_journals_branch_scope
  ON public.journal_entries AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
    OR public.can_access_partner_finance_branch(business_id, branch_id)
  );

CREATE POLICY partner_finance_journal_lines_branch_scope
  ON public.journal_lines AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
    OR EXISTS (
      SELECT 1 FROM public.journal_entries e
       WHERE e.business_id = journal_lines.business_id
         AND e.id = journal_lines.entry_id
         AND public.can_access_partner_finance_branch(e.business_id, e.branch_id)
    )
  );

CREATE OR REPLACE FUNCTION public.protect_partner_finance_transaction()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Partner Finance transactions are append-only; record a reversal instead.';
  END IF;
  IF ROW(
       NEW.business_id,NEW.agreement_id,NEW.installment_id,NEW.branch_id,NEW.customer_id,
       NEW.event_type,NEW.amount,NEW.transaction_date,NEW.money_account_id,
       NEW.source_money_transaction_id,NEW.idempotency_key,NEW.reversal_of,
       NEW.approved_by,NEW.remarks,NEW.transaction_status,
       NEW.created_by,NEW.created_at
     ) IS DISTINCT FROM ROW(
       OLD.business_id,OLD.agreement_id,OLD.installment_id,OLD.branch_id,OLD.customer_id,
       OLD.event_type,OLD.amount,OLD.transaction_date,OLD.money_account_id,
       OLD.source_money_transaction_id,OLD.idempotency_key,OLD.reversal_of,
       OLD.approved_by,OLD.remarks,OLD.transaction_status,
       OLD.created_by,OLD.created_at
     )
    OR OLD.journal_entry_id IS NOT NULL OR OLD.money_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Posted Partner Finance transaction details cannot be edited.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER protect_partner_finance_transaction
  BEFORE UPDATE OR DELETE ON public.partner_finance_transactions
  FOR EACH ROW EXECUTE FUNCTION public.protect_partner_finance_transaction();

ALTER TABLE public.daily_closings
  ADD COLUMN branch_id uuid,
  ADD COLUMN cash_collection numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN bank_collection numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN mfs_collection numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN refund_total numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN adjustment_total numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN prepared_by uuid,
  ADD COLUMN reviewed_by uuid,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN closing_status text NOT NULL DEFAULT 'closed',
  ADD COLUMN difference_reason text,
  ADD COLUMN difference_approved_by uuid,
  ADD COLUMN difference_approved_at timestamptz;

UPDATE public.daily_closings dc
   SET branch_id = ma.branch_id,
       prepared_by = COALESCE(dc.closed_by, dc.prepared_by)
  FROM public.money_accounts ma
 WHERE ma.business_id = dc.business_id AND ma.id = dc.account_id;

ALTER TABLE public.daily_closings
  ADD CONSTRAINT daily_closings_business_branch_fkey
    FOREIGN KEY (business_id, branch_id) REFERENCES public.branches(business_id, id),
  ADD CONSTRAINT daily_closings_status_check
    CHECK (closing_status IN ('closed','pending_review','reviewed')),
  ADD CONSTRAINT daily_closings_difference_check
    CHECK (
      (ABS(variance) < 0.01 AND closing_status <> 'pending_review'
        AND difference_approved_by IS NULL AND difference_approved_at IS NULL)
      OR (ABS(variance) >= 0.01 AND length(trim(COALESCE(difference_reason,''))) > 0
        AND (
          (closing_status = 'pending_review' AND difference_approved_by IS NULL AND difference_approved_at IS NULL)
          OR (closing_status = 'reviewed' AND difference_approved_by IS NOT NULL AND difference_approved_at IS NOT NULL)
        ))
      OR (ABS(variance) >= 0.01 AND closing_status = 'closed'
        AND difference_reason IS NULL AND difference_approved_by IS NULL AND difference_approved_at IS NULL)
    );

ALTER TABLE public.daily_closings
  DROP CONSTRAINT IF EXISTS daily_closings_account_id_closing_date_key;
CREATE UNIQUE INDEX daily_closings_shop_account_date_unique
  ON public.daily_closings(business_id,account_id,branch_id,closing_date);
CREATE INDEX daily_closings_branch_date_idx
  ON public.daily_closings(business_id,branch_id,closing_date DESC);

DROP POLICY "finance read closings" ON public.daily_closings;
CREATE POLICY finance_read_closings
  ON public.daily_closings FOR SELECT TO authenticated
  USING (
    public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
    OR public.can_access_daily_closing_branch(business_id, branch_id)
  );

DROP FUNCTION public.close_day(uuid,uuid,date,numeric,text);
CREATE FUNCTION public.close_day(
  _biz uuid, _branch uuid, _account uuid, _date date, _actual numeric,
  _note text, _difference_reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account_branch uuid;
  v_previous_date date;
  v_previous_actual numeric(14,2);
  v_open numeric(14,2);
  v_in numeric(14,2);
  v_out numeric(14,2);
  v_cash_collection numeric(14,2);
  v_bank_collection numeric(14,2);
  v_mfs_collection numeric(14,2);
  v_refunds numeric(14,2);
  v_adjustments numeric(14,2);
  v_expected numeric(14,2);
  v_variance numeric(14,2);
  v_id uuid;
BEGIN
  IF NOT public.has_module_access(_biz,'closing','view')
    OR NOT public.has_module_access(_biz,'closing','create')
    OR NOT public.can_access_daily_closing_branch(_biz,_branch) THEN
    RAISE EXCEPTION 'You do not have permission to close this shop.';
  END IF;
  IF _date IS NULL OR _date > current_date THEN RAISE EXCEPTION 'Cannot close a future date.'; END IF;
  IF _actual IS NULL OR _actual < 0 THEN RAISE EXCEPTION 'Enter the counted cash.'; END IF;
  SELECT branch_id INTO v_account_branch
    FROM public.money_accounts
   WHERE business_id=_biz AND id=_account AND kind='cash' AND status='active';
  IF NOT FOUND OR (v_account_branch IS NOT NULL AND v_account_branch <> _branch) THEN
    RAISE EXCEPTION 'Select an active cash account assigned to this shop or shared centrally.';
  END IF;

  SELECT closing_date,actual INTO v_previous_date,v_previous_actual
    FROM public.daily_closings
   WHERE business_id=_biz AND account_id=_account AND branch_id=_branch
     AND closing_date < _date
   ORDER BY closing_date DESC LIMIT 1;
  IF v_previous_date IS NULL THEN
    SELECT CASE WHEN v_account_branch=_branch THEN ma.opening_balance ELSE 0 END
        + COALESCE(sum(CASE WHEN mt.direction='in' THEN mt.amount ELSE -mt.amount END),0)
      INTO v_open
      FROM public.money_accounts ma
      LEFT JOIN public.money_transactions mt
        ON mt.business_id=ma.business_id AND mt.account_id=ma.id AND mt.txn_date<_date
       AND (
         mt.branch_id=_branch
         OR (ma.branch_id=_branch AND mt.branch_id IS NULL)
       )
     WHERE ma.business_id=_biz AND ma.id=_account
     GROUP BY ma.opening_balance;
  ELSE
    SELECT v_previous_actual
        + COALESCE(sum(CASE WHEN mt.direction='in' THEN mt.amount ELSE -mt.amount END),0)
      INTO v_open
      FROM public.money_transactions mt
     WHERE mt.business_id=_biz AND mt.account_id=_account
       AND mt.txn_date>v_previous_date AND mt.txn_date<_date
       AND (mt.branch_id=_branch OR (v_account_branch=_branch AND mt.branch_id IS NULL));
  END IF;

  SELECT
    COALESCE(sum(mt.amount) FILTER (WHERE mt.direction='in'),0),
    COALESCE(sum(mt.amount) FILTER (WHERE mt.direction='out'),0)
    INTO v_in,v_out
    FROM public.money_transactions mt
   WHERE mt.business_id=_biz AND mt.account_id=_account AND mt.txn_date=_date
     AND (mt.branch_id=_branch OR (v_account_branch=_branch AND mt.branch_id IS NULL));

  SELECT
    COALESCE(sum(mt.amount) FILTER (WHERE mt.direction='in' AND ma.kind='cash'),0),
    COALESCE(sum(mt.amount) FILTER (WHERE mt.direction='in' AND ma.kind='bank'),0),
    COALESCE(sum(mt.amount) FILTER (WHERE mt.direction='in' AND ma.kind='mfs'),0),
    COALESCE(sum(mt.amount) FILTER (
      WHERE mt.direction='out'
        AND mt.kind IN ('partner_finance_refund','partner_finance_settlement_reversal')
    ),0),
    COALESCE(sum(mt.amount) FILTER (WHERE mt.kind IN ('adjustment','transfer_in','transfer_out')),0)
    INTO v_cash_collection,v_bank_collection,v_mfs_collection,v_refunds,v_adjustments
    FROM public.money_transactions mt
    JOIN public.money_accounts ma ON ma.business_id=mt.business_id AND ma.id=mt.account_id
   WHERE mt.business_id=_biz AND mt.txn_date=_date
     AND (mt.branch_id=_branch OR (ma.branch_id=_branch AND mt.branch_id IS NULL));

  v_expected := COALESCE(v_open,0)+COALESCE(v_in,0)-COALESCE(v_out,0);
  v_variance := ROUND(_actual-v_expected,2);
  IF ABS(v_variance)>=0.01 AND length(trim(COALESCE(_difference_reason,'')))<3 THEN
    RAISE EXCEPTION 'Explain the cash difference before submitting this closing.';
  END IF;
  INSERT INTO public.daily_closings(
    business_id,account_id,branch_id,closing_date,opening,cash_in,cash_out,
    expected,actual,variance,note,closed_by,prepared_by,cash_collection,
    bank_collection,mfs_collection,refund_total,adjustment_total,closing_status,difference_reason
  ) VALUES (
    _biz,_account,_branch,_date,COALESCE(v_open,0),COALESCE(v_in,0),COALESCE(v_out,0),
    v_expected,ROUND(_actual,2),v_variance,NULLIF(trim(COALESCE(_note,'')),''),auth.uid(),
    auth.uid(),COALESCE(v_cash_collection,0),COALESCE(v_bank_collection,0),
    COALESCE(v_mfs_collection,0),COALESCE(v_refunds,0),COALESCE(v_adjustments,0),
    CASE WHEN ABS(v_variance)>=0.01 THEN 'pending_review' ELSE 'closed' END,
    CASE WHEN ABS(v_variance)>=0.01 THEN trim(_difference_reason) END
  ) RETURNING id INTO v_id;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This shop account is already closed for this date.';
END $$;

CREATE OR REPLACE FUNCTION public.review_daily_closing(_biz uuid, _closing uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_closing public.daily_closings%ROWTYPE;
BEGIN
  IF NOT public.has_module_access(_biz,'closing','view')
    OR NOT public.has_module_access(_biz,'closing','approve')
    OR NOT public.has_biz_role(_biz,ARRAY['owner','manager','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'Only central finance roles may review a cash difference.';
  END IF;
  SELECT * INTO v_closing FROM public.daily_closings
   WHERE business_id=_biz AND id=_closing FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Daily closing not found.'; END IF;
  IF v_closing.closing_status<>'pending_review' THEN
    RAISE EXCEPTION 'Only a closing with a cash difference awaiting review can be reviewed.';
  END IF;
  IF v_closing.prepared_by=auth.uid() THEN
    RAISE EXCEPTION 'The preparer cannot approve their own cash difference.';
  END IF;
  UPDATE public.daily_closings
     SET closing_status='reviewed',reviewed_by=auth.uid(),reviewed_at=now(),
         difference_approved_by=auth.uid(),difference_approved_at=now()
   WHERE business_id=_biz AND id=_closing;
END $$;

CREATE OR REPLACE FUNCTION public.partner_finance_operational_report(
  _biz uuid,
  _provider uuid DEFAULT NULL,
  _from date DEFAULT NULL,
  _to date DEFAULT NULL,
  _branch uuid DEFAULT NULL,
  _customer uuid DEFAULT NULL,
  _status text DEFAULT NULL,
  _transaction_type text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_source jsonb;
  v_result jsonb;
  v_sales jsonb;
  v_settlements jsonb;
  v_installments jsonb;
  v_transactions jsonb;
  v_customers jsonb;
  v_summary jsonb;
  v_monthly jsonb;
  v_yearly jsonb;
BEGIN
  IF NOT public.has_module_access(_biz,'sales','view') THEN
    RAISE EXCEPTION 'You do not have permission to view Partner Finance.';
  END IF;
  IF _from IS NOT NULL AND _to IS NOT NULL AND _from>_to THEN
    RAISE EXCEPTION 'Report start date must not be after end date.';
  END IF;
  IF _branch IS NOT NULL AND NOT public.can_access_partner_finance_branch(_biz,_branch) THEN
    RAISE EXCEPTION 'You do not have access to this brand shop.';
  END IF;
  IF _customer IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.customers WHERE business_id=_biz AND id=_customer
  ) THEN RAISE EXCEPTION 'Customer not found in this business.'; END IF;
  v_source := public.partner_finance_snapshot(_biz,_provider);

  SELECT COALESCE(jsonb_agg(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(x,'{settled_amount}',to_jsonb(COALESCE(st.settled_amount,0)),true),
          '{fee_total}',to_jsonb(COALESCE(st.fee_total,0)),true
        ),
        '{outstanding_settlement}',to_jsonb(GREATEST(pfs.expected_settlement-COALESCE(st.settled_amount,0),0)),true
      ),
      '{settlement_status}',
      to_jsonb(CASE WHEN COALESCE(st.settled_amount,0)>pfs.expected_settlement+0.01 THEN 'overpaid'
        WHEN COALESCE(st.settled_amount,0)>=pfs.expected_settlement-0.01 THEN 'settled'
        WHEN COALESCE(st.settled_amount,0)>0 THEN 'partial' ELSE 'pending' END),
      true
    ) ORDER BY x->>'sale_date' DESC),'[]'::jsonb)
    INTO v_sales
    FROM jsonb_array_elements(COALESCE(v_source->'sales','[]'::jsonb)) x
    JOIN public.partner_financed_sales pfs
      ON pfs.business_id=_biz AND pfs.id=(x->>'id')::uuid
    LEFT JOIN LATERAL (
      SELECT sum(l.net_amount) settled_amount,sum(l.fee_amount) fee_total
        FROM public.partner_settlement_lines l
       WHERE l.business_id=_biz AND l.financed_sale_id=pfs.id
         AND l.status='matched' AND l.accounting_status='posted'
    ) st ON true
   WHERE public.can_access_partner_finance_branch(_biz,(x->>'branch_id')::uuid)
     AND (_provider IS NULL OR pfs.provider_id=_provider)
     AND (_branch IS NULL OR (x->>'branch_id')::uuid=_branch)
     AND (_customer IS NULL OR (x->>'customer_id')::uuid=_customer)
     AND (_status IS NULL OR x->>'status'=_status)
     AND (_from IS NULL OR (x->>'sale_date')::date>=_from)
     AND (_to IS NULL OR (x->>'sale_date')::date<=_to);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',c.id,'name',c.name,'mobile',c.mobile
  ) ORDER BY c.name),'[]'::jsonb)
    INTO v_customers
    FROM (
      SELECT DISTINCT pfs.customer_id
        FROM public.partner_financed_sales pfs
       WHERE pfs.business_id=_biz
         AND (_provider IS NULL OR pfs.provider_id=_provider)
         AND public.can_access_partner_finance_branch(_biz,pfs.branch_id)
         AND (_branch IS NULL OR pfs.branch_id=_branch)
    ) visible
    JOIN public.customers c ON c.business_id=_biz AND c.id=visible.customer_id
   WHERE c.status='active';

  SELECT COALESCE(jsonb_agg(
    x || jsonb_build_object(
      'accounting_status',l.accounting_status,
      'branch_id',l.branch_id,
      'money_transaction_id',l.money_transaction_id,
      'journal_entry_id',l.journal_entry_id,
      'reversal_money_transaction_id',l.reversal_money_transaction_id,
      'reversal_journal_entry_id',l.reversal_journal_entry_id,
      'reversed_by',l.reversed_by,
      'reversed_at',l.reversed_at,
      'reversal_reason',reversal_mt.note
    ) ORDER BY x->>'paid_on' DESC
  ),'[]'::jsonb)
    INTO v_settlements
    FROM jsonb_array_elements(COALESCE(v_source->'settlements','[]'::jsonb)) x
    JOIN public.partner_settlement_lines l
      ON l.business_id=_biz AND l.id=(x->>'id')::uuid
    LEFT JOIN public.money_transactions reversal_mt
      ON reversal_mt.business_id=l.business_id
     AND reversal_mt.id=l.reversal_money_transaction_id
   WHERE (
       l.branch_id IS NOT NULL
       AND public.can_access_partner_finance_branch(_biz,l.branch_id)
       AND (_branch IS NULL OR l.branch_id=_branch)
     OR l.branch_id IS NULL
       AND public.has_biz_role(_biz,ARRAY['owner','manager','accountant']::public.member_role[])
       AND _branch IS NULL
     )
     AND (_from IS NULL OR (x->>'paid_on')::date>=_from)
     AND (_to IS NULL OR (x->>'paid_on')::date<=_to)
     AND (_status IS NULL OR x->>'status'=_status OR l.accounting_status=_status);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',i.id,'agreement_id',i.agreement_id,'installment_no',i.installment_no,
    'branch_id',i.branch_id,'branch_name',b.name,'customer_id',i.customer_id,
    'customer_name',c.name,'invoice_no',s.invoice_no,'due_date',i.due_date,
    'scheduled_amount',i.scheduled_amount,'paid_amount',i.paid_amount,
    'waived_amount',i.waived_amount,
    'outstanding',i.scheduled_amount-i.paid_amount-i.waived_amount,
    'status',CASE WHEN i.scheduled_amount=i.paid_amount+i.waived_amount THEN 'paid'
      WHEN i.paid_amount+i.waived_amount>0 THEN 'partial'
      WHEN i.due_date<current_date THEN 'overdue' ELSE 'pending' END
  ) ORDER BY i.due_date),'[]'::jsonb)
    INTO v_installments
    FROM public.partner_finance_installments i
    JOIN public.partner_financed_sales pfs
      ON pfs.business_id=i.business_id AND pfs.id=i.agreement_id
    JOIN public.sales s ON s.business_id=pfs.business_id AND s.id=pfs.sale_id
    JOIN public.branches b ON b.business_id=i.business_id AND b.id=i.branch_id
    JOIN public.customers c ON c.business_id=i.business_id AND c.id=i.customer_id
   WHERE i.business_id=_biz
     AND (_provider IS NULL OR pfs.provider_id=_provider)
     AND public.can_access_partner_finance_branch(_biz,i.branch_id)
     AND (_branch IS NULL OR i.branch_id=_branch)
     AND (_customer IS NULL OR i.customer_id=_customer)
     AND (_from IS NULL OR i.due_date>=_from)
     AND (_to IS NULL OR i.due_date<=_to)
     AND (_status IS NULL OR
       CASE WHEN i.scheduled_amount=i.paid_amount+i.waived_amount THEN 'paid'
         WHEN i.paid_amount+i.waived_amount>0 THEN 'partial'
         WHEN i.due_date<current_date THEN 'overdue' ELSE 'pending' END = _status);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',t.id,'agreement_id',t.agreement_id,'installment_id',t.installment_id,
    'branch_id',t.branch_id,'branch_name',b.name,'customer_id',t.customer_id,
    'customer_name',c.name,'event_type',t.event_type,'amount',t.amount,
    'transaction_date',t.transaction_date,'money_account_id',t.money_account_id,
    'money_transaction_id',t.money_transaction_id,'journal_entry_id',t.journal_entry_id,
    'reversal_of',t.reversal_of,'source_money_transaction_id',t.source_money_transaction_id,
    'approved_by',t.approved_by,'remarks',t.remarks,
    'created_by',t.created_by,'created_at',t.created_at,'status',t.transaction_status
  ) ORDER BY t.transaction_date DESC,t.created_at DESC),'[]'::jsonb)
    INTO v_transactions
    FROM public.partner_finance_transactions t
    JOIN public.partner_financed_sales pfs
      ON pfs.business_id=t.business_id AND pfs.id=t.agreement_id
    JOIN public.branches b ON b.business_id=t.business_id AND b.id=t.branch_id
    JOIN public.customers c ON c.business_id=t.business_id AND c.id=t.customer_id
   WHERE t.business_id=_biz
     AND (_provider IS NULL OR pfs.provider_id=_provider)
     AND public.can_access_partner_finance_branch(_biz,t.branch_id)
     AND (_branch IS NULL OR t.branch_id=_branch)
     AND (_customer IS NULL OR t.customer_id=_customer)
     AND (_from IS NULL OR t.transaction_date>=_from)
     AND (_to IS NULL OR t.transaction_date<=_to)
     AND (_status IS NULL OR t.transaction_status=_status)
     AND (_transaction_type IS NULL OR t.event_type=_transaction_type);

  SELECT jsonb_build_object(
    'agreement_count',count(*)::integer,
    'contract_value',COALESCE(sum(s.total),0),
    'scheduled_downpayment',COALESCE(sum(pfs.downpayment),0),
    'downpayment_discount',COALESCE(sum(pfs.discount_amount),0),
    'net_downpayment',COALESCE(sum(pfs.net_downpayment),0),
    'partner_receivable_outstanding',COALESCE(sum(GREATEST(
      pfs.expected_settlement-COALESCE(st.settled,0),0
    )),0),
    'settlement_fee_total',COALESCE(sum(st.fee_total),0),
    'settlement_adjustment_total',COALESCE(sum(st.adjustment_total),0),
    'installment_collected',COALESCE((
      SELECT sum(CASE WHEN t.event_type='payment' THEN t.amount ELSE -t.amount END)
        FROM public.partner_finance_transactions t
       WHERE t.business_id=_biz AND t.event_type IN ('payment','refund')
         AND (_provider IS NULL OR EXISTS (
           SELECT 1 FROM public.partner_financed_sales agreement_provider
            WHERE agreement_provider.business_id=t.business_id
              AND agreement_provider.id=t.agreement_id
              AND agreement_provider.provider_id=_provider
         ))
         AND public.can_access_partner_finance_branch(_biz,t.branch_id)
         AND (_branch IS NULL OR t.branch_id=_branch)
         AND (_customer IS NULL OR t.customer_id=_customer)
         AND (_from IS NULL OR t.transaction_date>=_from)
         AND (_to IS NULL OR t.transaction_date<=_to)
         AND (_transaction_type IS NULL OR t.event_type=_transaction_type)
    ),0),
    'customer_due',COALESCE((
      SELECT sum(i.scheduled_amount-i.paid_amount-i.waived_amount)
        FROM public.partner_finance_installments i
       WHERE i.business_id=_biz AND public.can_access_partner_finance_branch(_biz,i.branch_id)
         AND (_provider IS NULL OR EXISTS (
           SELECT 1 FROM public.partner_financed_sales agreement_provider
            WHERE agreement_provider.business_id=i.business_id
              AND agreement_provider.id=i.agreement_id
              AND agreement_provider.provider_id=_provider
         ))
         AND (_branch IS NULL OR i.branch_id=_branch)
         AND (_customer IS NULL OR i.customer_id=_customer)
         AND (_from IS NULL OR i.due_date>=_from)
         AND (_to IS NULL OR i.due_date<=_to)
    ),0)+COALESCE((
      SELECT sum(t.amount) FROM public.partner_finance_transactions t
       WHERE t.business_id=_biz AND t.event_type='downpayment_refund'
         AND (_provider IS NULL OR EXISTS (
           SELECT 1 FROM public.partner_financed_sales agreement_provider
            WHERE agreement_provider.business_id=t.business_id
              AND agreement_provider.id=t.agreement_id
              AND agreement_provider.provider_id=_provider
         ))
         AND public.can_access_partner_finance_branch(_biz,t.branch_id)
         AND (_branch IS NULL OR t.branch_id=_branch)
         AND (_customer IS NULL OR t.customer_id=_customer)
         AND (_from IS NULL OR t.transaction_date>=_from)
         AND (_to IS NULL OR t.transaction_date<=_to)
    ),0),
    'installment_due',COALESCE((
      SELECT sum(i.scheduled_amount-i.paid_amount-i.waived_amount)
        FROM public.partner_finance_installments i
       WHERE i.business_id=_biz AND public.can_access_partner_finance_branch(_biz,i.branch_id)
         AND (_provider IS NULL OR EXISTS (
           SELECT 1 FROM public.partner_financed_sales agreement_provider
            WHERE agreement_provider.business_id=i.business_id
              AND agreement_provider.id=i.agreement_id
              AND agreement_provider.provider_id=_provider
         ))
         AND (_branch IS NULL OR i.branch_id=_branch)
         AND (_customer IS NULL OR i.customer_id=_customer)
         AND (_from IS NULL OR i.due_date>=_from)
         AND (_to IS NULL OR i.due_date<=_to)
    ),0),
    'overdue_installments',COALESCE((
      SELECT count(*)::integer FROM public.partner_finance_installments i
       WHERE i.business_id=_biz AND public.can_access_partner_finance_branch(_biz,i.branch_id)
         AND (_provider IS NULL OR EXISTS (
           SELECT 1 FROM public.partner_financed_sales agreement_provider
            WHERE agreement_provider.business_id=i.business_id
              AND agreement_provider.id=i.agreement_id
              AND agreement_provider.provider_id=_provider
         ))
         AND i.due_date<current_date AND i.paid_amount+i.waived_amount<i.scheduled_amount
         AND (_branch IS NULL OR i.branch_id=_branch)
         AND (_customer IS NULL OR i.customer_id=_customer)
         AND (_from IS NULL OR i.due_date>=_from)
         AND (_to IS NULL OR i.due_date<=_to)
    ),0),
    'refund_total',COALESCE((
      SELECT sum(t.amount) FROM public.partner_finance_transactions t
       WHERE t.business_id=_biz AND t.event_type IN ('refund','downpayment_refund')
         AND (_provider IS NULL OR EXISTS (
           SELECT 1 FROM public.partner_financed_sales agreement_provider
            WHERE agreement_provider.business_id=t.business_id
              AND agreement_provider.id=t.agreement_id
              AND agreement_provider.provider_id=_provider
         ))
         AND public.can_access_partner_finance_branch(_biz,t.branch_id)
         AND (_branch IS NULL OR t.branch_id=_branch)
         AND (_customer IS NULL OR t.customer_id=_customer)
         AND (_from IS NULL OR t.transaction_date>=_from)
         AND (_to IS NULL OR t.transaction_date<=_to)
         AND (_transaction_type IS NULL OR t.event_type=_transaction_type)
    ),0),
    'downpayment_refund_due',COALESCE((
      SELECT sum(t.amount) FROM public.partner_finance_transactions t
       WHERE t.business_id=_biz AND t.event_type='downpayment_refund'
         AND (_provider IS NULL OR EXISTS (
           SELECT 1 FROM public.partner_financed_sales agreement_provider
            WHERE agreement_provider.business_id=t.business_id
              AND agreement_provider.id=t.agreement_id
              AND agreement_provider.provider_id=_provider
         ))
         AND public.can_access_partner_finance_branch(_biz,t.branch_id)
         AND (_branch IS NULL OR t.branch_id=_branch)
         AND (_customer IS NULL OR t.customer_id=_customer)
         AND (_from IS NULL OR t.transaction_date>=_from)
         AND (_to IS NULL OR t.transaction_date<=_to)
    ),0),
    'installment_waivers',COALESCE((
      SELECT sum(t.amount) FROM public.partner_finance_transactions t
       WHERE t.business_id=_biz AND t.event_type='waiver'
         AND (_provider IS NULL OR EXISTS (
           SELECT 1 FROM public.partner_financed_sales agreement_provider
            WHERE agreement_provider.business_id=t.business_id
              AND agreement_provider.id=t.agreement_id
              AND agreement_provider.provider_id=_provider
         ))
         AND public.can_access_partner_finance_branch(_biz,t.branch_id)
         AND (_branch IS NULL OR t.branch_id=_branch)
         AND (_customer IS NULL OR t.customer_id=_customer)
         AND (_from IS NULL OR t.transaction_date>=_from)
         AND (_to IS NULL OR t.transaction_date<=_to)
    ),0)
  ) INTO v_summary
  FROM public.partner_financed_sales pfs
  JOIN public.sales s ON s.business_id=pfs.business_id AND s.id=pfs.sale_id
  LEFT JOIN LATERAL (
    SELECT sum(l.net_amount) settled,
           sum(l.fee_amount) fee_total,
           sum(l.adjustment_amount) adjustment_total
      FROM public.partner_settlement_lines l
     WHERE l.business_id=pfs.business_id AND l.financed_sale_id=pfs.id
       AND l.status='matched' AND l.accounting_status='posted'
       AND (_from IS NULL OR l.paid_on>=_from)
       AND (_to IS NULL OR l.paid_on<=_to)
  ) st ON true
  WHERE pfs.business_id=_biz
    AND (_provider IS NULL OR pfs.provider_id=_provider)
    AND public.can_access_partner_finance_branch(_biz,pfs.branch_id)
    AND (_branch IS NULL OR pfs.branch_id=_branch)
    AND (_customer IS NULL OR pfs.customer_id=_customer)
    AND (_status IS NULL OR pfs.status=_status)
    AND (_from IS NULL OR pfs.transaction_date>=_from)
    AND (_to IS NULL OR pfs.transaction_date<=_to)
    AND (_transaction_type IS NULL OR _transaction_type IN ('agreement','sale'));

  SELECT COALESCE(jsonb_agg(to_jsonb(monthly) ORDER BY monthly.month),'[]'::jsonb)
    INTO v_monthly
    FROM (
      SELECT to_char(date_trunc('month',pfs.transaction_date),'YYYY-MM') AS month,
             count(*)::integer AS agreement_count,
             sum(s.total) AS contract_value,
             sum(pfs.discount_amount) AS discount_total
        FROM public.partner_financed_sales pfs
        JOIN public.sales s ON s.business_id=pfs.business_id AND s.id=pfs.sale_id
       WHERE pfs.business_id=_biz AND public.can_access_partner_finance_branch(_biz,pfs.branch_id)
         AND (_provider IS NULL OR pfs.provider_id=_provider)
         AND (_branch IS NULL OR pfs.branch_id=_branch)
         AND (_customer IS NULL OR pfs.customer_id=_customer)
         AND (_from IS NULL OR pfs.transaction_date>=_from)
         AND (_to IS NULL OR pfs.transaction_date<=_to)
         AND (_status IS NULL OR pfs.status=_status)
         AND (_transaction_type IS NULL OR _transaction_type IN ('agreement','sale'))
       GROUP BY date_trunc('month',pfs.transaction_date)
    ) monthly;

  SELECT COALESCE(jsonb_agg(to_jsonb(yearly) ORDER BY yearly.year),'[]'::jsonb)
    INTO v_yearly
    FROM (
      SELECT extract(year FROM pfs.transaction_date)::integer AS year,
             count(*)::integer AS agreement_count,
             sum(s.total) AS contract_value,
             sum(pfs.discount_amount) AS discount_total
        FROM public.partner_financed_sales pfs
        JOIN public.sales s ON s.business_id=pfs.business_id AND s.id=pfs.sale_id
       WHERE pfs.business_id=_biz AND public.can_access_partner_finance_branch(_biz,pfs.branch_id)
         AND (_provider IS NULL OR pfs.provider_id=_provider)
         AND (_branch IS NULL OR pfs.branch_id=_branch)
         AND (_customer IS NULL OR pfs.customer_id=_customer)
         AND (_from IS NULL OR pfs.transaction_date>=_from)
         AND (_to IS NULL OR pfs.transaction_date<=_to)
         AND (_status IS NULL OR pfs.status=_status)
         AND (_transaction_type IS NULL OR _transaction_type IN ('agreement','sale'))
       GROUP BY extract(year FROM pfs.transaction_date)
    ) yearly;

  v_result := jsonb_set(v_source,'{sales}',v_sales,true);
  v_result := jsonb_set(v_result,'{settlements}',v_settlements,true);
  v_result := jsonb_set(v_result,'{installments}',v_installments,true);
  v_result := jsonb_set(v_result,'{transactions}',v_transactions,true);
  v_result := jsonb_set(v_result,'{customers}',v_customers,true);
  v_result := jsonb_set(v_result,'{summary}',v_summary,true);
  v_result := jsonb_set(v_result,'{monthly_summary}',v_monthly,true);
  v_result := jsonb_set(v_result,'{yearly_summary}',v_yearly,true);
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.post_partner_settlement(
  _biz uuid, _line uuid, _account uuid, _idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line public.partner_settlement_lines%ROWTYPE;
  v_provider_account uuid;
  v_money_ledger uuid;
  v_money_kind public.money_kind;
  v_account_branch uuid;
  v_posting_branch uuid;
  v_journal uuid;
  v_money_txn uuid;
  v_fee_account uuid;
  v_adjustment_account uuid;
BEGIN
  IF NOT public.has_module_access(_biz,'sales','view')
    OR NOT public.has_module_access(_biz,'sales','create')
    OR NOT public.has_biz_role(_biz,ARRAY['owner','manager','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'Only central finance roles can post provider settlements.';
  END IF;
  IF length(trim(COALESCE(_idempotency_key,''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'A unique settlement posting key is required.';
  END IF;
  SELECT * INTO v_line FROM public.partner_settlement_lines
   WHERE business_id=_biz AND id=_line FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider settlement not found.'; END IF;
  IF v_line.accounting_status='posted' THEN
    IF v_line.idempotency_key=trim(_idempotency_key) AND v_line.money_account_id=_account THEN
      RETURN jsonb_build_object('line_id',v_line.id,'status',v_line.status,'accounting_status','posted');
    END IF;
    RAISE EXCEPTION 'This provider settlement has already been posted.';
  END IF;
  IF v_line.accounting_status<>'unposted' THEN
    RAISE EXCEPTION 'A reversed provider settlement cannot be posted again.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.partner_settlement_lines
     WHERE business_id=_biz AND idempotency_key=trim(_idempotency_key)
  ) THEN RAISE EXCEPTION 'The request key was already used for another settlement.'; END IF;
  SELECT fp.ledger_account_id INTO v_provider_account
    FROM public.finance_providers fp
   WHERE fp.business_id=_biz AND fp.id=v_line.provider_id;
  SELECT ma.ledger_account_id,ma.kind,ma.branch_id INTO v_money_ledger,v_money_kind,v_account_branch
    FROM public.money_accounts ma
    JOIN public.accounts a ON a.business_id=ma.business_id AND a.id=ma.ledger_account_id
   WHERE ma.business_id=_biz AND ma.id=_account AND ma.status='active'
     AND ma.kind IN ('cash','bank','mfs') AND a.type='asset'
   FOR UPDATE OF ma;
  IF v_money_ledger IS NULL OR v_provider_account IS NULL THEN
    RAISE EXCEPTION 'Select valid business cash/bank/MFS and provider receivable accounts.';
  END IF;
  IF v_line.branch_id IS NOT NULL AND v_account_branch IS NOT NULL
    AND v_line.branch_id<>v_account_branch THEN
    RAISE EXCEPTION 'Settlement account belongs to a different brand shop.';
  END IF;
  v_posting_branch := COALESCE(v_line.branch_id,v_account_branch);
  IF v_posting_branch IS NOT NULL
    AND NOT public.can_access_partner_finance_branch(_biz,v_posting_branch) THEN
    RAISE EXCEPTION 'You do not have access to the settlement shop.';
  END IF;
  v_fee_account := public.acct(_biz,'6120');
  IF v_line.adjustment_amount>=0 THEN
    v_adjustment_account := public.acct(_biz,'4900');
  ELSE
    v_adjustment_account := public.acct(_biz,'6190');
  END IF;
  IF v_fee_account IS NULL OR v_adjustment_account IS NULL THEN
    RAISE EXCEPTION 'Settlement fee or adjustment ledger account is not configured.';
  END IF;
  v_journal := public.post_journal(
    _biz,v_line.paid_on,'partner_finance_settlement',v_line.id,
    'Partner settlement from provider ' || v_line.provider_id,
    jsonb_build_array(
      public.jl(v_money_ledger,v_line.net_amount,0),
      public.jl(v_fee_account,v_line.fee_amount,0),
      public.jl(v_adjustment_account,GREATEST(-v_line.adjustment_amount,0),0),
      public.jl(v_provider_account,0,v_line.gross_amount),
      public.jl(v_adjustment_account,0,GREATEST(v_line.adjustment_amount,0))
    )
  );
  UPDATE public.journal_entries SET branch_id=v_posting_branch
   WHERE business_id=_biz AND id=v_journal;
  INSERT INTO public.money_transactions(
    business_id,account_id,branch_id,txn_date,direction,amount,kind,method,
    note,ref_type,ref_id,journal_entry_id
  ) VALUES (
    _biz,_account,v_posting_branch,v_line.paid_on,'in',v_line.net_amount,
    'partner_finance_settlement',
    CASE v_money_kind WHEN 'cash' THEN 'cash'::public.payment_method
      WHEN 'bank' THEN 'bank'::public.payment_method ELSE 'bkash'::public.payment_method END,
    COALESCE(v_line.note,'Partner finance provider settlement'),
    'partner_finance_settlement',v_line.id,v_journal
  ) RETURNING id INTO v_money_txn;
  UPDATE public.partner_settlement_lines
     SET accounting_status='posted',money_account_id=_account,
         money_transaction_id=v_money_txn,journal_entry_id=v_journal,
         idempotency_key=trim(_idempotency_key),
         branch_id=COALESCE(v_line.branch_id,v_posting_branch)
   WHERE business_id=_biz AND id=v_line.id;
  RETURN jsonb_build_object(
    'line_id',v_line.id,'status',v_line.status,'accounting_status','posted',
    'money_transaction_id',v_money_txn,'journal_entry_id',v_journal
  );
END $$;

CREATE OR REPLACE FUNCTION public.reverse_partner_settlement(
  _biz uuid, _line uuid, _date date, _idempotency_key text, _reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_line public.partner_settlement_lines%ROWTYPE;
  v_money public.money_transactions%ROWTYPE;
  v_journal uuid;
  v_money_txn uuid;
  v_reversal_lines jsonb;
BEGIN
  IF NOT public.has_module_access(_biz,'sales','view')
    OR NOT public.has_module_access(_biz,'sales','create')
    OR NOT public.has_biz_role(_biz,ARRAY['owner','manager','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'Only central finance roles can reverse provider settlements.';
  END IF;
  IF _date IS NULL OR _date>current_date
    OR length(trim(COALESCE(_idempotency_key,''))) NOT BETWEEN 1 AND 120
    OR length(trim(COALESCE(_reason,'')))<3 THEN
    RAISE EXCEPTION 'Enter a valid reversal date, unique request key and reason.';
  END IF;
  SELECT * INTO v_line FROM public.partner_settlement_lines
   WHERE business_id=_biz AND id=_line FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Provider settlement not found.'; END IF;
  IF v_line.accounting_status='reversed' THEN
    IF v_line.reversal_idempotency_key=trim(_idempotency_key) THEN
      RETURN jsonb_build_object(
        'line_id',v_line.id,'accounting_status','reversed',
        'money_transaction_id',v_line.reversal_money_transaction_id,
        'journal_entry_id',v_line.reversal_journal_entry_id
      );
    END IF;
    RAISE EXCEPTION 'This provider settlement has already been reversed.';
  END IF;
  IF v_line.accounting_status<>'posted' THEN
    RAISE EXCEPTION 'Only a posted provider settlement can be reversed.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.partner_settlement_lines
     WHERE business_id=_biz AND reversal_idempotency_key=trim(_idempotency_key)
  ) THEN
    RAISE EXCEPTION 'The reversal request key was already used.';
  END IF;
  SELECT * INTO v_money FROM public.money_transactions
   WHERE business_id=_biz AND id=v_line.money_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Posted settlement money transaction not found.'; END IF;
  SELECT COALESCE(jsonb_agg(public.jl(jl.account_id,jl.credit,jl.debit) ORDER BY jl.id),'[]'::jsonb)
    INTO v_reversal_lines
    FROM public.journal_lines jl
   WHERE jl.business_id=_biz AND jl.entry_id=v_line.journal_entry_id;
  IF jsonb_array_length(v_reversal_lines)=0 THEN
    RAISE EXCEPTION 'Posted settlement journal lines not found.';
  END IF;
  v_journal := public.post_journal(
    _biz,_date,'partner_finance_settlement_reversal',v_line.id,
    'Reversal of partner settlement ' || v_line.id || ': ' || trim(_reason),
    v_reversal_lines
  );
  UPDATE public.journal_entries
     SET branch_id=(SELECT branch_id FROM public.journal_entries
                     WHERE business_id=_biz AND id=v_line.journal_entry_id)
   WHERE business_id=_biz AND id=v_journal;
  INSERT INTO public.money_transactions(
    business_id,account_id,branch_id,txn_date,direction,amount,kind,method,
    note,ref_type,ref_id,journal_entry_id,reversal_of
  ) VALUES (
    _biz,v_money.account_id,v_money.branch_id,_date,
    CASE v_money.direction WHEN 'in' THEN 'out' ELSE 'in' END,
    v_money.amount,'partner_finance_settlement_reversal',v_money.method,
    trim(_reason),'partner_finance_settlement_reversal',v_line.id,v_journal,v_money.id
  ) RETURNING id INTO v_money_txn;
  UPDATE public.partner_settlement_lines
     SET accounting_status='reversed',
         reversal_money_transaction_id=v_money_txn,
         reversal_journal_entry_id=v_journal,
         reversal_idempotency_key=trim(_idempotency_key),
         reversed_by=auth.uid(),reversed_at=now()
   WHERE business_id=_biz AND id=v_line.id;
  RETURN jsonb_build_object(
    'line_id',v_line.id,'accounting_status','reversed',
    'money_transaction_id',v_money_txn,'journal_entry_id',v_journal
  );
END $$;

CREATE OR REPLACE FUNCTION public.record_partner_settlement(
  _biz uuid, _provider uuid, _invoice text, _external_reference text,
  _gross numeric, _fee numeric, _adjustment numeric, _net numeric, _paid_on date,
  _note text, _account uuid, _idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch uuid;
  v_line uuid;
  v_status text;
  v_accounting_status text;
BEGIN
  IF NOT public.has_module_access(_biz,'sales','view')
    OR NOT public.has_module_access(_biz,'sales','create')
    OR NOT public.has_biz_role(_biz,ARRAY['owner','manager','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'You do not have permission to reconcile provider settlements.';
  END IF;
  IF length(trim(COALESCE(_idempotency_key,''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'A unique settlement request key is required.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.partner_settlement_lines
     WHERE business_id=_biz AND idempotency_key=trim(_idempotency_key)
  ) THEN
    SELECT id,status,accounting_status INTO v_line,v_status,v_accounting_status
      FROM public.partner_settlement_lines
     WHERE business_id=_biz AND idempotency_key=trim(_idempotency_key);
    RETURN jsonb_build_object(
      'line_id',v_line,'status',v_status,'accounting_status',v_accounting_status
    );
  END IF;
  INSERT INTO public.partner_settlement_batches(business_id,provider_id,source)
  VALUES (_biz,_provider,'manual') RETURNING id INTO v_batch;
  v_status := public._insert_partner_settlement_line(
    _biz,v_batch,_provider,_invoice,_external_reference,_gross,_fee,_adjustment,_net,_paid_on,_note
  );
  SELECT id INTO v_line FROM public.partner_settlement_lines
   WHERE business_id=_biz AND batch_id=v_batch;
  RETURN public.post_partner_settlement(_biz,v_line,_account,_idempotency_key);
END $$;

CREATE OR REPLACE FUNCTION public.partner_finance_customer_options(_biz uuid, _branch uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.has_module_access(_biz,'sales','view') THEN
    RAISE EXCEPTION 'You do not have permission to view Partner Finance customers.';
  END IF;
  IF _branch IS NULL
    AND NOT public.has_biz_role(_biz,ARRAY['owner','manager','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'Select an assigned brand shop to view its Partner Finance customers.';
  END IF;
  IF _branch IS NOT NULL AND NOT public.can_access_partner_finance_branch(_biz,_branch) THEN
    RAISE EXCEPTION 'You do not have access to this brand shop.';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'mobile',c.mobile) ORDER BY c.name),'[]'::jsonb)
    INTO v_result
    FROM public.customers c
   WHERE c.business_id=_biz AND c.status='active'
     AND (
       EXISTS (
         SELECT 1 FROM public.sales s
          WHERE s.business_id=c.business_id AND s.customer_id=c.id
            AND (_branch IS NULL OR s.branch_id=_branch)
       )
       OR (
         NOT EXISTS (
           SELECT 1 FROM public.sales s
            WHERE s.business_id=c.business_id AND s.customer_id=c.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM public.partner_financed_sales pfs
            WHERE pfs.business_id=c.business_id AND pfs.customer_id=c.id
         )
       )
     );
  RETURN v_result;
END $$;

DO $$
DECLARE
  v_definition text := pg_get_functiondef('public.access_rpc_allowed(uuid)'::regprocedure);
BEGIN
  v_definition := replace(
    v_definition,
    'WHEN ''close_day'' THEN ''closing''',
    'WHEN ''close_day'' THEN ''closing'' WHEN ''review_daily_closing'' THEN ''closing'''
  );
  v_definition := replace(
    v_definition,
    'WHEN ''partner_finance_snapshot'' THEN ''sales''',
    'WHEN ''partner_finance_snapshot'' THEN ''sales'' WHEN ''partner_finance_operational_report'' THEN ''sales'' WHEN ''partner_finance_customer_options'' THEN ''sales'' WHEN ''receive_partner_finance_installment'' THEN ''sales'' WHEN ''refund_partner_finance_payment'' THEN ''sales'' WHEN ''refund_partner_finance_downpayment'' THEN ''sales'' WHEN ''waive_partner_finance_installment'' THEN ''sales'' WHEN ''post_partner_settlement'' THEN ''sales'' WHEN ''reverse_partner_settlement'' THEN ''sales'' WHEN ''assign_partner_finance_branch_access'' THEN ''sales'''
  );
  v_definition := replace(
    v_definition,
    '''guardian_snapshot'',''partner_finance_snapshot'',''supplier_aging_report''',
    '''guardian_snapshot'',''partner_finance_snapshot'',''partner_finance_operational_report'',''partner_finance_customer_options'',''supplier_aging_report'''
  );
  v_definition := replace(
    v_definition,
    '''close_day'',''complete_bank_reconciliation''',
    '''close_day'',''review_daily_closing'',''complete_bank_reconciliation'''
  );
  v_definition := replace(
    v_definition,
    '''save_partner_finance_discount_policy'') THEN ''edit''',
    '''save_partner_finance_discount_policy'',''assign_partner_finance_branch_access'') THEN ''edit'''
  );
  v_definition := replace(
    v_definition,
    '''save_partner_finance_discount_policy'') THEN',
    '''save_partner_finance_discount_policy'',''assign_partner_finance_branch_access'') THEN'
  );
  IF position('partner_finance_operational_report' IN v_definition)=0
    OR position('partner_finance_customer_options' IN v_definition)=0
    OR position('receive_partner_finance_installment' IN v_definition)=0
    OR position('refund_partner_finance_payment' IN v_definition)=0
    OR position('refund_partner_finance_downpayment' IN v_definition)=0
    OR position('post_partner_settlement' IN v_definition)=0
    OR position('waive_partner_finance_installment' IN v_definition)=0
    OR position('reverse_partner_settlement' IN v_definition)=0
    OR position('review_daily_closing' IN v_definition)=0
    OR position('assign_partner_finance_branch_access' IN v_definition)=0 THEN
    RAISE EXCEPTION 'Could not register all Partner Finance and closing RPC access rules.';
  END IF;
  EXECUTE v_definition;
END $$;

REVOKE ALL ON FUNCTION public.can_access_partner_finance_branch(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_access_partner_finance_branch(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.can_access_daily_closing_branch(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_access_daily_closing_branch(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.assign_partner_finance_branch_access(uuid,uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assign_partner_finance_branch_access(uuid,uuid,uuid,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.partner_finance_operational_report(uuid,uuid,date,date,uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.partner_finance_operational_report(uuid,uuid,date,date,uuid,uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.partner_finance_customer_options(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.partner_finance_customer_options(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.post_partner_settlement(uuid,uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.post_partner_settlement(uuid,uuid,uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.reverse_partner_settlement(uuid,uuid,date,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reverse_partner_settlement(uuid,uuid,date,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_partner_settlement(uuid,uuid,text,text,numeric,numeric,numeric,numeric,date,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_partner_settlement(uuid,uuid,text,text,numeric,numeric,numeric,numeric,date,text,uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION public.record_partner_settlement(uuid,uuid,text,text,numeric,numeric,numeric,numeric,date,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.review_daily_closing(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_daily_closing(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.close_day(uuid,uuid,uuid,date,numeric,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.close_day(uuid,uuid,uuid,date,numeric,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.partner_finance_snapshot(uuid,uuid) FROM PUBLIC,anon,authenticated;


CREATE OR REPLACE FUNCTION public.receive_partner_finance_installment(
  _biz uuid, _installment uuid, _account uuid, _amount numeric,
  _date date, _idempotency_key text, _remarks text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst public.partner_finance_installments%ROWTYPE;
  v_agreement public.partner_financed_sales%ROWTYPE;
  v_money_ledger uuid;
  v_money_kind public.money_kind;
  v_transaction uuid;
  v_journal uuid;
  v_money_txn uuid;
  v_amount numeric(14,2) := ROUND(COALESCE(_amount,0),2);
  v_existing public.partner_finance_transactions%ROWTYPE;
BEGIN
  IF NOT public.has_module_access(_biz,'sales','view')
    OR NOT public.has_module_access(_biz,'sales','create') THEN
    RAISE EXCEPTION 'You do not have permission to collect Partner Finance installments.';
  END IF;
  IF length(trim(COALESCE(_idempotency_key,''))) NOT BETWEEN 1 AND 120
    OR v_amount <= 0 OR _date IS NULL OR _date > current_date THEN
    RAISE EXCEPTION 'Enter a valid payment amount, date and unique request key.';
  END IF;
  SELECT * INTO v_inst FROM public.partner_finance_installments
   WHERE business_id=_biz AND id=_installment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Installment not found.'; END IF;
  IF NOT public.can_access_partner_finance_branch(_biz,v_inst.branch_id) THEN
    RAISE EXCEPTION 'You do not have access to this brand shop.';
  END IF;
  SELECT * INTO v_agreement FROM public.partner_financed_sales
   WHERE business_id=_biz AND id=v_inst.agreement_id AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active finance agreement not found.'; END IF;
  SELECT * INTO v_existing FROM public.partner_finance_transactions
   WHERE business_id=_biz AND idempotency_key=trim(_idempotency_key);
  IF FOUND THEN
    IF v_existing.event_type='payment'
      AND v_existing.installment_id=_installment
      AND v_existing.amount=v_amount
      AND v_existing.money_account_id=_account THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'The request key was already used for a different transaction.';
  END IF;
  IF v_inst.scheduled_amount-v_inst.paid_amount-v_inst.waived_amount < v_amount THEN
    RAISE EXCEPTION 'Payment exceeds the remaining installment due.';
  END IF;
  SELECT ma.ledger_account_id,ma.kind INTO v_money_ledger,v_money_kind
    FROM public.money_accounts ma
    JOIN public.accounts a ON a.business_id=ma.business_id AND a.id=ma.ledger_account_id
   WHERE ma.business_id=_biz AND ma.id=_account AND ma.status='active'
     AND ma.kind IN ('cash','bank','mfs')
     AND (ma.branch_id IS NULL OR ma.branch_id=v_inst.branch_id)
     AND a.type='asset'
   FOR UPDATE OF ma;
  IF v_money_ledger IS NULL THEN RAISE EXCEPTION 'Select an active cash, bank or MFS account for this shop.'; END IF;

  INSERT INTO public.partner_finance_transactions(
    business_id,agreement_id,installment_id,branch_id,customer_id,event_type,
    amount,transaction_date,money_account_id,idempotency_key,remarks
  ) VALUES (
    _biz,v_inst.agreement_id,v_inst.id,v_inst.branch_id,v_inst.customer_id,'payment',
    v_amount,_date,_account,trim(_idempotency_key),NULLIF(trim(COALESCE(_remarks,'')),'')
  ) RETURNING id INTO v_transaction;

  v_journal := public.post_journal(
    _biz,_date,'partner_finance_installment',v_transaction,'Partner Finance installment receipt',
    jsonb_build_array(
      public.jl(v_money_ledger,v_amount,0),
      public.jl(v_agreement.partner_finance_account_id,0,v_amount)
    )
  );
  UPDATE public.journal_entries SET branch_id=v_inst.branch_id
   WHERE business_id=_biz AND id=v_journal;
  INSERT INTO public.money_transactions(
    business_id,account_id,branch_id,txn_date,direction,amount,kind,method,
    note,ref_type,ref_id,journal_entry_id
  ) VALUES (
    _biz,_account,v_inst.branch_id,_date,'in',v_amount,'partner_finance_installment',
    CASE v_money_kind WHEN 'cash' THEN 'cash'::public.payment_method
      WHEN 'bank' THEN 'bank'::public.payment_method ELSE 'bkash'::public.payment_method END,
    'Installment receipt', 'partner_finance_installment',v_transaction,v_journal
  ) RETURNING id INTO v_money_txn;
  UPDATE public.partner_finance_transactions
     SET journal_entry_id=v_journal,money_transaction_id=v_money_txn
   WHERE business_id=_biz AND id=v_transaction;
  UPDATE public.partner_finance_installments
     SET paid_amount=paid_amount+v_amount
   WHERE business_id=_biz AND id=_installment;
  RETURN v_transaction;
END $$;

CREATE OR REPLACE FUNCTION public.refund_partner_finance_payment(
  _biz uuid, _payment uuid, _account uuid, _amount numeric,
  _date date, _idempotency_key text, _reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_payment public.partner_finance_transactions%ROWTYPE;
  v_agreement public.partner_financed_sales%ROWTYPE;
  v_inst public.partner_finance_installments%ROWTYPE;
  v_money_ledger uuid;
  v_money_kind public.money_kind;
  v_transaction uuid;
  v_journal uuid;
  v_money_txn uuid;
  v_refunded numeric(14,2);
  v_amount numeric(14,2) := ROUND(COALESCE(_amount,0),2);
  v_existing public.partner_finance_transactions%ROWTYPE;
BEGIN
  IF NOT public.has_module_access(_biz,'sales','view')
    OR NOT public.has_module_access(_biz,'sales','create')
    OR NOT public.has_biz_role(_biz,ARRAY['owner','manager','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant with Sales access can refund an installment.';
  END IF;
  IF length(trim(COALESCE(_idempotency_key,''))) NOT BETWEEN 1 AND 120
    OR v_amount <= 0 OR _date IS NULL OR _date > current_date
    OR length(trim(COALESCE(_reason,''))) < 3 THEN
    RAISE EXCEPTION 'Enter a valid refund, date, unique request key and reason.';
  END IF;
  SELECT * INTO v_payment FROM public.partner_finance_transactions
   WHERE business_id=_biz AND id=_payment AND event_type='payment' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Installment payment not found.'; END IF;
  IF NOT public.can_access_partner_finance_branch(_biz,v_payment.branch_id) THEN
    RAISE EXCEPTION 'You do not have access to this brand shop.';
  END IF;
  SELECT * INTO v_existing FROM public.partner_finance_transactions
   WHERE business_id=_biz AND idempotency_key=trim(_idempotency_key);
  IF FOUND THEN
    IF v_existing.event_type='refund' AND v_existing.reversal_of=_payment AND v_existing.amount=v_amount
      AND v_existing.money_account_id=_account THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'The request key was already used for a different transaction.';
  END IF;
  SELECT COALESCE(sum(amount),0) INTO v_refunded
    FROM public.partner_finance_transactions
   WHERE business_id=_biz AND reversal_of=_payment AND event_type='refund';
  IF v_refunded+v_amount > v_payment.amount THEN
    RAISE EXCEPTION 'Refund exceeds the unrefunded payment amount.';
  END IF;
  SELECT * INTO v_inst FROM public.partner_finance_installments
   WHERE business_id=_biz AND id=v_payment.installment_id FOR UPDATE;
  SELECT * INTO v_agreement FROM public.partner_financed_sales
   WHERE business_id=_biz AND id=v_payment.agreement_id;
  SELECT ma.ledger_account_id,ma.kind INTO v_money_ledger,v_money_kind
    FROM public.money_accounts ma
    JOIN public.accounts a ON a.business_id=ma.business_id AND a.id=ma.ledger_account_id
   WHERE ma.business_id=_biz AND ma.id=_account AND ma.status='active'
     AND ma.kind IN ('cash','bank','mfs')
     AND (ma.branch_id IS NULL OR ma.branch_id=v_payment.branch_id)
     AND a.type='asset'
   FOR UPDATE OF ma;
  IF v_money_ledger IS NULL THEN RAISE EXCEPTION 'Select an active refund account for this shop.'; END IF;

  INSERT INTO public.partner_finance_transactions(
    business_id,agreement_id,installment_id,branch_id,customer_id,event_type,
    amount,transaction_date,money_account_id,idempotency_key,reversal_of,remarks
  ) VALUES (
    _biz,v_payment.agreement_id,v_payment.installment_id,v_payment.branch_id,
    v_payment.customer_id,'refund',v_amount,_date,_account,trim(_idempotency_key),
    _payment,trim(_reason)
  ) RETURNING id INTO v_transaction;
  v_journal := public.post_journal(
    _biz,_date,'partner_finance_refund',v_transaction,'Partner Finance installment refund',
    jsonb_build_array(
      public.jl(v_agreement.partner_finance_account_id,v_amount,0),
      public.jl(v_money_ledger,0,v_amount)
    )
  );
  UPDATE public.journal_entries SET branch_id=v_payment.branch_id
   WHERE business_id=_biz AND id=v_journal;
  INSERT INTO public.money_transactions(
    business_id,account_id,branch_id,txn_date,direction,amount,kind,method,
    note,ref_type,ref_id,journal_entry_id
  ) VALUES (
    _biz,_account,v_payment.branch_id,_date,'out',v_amount,'partner_finance_refund',
    CASE v_money_kind WHEN 'cash' THEN 'cash'::public.payment_method
      WHEN 'bank' THEN 'bank'::public.payment_method ELSE 'bkash'::public.payment_method END,
    trim(_reason),'partner_finance_refund',v_transaction,v_journal
  ) RETURNING id INTO v_money_txn;
  UPDATE public.partner_finance_transactions
     SET journal_entry_id=v_journal,money_transaction_id=v_money_txn
   WHERE business_id=_biz AND id=v_transaction;
  UPDATE public.partner_finance_installments
     SET paid_amount=paid_amount-v_amount
   WHERE business_id=_biz AND id=v_payment.installment_id;
  RETURN v_transaction;
END $$;

CREATE OR REPLACE FUNCTION public.waive_partner_finance_installment(
  _biz uuid, _installment uuid, _amount numeric, _date date,
  _idempotency_key text, _reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst public.partner_finance_installments%ROWTYPE;
  v_agreement public.partner_financed_sales%ROWTYPE;
  v_transaction uuid;
  v_journal uuid;
  v_existing public.partner_finance_transactions%ROWTYPE;
  v_amount numeric(14,2) := ROUND(COALESCE(_amount,0),2);
  v_receivable_account uuid;
BEGIN
  IF NOT public.has_module_access(_biz,'sales','view')
    OR NOT public.has_module_access(_biz,'sales','create')
    OR NOT public.has_biz_role(_biz,ARRAY['owner','manager','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'Only an owner, manager or accountant with Sales access can adjust installment dues.';
  END IF;
  IF length(trim(COALESCE(_idempotency_key,''))) NOT BETWEEN 1 AND 120
    OR v_amount <= 0 OR _date IS NULL OR _date > current_date
    OR length(trim(COALESCE(_reason,''))) < 3 THEN
    RAISE EXCEPTION 'Enter a valid adjustment, date, unique request key and reason.';
  END IF;
  SELECT * INTO v_inst FROM public.partner_finance_installments
   WHERE business_id=_biz AND id=_installment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Installment not found.'; END IF;
  IF NOT public.can_access_partner_finance_branch(_biz,v_inst.branch_id) THEN
    RAISE EXCEPTION 'You do not have access to this brand shop.';
  END IF;
  SELECT * INTO v_existing FROM public.partner_finance_transactions
   WHERE business_id=_biz AND idempotency_key=trim(_idempotency_key);
  IF FOUND THEN
    IF v_existing.event_type='waiver' AND v_existing.installment_id=_installment AND v_existing.amount=v_amount THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'The request key was already used for a different transaction.';
  END IF;
  IF v_inst.scheduled_amount-v_inst.paid_amount-v_inst.waived_amount < v_amount THEN
    RAISE EXCEPTION 'Adjustment exceeds the remaining installment due.';
  END IF;
  SELECT pfs.partner_finance_account_id INTO v_receivable_account
    FROM public.partner_financed_sales pfs
   WHERE pfs.business_id=_biz AND pfs.id=v_inst.agreement_id;
  IF v_receivable_account IS NULL OR public.acct(_biz,'6190') IS NULL THEN
    RAISE EXCEPTION 'Configure valid Partner Finance receivable and installment adjustment ledger accounts.';
  END IF;
  INSERT INTO public.partner_finance_transactions(
    business_id,agreement_id,installment_id,branch_id,customer_id,event_type,
    amount,transaction_date,idempotency_key,approved_by,remarks
  ) VALUES (
    _biz,v_inst.agreement_id,v_inst.id,v_inst.branch_id,v_inst.customer_id,'waiver',
    v_amount,_date,trim(_idempotency_key),auth.uid(),trim(_reason)
  ) RETURNING id INTO v_transaction;
  v_journal := public.post_journal(
    _biz,_date,'partner_finance_waiver',v_transaction,'Partner Finance installment adjustment',
    jsonb_build_array(
      public.jl(public.acct(_biz,'6190'),v_amount,0),
      public.jl(v_receivable_account,0,v_amount)
    )
  );
  UPDATE public.journal_entries SET branch_id=v_inst.branch_id
   WHERE business_id=_biz AND id=v_journal;
  UPDATE public.partner_finance_transactions SET journal_entry_id=v_journal
   WHERE business_id=_biz AND id=v_transaction;
  UPDATE public.partner_finance_installments SET waived_amount=waived_amount+v_amount
   WHERE business_id=_biz AND id=_installment;
  RETURN v_transaction;
END $$;

CREATE OR REPLACE FUNCTION public.refund_partner_finance_downpayment(
  _biz uuid, _source_money_transaction uuid, _account uuid, _amount numeric,
  _date date, _idempotency_key text, _reason text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_agreement public.partner_financed_sales%ROWTYPE;
  v_money_ledger uuid;
  v_money_kind public.money_kind;
  v_refunded numeric(14,2);
  v_amount numeric(14,2) := ROUND(COALESCE(_amount,0),2);
  v_transaction uuid;
  v_journal uuid;
  v_money_txn uuid;
  v_existing public.partner_finance_transactions%ROWTYPE;
BEGIN
  IF NOT public.has_module_access(_biz,'sales','view')
    OR NOT public.has_module_access(_biz,'sales','create')
    OR NOT public.has_biz_role(_biz,ARRAY['owner','manager','accountant']::public.member_role[]) THEN
    RAISE EXCEPTION 'Only central finance roles can refund a Partner Finance down payment.';
  END IF;
  IF length(trim(COALESCE(_idempotency_key,''))) NOT BETWEEN 1 AND 120
    OR v_amount<=0 OR _date IS NULL OR _date>current_date
    OR length(trim(COALESCE(_reason,'')))<3 THEN
    RAISE EXCEPTION 'Enter a valid refund amount, date, unique request key and reason.';
  END IF;
  SELECT * INTO v_agreement
    FROM public.partner_financed_sales
   WHERE business_id=_biz AND downpayment_money_transaction_id=_source_money_transaction
   FOR UPDATE;
  IF NOT FOUND OR v_agreement.status<>'active' THEN
    RAISE EXCEPTION 'Active agreement down-payment receipt not found.';
  END IF;
  IF NOT public.can_access_partner_finance_branch(_biz,v_agreement.branch_id) THEN
    RAISE EXCEPTION 'You do not have access to this brand shop.';
  END IF;
  SELECT * INTO v_existing FROM public.partner_finance_transactions
   WHERE business_id=_biz AND idempotency_key=trim(_idempotency_key);
  IF FOUND THEN
    IF v_existing.event_type='downpayment_refund'
      AND v_existing.source_money_transaction_id=_source_money_transaction
      AND v_existing.amount=v_amount AND v_existing.money_account_id=_account THEN
      RETURN v_existing.id;
    END IF;
    RAISE EXCEPTION 'The request key was already used for a different transaction.';
  END IF;
  SELECT COALESCE(sum(amount),0) INTO v_refunded
    FROM public.partner_finance_transactions
   WHERE business_id=_biz AND event_type='downpayment_refund'
     AND source_money_transaction_id=_source_money_transaction;
  IF v_refunded+v_amount>v_agreement.net_downpayment THEN
    RAISE EXCEPTION 'Refund exceeds the unrefunded down-payment collection.';
  END IF;
  SELECT ma.ledger_account_id,ma.kind INTO v_money_ledger,v_money_kind
    FROM public.money_accounts ma
    JOIN public.accounts a ON a.business_id=ma.business_id AND a.id=ma.ledger_account_id
   WHERE ma.business_id=_biz AND ma.id=_account AND ma.status='active'
     AND ma.kind IN ('cash','bank','mfs')
     AND (ma.branch_id IS NULL OR ma.branch_id=v_agreement.branch_id)
     AND a.type='asset'
   FOR UPDATE OF ma;
  IF v_money_ledger IS NULL THEN RAISE EXCEPTION 'Select an active refund account for this shop.'; END IF;
  INSERT INTO public.partner_finance_transactions(
    business_id,agreement_id,installment_id,branch_id,customer_id,event_type,
    amount,transaction_date,money_account_id,source_money_transaction_id,
    idempotency_key,remarks
  ) VALUES (
    _biz,v_agreement.id,NULL,v_agreement.branch_id,v_agreement.customer_id,
    'downpayment_refund',v_amount,_date,_account,_source_money_transaction,
    trim(_idempotency_key),trim(_reason)
  ) RETURNING id INTO v_transaction;
  v_journal := public.post_journal(
    _biz,_date,'partner_finance_refund',v_transaction,'Partner Finance down-payment refund',
    jsonb_build_array(
      public.jl(public.acct(_biz,'1100'),v_amount,0),
      public.jl(v_money_ledger,0,v_amount)
    )
  );
  UPDATE public.journal_entries SET branch_id=v_agreement.branch_id
   WHERE business_id=_biz AND id=v_journal;
  INSERT INTO public.money_transactions(
    business_id,account_id,branch_id,txn_date,direction,amount,kind,method,
    note,ref_type,ref_id,journal_entry_id
  ) VALUES (
    _biz,_account,v_agreement.branch_id,_date,'out',v_amount,'partner_finance_refund',
    CASE v_money_kind WHEN 'cash' THEN 'cash'::public.payment_method
      WHEN 'bank' THEN 'bank'::public.payment_method ELSE 'bkash'::public.payment_method END,
    trim(_reason),'partner_finance_refund',v_transaction,v_journal
  ) RETURNING id INTO v_money_txn;
  UPDATE public.partner_finance_transactions
     SET journal_entry_id=v_journal,money_transaction_id=v_money_txn
   WHERE business_id=_biz AND id=v_transaction;
  RETURN v_transaction;
END $$;

REVOKE ALL ON FUNCTION public.receive_partner_finance_installment(uuid,uuid,uuid,numeric,date,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.receive_partner_finance_installment(uuid,uuid,uuid,numeric,date,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.refund_partner_finance_payment(uuid,uuid,uuid,numeric,date,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.refund_partner_finance_payment(uuid,uuid,uuid,numeric,date,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.refund_partner_finance_downpayment(uuid,uuid,uuid,numeric,date,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.refund_partner_finance_downpayment(uuid,uuid,uuid,numeric,date,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.waive_partner_finance_installment(uuid,uuid,numeric,date,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.waive_partner_finance_installment(uuid,uuid,numeric,date,text,text) TO authenticated;
