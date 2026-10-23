DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.suppliers
     WHERE lower(btrim(name)) = 'firoza enterprise'
     GROUP BY business_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate FIROZA ENTERPRISE supplier records exist; resolve them before applying this migration.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'suppliers_business_id_id_unique'
       AND conrelid = 'public.suppliers'::regclass
  ) THEN
    ALTER TABLE public.suppliers
      ADD CONSTRAINT suppliers_business_id_id_unique UNIQUE (business_id, id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_unique_firoza_enterprise
  ON public.suppliers (business_id, lower(btrim(name)))
  WHERE lower(btrim(name)) = 'firoza enterprise';

CREATE TABLE IF NOT EXISTS public.default_shop_suppliers (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL,
  configured_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, supplier_id)
    REFERENCES public.suppliers(business_id, id) ON DELETE RESTRICT
);

DROP TRIGGER IF EXISTS audit_default_shop_suppliers ON public.default_shop_suppliers;
CREATE TRIGGER audit_default_shop_suppliers
  AFTER INSERT OR UPDATE OR DELETE ON public.default_shop_suppliers
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

ALTER TABLE public.default_shop_suppliers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS default_shop_suppliers_read ON public.default_shop_suppliers;
CREATE POLICY default_shop_suppliers_read
  ON public.default_shop_suppliers
  FOR SELECT TO authenticated
  USING (
    public.is_member(business_id)
    AND public.has_biz_role(business_id, ARRAY['owner','manager']::public.member_role[])
    AND public.has_module_access(business_id, 'suppliers', 'view')
  );
GRANT SELECT ON public.default_shop_suppliers TO authenticated;
REVOKE ALL ON public.default_shop_suppliers FROM PUBLIC, anon;
REVOKE ALL ON public.default_shop_suppliers FROM authenticated;
GRANT SELECT ON public.default_shop_suppliers TO authenticated;

CREATE TABLE IF NOT EXISTS public.supplier_branch_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  assigned_by uuid DEFAULT auth.uid(),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, branch_id, supplier_id),
  FOREIGN KEY (business_id, branch_id)
    REFERENCES public.branches(business_id, id) ON DELETE CASCADE,
  FOREIGN KEY (business_id, supplier_id)
    REFERENCES public.suppliers(business_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_branch_one_default
  ON public.supplier_branch_assignments (business_id, branch_id)
  WHERE is_default;
CREATE INDEX IF NOT EXISTS supplier_branch_assignments_supplier_idx
  ON public.supplier_branch_assignments (business_id, supplier_id);

DROP TRIGGER IF EXISTS audit_supplier_branch_assignments ON public.supplier_branch_assignments;
CREATE TRIGGER audit_supplier_branch_assignments
  AFTER INSERT OR UPDATE OR DELETE ON public.supplier_branch_assignments
  FOR EACH ROW EXECUTE FUNCTION public.audit_row();

DROP POLICY IF EXISTS "purchase staff write suppliers" ON public.suppliers;
DROP POLICY IF EXISTS suppliers_write_central ON public.suppliers;
CREATE POLICY suppliers_write_central
  ON public.suppliers
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
    AND public.has_module_access(business_id, 'suppliers', 'create')
  );
DROP POLICY IF EXISTS "purchase staff update suppliers" ON public.suppliers;
DROP POLICY IF EXISTS suppliers_update_central ON public.suppliers;
CREATE POLICY suppliers_update_central
  ON public.suppliers
  FOR UPDATE TO authenticated
  USING (
    public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
    AND public.has_module_access(business_id, 'suppliers', 'edit')
  )
  WITH CHECK (
    public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
    AND public.has_module_access(business_id, 'suppliers', 'edit')
  );
DROP POLICY IF EXISTS "admins delete suppliers" ON public.suppliers;
DROP POLICY IF EXISTS suppliers_delete_central ON public.suppliers;
CREATE POLICY suppliers_delete_central
  ON public.suppliers
  FOR DELETE TO authenticated
  USING (
    public.has_biz_role(business_id, ARRAY['owner','manager']::public.member_role[])
    AND public.has_module_access(business_id, 'suppliers', 'delete')
  );

ALTER TABLE public.supplier_branch_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_branch_assignments_read ON public.supplier_branch_assignments;
CREATE POLICY supplier_branch_assignments_read
  ON public.supplier_branch_assignments
  FOR SELECT TO authenticated
  USING (
    public.is_member(business_id)
    AND public.has_module_access(business_id, 'suppliers', 'view')
    AND (
      public.has_biz_role(business_id, ARRAY['owner','manager','accountant']::public.member_role[])
      OR EXISTS (
        SELECT 1 FROM public.partner_finance_branch_access a
         WHERE a.business_id = supplier_branch_assignments.business_id
           AND a.user_id = auth.uid()
           AND a.branch_id = supplier_branch_assignments.branch_id
      )
    )
  );
GRANT SELECT ON public.supplier_branch_assignments TO authenticated;
REVOKE ALL ON public.supplier_branch_assignments FROM PUBLIC, anon;
REVOKE ALL ON public.supplier_branch_assignments FROM authenticated;
GRANT SELECT ON public.supplier_branch_assignments TO authenticated;

INSERT INTO public.default_shop_suppliers (business_id, supplier_id)
SELECT s.business_id, s.id
  FROM public.suppliers s
 WHERE lower(btrim(s.name)) = 'firoza enterprise'
   AND s.status = 'active'
ON CONFLICT (business_id) DO NOTHING;

INSERT INTO public.supplier_branch_assignments (
  business_id, branch_id, supplier_id, is_default, assigned_by
)
SELECT b.business_id, b.id, d.supplier_id, true, d.configured_by
  FROM public.branches b
  JOIN public.default_shop_suppliers d ON d.business_id = b.business_id
 WHERE b.kind = 'branch'
ON CONFLICT (business_id, branch_id, supplier_id) DO NOTHING;

UPDATE public.supplier_branch_assignments a
   SET is_default = true
  FROM public.default_shop_suppliers d
 WHERE a.business_id = d.business_id
   AND a.supplier_id = d.supplier_id
   AND NOT EXISTS (
     SELECT 1 FROM public.supplier_branch_assignments current_default
      WHERE current_default.business_id = a.business_id
        AND current_default.branch_id = a.branch_id
        AND current_default.is_default
   );

CREATE OR REPLACE FUNCTION public.assign_supplier_to_shop(
  _biz uuid, _branch uuid, _supplier uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager']::public.member_role[])
    OR NOT public.has_module_access(_biz, 'suppliers', 'edit') THEN
    RAISE EXCEPTION 'Only an authorized administrator can assign suppliers to a shop.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches
     WHERE business_id = _biz AND id = _branch AND kind = 'branch'
  ) THEN
    RAISE EXCEPTION 'Select a valid brand shop.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers
     WHERE business_id = _biz AND id = _supplier AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Select an existing active supplier.';
  END IF;

  INSERT INTO public.supplier_branch_assignments (
    business_id, branch_id, supplier_id, is_default, assigned_by
  ) VALUES (_biz, _branch, _supplier, false, auth.uid())
  ON CONFLICT (business_id, branch_id, supplier_id) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.set_default_shop_supplier(
  _biz uuid, _supplier uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_biz_role(_biz, ARRAY['owner','manager']::public.member_role[])
    OR NOT public.has_module_access(_biz, 'suppliers', 'edit') THEN
    RAISE EXCEPTION 'Only an authorized administrator can configure the default shop supplier.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers
     WHERE business_id = _biz
       AND id = _supplier
       AND status = 'active'
       AND lower(btrim(name)) = 'firoza enterprise'
  ) THEN
    RAISE EXCEPTION 'The default supplier must be an active FIROZA ENTERPRISE supplier record.';
  END IF;

  INSERT INTO public.default_shop_suppliers (business_id, supplier_id, configured_by, updated_at)
  VALUES (_biz, _supplier, auth.uid(), now())
  ON CONFLICT (business_id) DO UPDATE
    SET supplier_id = EXCLUDED.supplier_id,
        configured_by = EXCLUDED.configured_by,
        updated_at = EXCLUDED.updated_at;

  UPDATE public.supplier_branch_assignments
     SET is_default = false
   WHERE business_id = _biz AND is_default;

  INSERT INTO public.supplier_branch_assignments (
    business_id, branch_id, supplier_id, is_default, assigned_by, assigned_at
  )
  SELECT _biz, b.id, _supplier, true, auth.uid(), now()
    FROM public.branches b
   WHERE b.business_id = _biz AND b.kind = 'branch'
  ON CONFLICT (business_id, branch_id, supplier_id)
  DO UPDATE SET is_default = true, assigned_by = auth.uid(), assigned_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.assign_default_supplier_on_shop_create()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_supplier uuid;
BEGIN
  IF NEW.kind <> 'branch' THEN
    RETURN NEW;
  END IF;

  SELECT d.supplier_id INTO v_supplier
    FROM public.default_shop_suppliers d
    JOIN public.suppliers s
      ON s.business_id = d.business_id AND s.id = d.supplier_id
   WHERE d.business_id = NEW.business_id AND s.status = 'active';
  IF v_supplier IS NULL THEN
    RAISE EXCEPTION 'Configure an active FIROZA ENTERPRISE default supplier before creating a brand shop.';
  END IF;

  UPDATE public.supplier_branch_assignments
     SET is_default = false
   WHERE business_id = NEW.business_id
     AND branch_id = NEW.id
     AND is_default
     AND supplier_id <> v_supplier;

  INSERT INTO public.supplier_branch_assignments (
    business_id, branch_id, supplier_id, is_default, assigned_by
  ) VALUES (NEW.business_id, NEW.id, v_supplier, true, auth.uid())
  ON CONFLICT (business_id, branch_id, supplier_id)
  DO UPDATE SET is_default = true, assigned_by = auth.uid(), assigned_at = now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.protect_firoza_enterprise_supplier_identity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF lower(btrim(NEW.name)) = 'firoza enterprise'
    AND EXISTS (
      SELECT 1 FROM public.default_shop_suppliers d
       WHERE d.business_id = NEW.business_id
         AND d.supplier_id <> NEW.id
    ) THEN
    RAISE EXCEPTION 'FIROZA ENTERPRISE is already configured for this business under a different supplier ID.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS protect_firoza_enterprise_supplier_identity ON public.suppliers;
CREATE TRIGGER protect_firoza_enterprise_supplier_identity
  BEFORE INSERT OR UPDATE OF name, business_id ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.protect_firoza_enterprise_supplier_identity();

CREATE OR REPLACE FUNCTION public.validate_purchase_order_receiving_supplier()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.purchase_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order
    FROM public.purchase_orders
   WHERE business_id = NEW.business_id AND id = NEW.po_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase order not found.'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers s
     WHERE s.business_id = v_order.business_id
       AND s.id = v_order.supplier_id
       AND s.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Purchase order supplier is unavailable or inactive.';
  END IF;
  PERFORM public.validate_shop_purchase_supplier_row(
    v_order.business_id, v_order.branch_id, v_order.supplier_id
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS assign_default_supplier_on_shop_create ON public.branches;
CREATE TRIGGER assign_default_supplier_on_shop_create
  AFTER INSERT OR UPDATE OF kind ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.assign_default_supplier_on_shop_create();

CREATE OR REPLACE FUNCTION public.validate_shop_purchase_supplier()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kind public.branch_kind;
BEGIN
  SELECT kind INTO v_kind
    FROM public.branches
   WHERE business_id = NEW.business_id AND id = NEW.branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase branch is invalid.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers
     WHERE business_id = NEW.business_id
       AND id = NEW.supplier_id
       AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Select an existing active supplier for this purchase.';
  END IF;

  IF v_kind = 'branch' AND NOT EXISTS (
    SELECT 1
      FROM public.supplier_branch_assignments a
      JOIN public.suppliers s
        ON s.business_id = a.business_id AND s.id = a.supplier_id
     WHERE a.business_id = NEW.business_id
       AND a.branch_id = NEW.branch_id
       AND a.supplier_id = NEW.supplier_id
       AND s.status = 'active'
  ) THEN
    RAISE EXCEPTION 'The selected supplier is not actively assigned to this brand shop.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_purchase_supplier_assignment ON public.purchases;
CREATE TRIGGER validate_purchase_supplier_assignment
  BEFORE INSERT OR UPDATE OF business_id, branch_id, supplier_id ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.validate_shop_purchase_supplier();
DROP TRIGGER IF EXISTS validate_purchase_order_supplier_assignment ON public.purchase_orders;
CREATE TRIGGER validate_purchase_order_supplier_assignment
  BEFORE INSERT OR UPDATE OF business_id, branch_id, supplier_id ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.validate_shop_purchase_supplier();

CREATE OR REPLACE FUNCTION public.validate_shop_purchase_supplier_row(
  _biz uuid, _branch uuid, _supplier uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_kind public.branch_kind;
BEGIN
  SELECT kind INTO v_kind FROM public.branches
   WHERE business_id = _biz AND id = _branch;
  IF NOT FOUND THEN RAISE EXCEPTION 'Purchase branch is invalid.'; END IF;
  IF v_kind = 'branch' AND NOT EXISTS (
    SELECT 1
      FROM public.supplier_branch_assignments a
      JOIN public.suppliers s
        ON s.business_id = a.business_id AND s.id = a.supplier_id
     WHERE a.business_id = _biz AND a.branch_id = _branch
       AND a.supplier_id = _supplier AND s.status = 'active'
  ) THEN
    RAISE EXCEPTION 'The purchase order supplier is not actively assigned to this brand shop.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS validate_purchase_order_receiving_supplier ON public.purchase_order_items;
CREATE TRIGGER validate_purchase_order_receiving_supplier
  BEFORE UPDATE OF received_qty ON public.purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_purchase_order_receiving_supplier();

DO $$
DECLARE
  v_definition text := pg_get_functiondef('public.access_rpc_allowed(uuid)'::regprocedure);
  v_updated text;
BEGIN
  v_updated := v_definition;
  IF position($find$WHEN 'assign_supplier_to_shop' THEN 'suppliers'$find$ IN v_updated) = 0 THEN
    v_updated := replace(
      v_updated,
      $find$WHEN 'create_purchase' THEN 'purchases'$find$,
      $replace$WHEN 'assign_supplier_to_shop' THEN 'suppliers'
      WHEN 'set_default_shop_supplier' THEN 'suppliers'
      WHEN 'create_purchase' THEN 'purchases'$replace$
    );
  END IF;
  IF position(
    $find$'assign_supplier_to_shop','set_default_shop_supplier'$find$ IN v_updated
  ) = 0 THEN
    v_updated := regexp_replace(
      v_updated,
      $pattern$'resume_guardian_ai'[[:space:]]*,[[:space:]]*'set_order_delivery'$pattern$,
      $replacement$'resume_guardian_ai','set_order_delivery','assign_supplier_to_shop','set_default_shop_supplier'$replacement$,
      'g'
    );
  END IF;
  IF position($find$WHEN 'assign_supplier_to_shop' THEN 'suppliers'$find$ IN v_updated) = 0
    OR position($find$'assign_supplier_to_shop','set_default_shop_supplier'$find$ IN v_updated) = 0 THEN
    RAISE EXCEPTION 'Could not extend supplier RPC access mapping.';
  END IF;
  IF v_updated <> v_definition THEN EXECUTE v_updated; END IF;
END $$;

REVOKE ALL ON FUNCTION public.assign_supplier_to_shop(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_default_shop_supplier(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_default_supplier_on_shop_create() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_shop_purchase_supplier() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_shop_purchase_supplier_row(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_purchase_order_receiving_supplier()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_firoza_enterprise_supplier_identity()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_supplier_to_shop(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_default_shop_supplier(uuid, uuid) TO authenticated;
