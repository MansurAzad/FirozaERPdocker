import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { EntityManager } from "@/components/erp/EntityManager";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useBusiness, useCan } from "@/lib/business";
import { useI18n } from "@/lib/i18n";
import { BD_MOBILE, bdt, friendlyError } from "@/lib/format";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranches } from "@/lib/finance";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/suppliers")({
  head: ({ matches }) => ({
    meta: [
      { title: `Suppliers — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Suppliers records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Suppliers — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Suppliers records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const { t } = useI18n();
  const { role } = useBusiness();
  const canManageSuppliers = useCan("suppliers");
  const canCreateSuppliers = useCan("suppliers", "create");
  const canEditSuppliers = useCan("suppliers", "edit");
  const canDeleteSuppliers = useCan("deleteParty");
  const canExportSuppliers = useCan("suppliers", "export");
  const isCentral = ["owner", "manager", "accountant"].includes(role);
  return (
    <EntityManager
      table="suppliers"
      rowActions={(r) => (
        <>
          <Button asChild size="sm" variant="ghost">
            <Link to="/app/ledger" search={{ kind: "supplier", party: String(r.id) }}>
              Ledger
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/app/purchases/new" search={{ supplier: String(r.id) }}>
              Buy
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/app/supplier-payments" search={{ supplier: String(r.id) }}>
              Pay
            </Link>
          </Button>
        </>
      )}
      title={t("suppliers")}
      sub="Distributors and importers you buy from."
      beforeContent={<SupplierShopAssignments />}
      canWrite={isCentral && canManageSuppliers}
      canCreate={isCentral && canCreateSuppliers}
      canEdit={isCentral && canEditSuppliers}
      canDelete={isCentral && canDeleteSuppliers}
      canExport={canExportSuppliers}
      canImport={isCentral && canCreateSuppliers}
      searchKeys={["name", "company", "mobile"]}
      fields={[
        { key: "name", label: "Name", required: true },
        { key: "company", label: "Company" },
        { key: "contact_person", label: "Contact person" },
        {
          key: "mobile",
          label: "Mobile",
          required: true,
          pattern: BD_MOBILE,
          patternMsg: "Enter a valid Bangladesh mobile number (01XXXXXXXXX).",
          placeholder: "01XXXXXXXXX",
        },
        { key: "opening_payable", label: "Opening payable (৳)", type: "number" },
        { key: "credit_terms_days", label: "Credit terms (days)", type: "number" },
        {
          key: "status",
          label: "Status",
          type: "select",
          options: [
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ],
        },
        { key: "address", label: "Address" },
        { key: "bank_info", label: "Bank information", type: "textarea" },
        { key: "notes", label: "Notes", type: "textarea" },
      ]}
      columns={[
        {
          key: "name",
          label: "Name",
          render: (r) => (
            <div>
              <div className="font-medium">{r.name}</div>
              <div className="text-xs text-muted-foreground">{r.company}</div>
            </div>
          ),
        },
        { key: "mobile", label: "Mobile", className: "num" },
        { key: "credit_terms_days", label: "Terms", render: (r) => `${r.credit_terms_days} days` },
        {
          key: "opening_payable",
          label: t("supplierDue"),
          className: "num text-right",
          render: (r) => bdt(r.opening_payable),
        },
      ]}
    />
  );
}

function SupplierShopAssignments() {
  const { business, role } = useBusiness();
  const canEditSuppliers = useCan("suppliers", "edit");
  const isAdmin = ["owner", "manager"].includes(role) && canEditSuppliers;
  const branches = useBranches(business.id);
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const shops = useMemo(
    () => (branches.data ?? []).filter((branch) => branch.kind === "branch"),
    [branches.data],
  );

  useEffect(() => {
    if (!shops.some((branch) => branch.id === branchId)) {
      setBranchId(shops[0]?.id ?? "");
    }
  }, [branchId, branches.data, shops]);

  const suppliers = useQuery({
    queryKey: ["shop-supplier-options", business.id],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id,name,status")
        .eq("business_id", business.id)
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const assignments = useQuery({
    queryKey: ["supplier-shop-assignments", business.id],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_branch_assignments")
        .select("id,branch_id,supplier_id,is_default,assigned_by,assigned_at")
        .eq("business_id", business.id);
      if (error) throw error;
      return data;
    },
  });
  const assignmentHistory = useQuery({
    queryKey: ["supplier-assignment-audit", business.id, branchId],
    enabled: isAdmin && Boolean(branchId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id,action,user_id,actor_name,created_at,old_value,new_value")
        .eq("business_id", business.id)
        .eq("module", "supplier_branch_assignments")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
  const defaultSupplier = useQuery({
    queryKey: ["default-shop-supplier", business.id],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("default_shop_suppliers")
        .select("supplier_id")
        .eq("business_id", business.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const assign = useMutation({
    mutationFn: async () => {
      if (!branchId || !supplierId) throw new Error("Select a shop and active supplier.");
      const { error } = await supabase.rpc("assign_supplier_to_shop", {
        _biz: business.id,
        _branch: branchId,
        _supplier: supplierId,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Supplier assigned to the shop.");
      await qc.invalidateQueries({ queryKey: ["supplier-shop-assignments", business.id] });
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const setDefault = useMutation({
    mutationFn: async () => {
      if (!supplierId) throw new Error("Select FIROZA ENTERPRISE first.");
      const { error } = await supabase.rpc("set_default_shop_supplier", {
        _biz: business.id,
        _supplier: supplierId,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("FIROZA ENTERPRISE is now the default supplier for every brand shop.");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["default-shop-supplier", business.id] }),
        qc.invalidateQueries({ queryKey: ["supplier-shop-assignments", business.id] }),
        qc.invalidateQueries({ queryKey: ["shop-supplier-assignments", business.id] }),
      ]);
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  if (!isAdmin) return null;
  const supplierById = new Map((suppliers.data ?? []).map((supplier) => [supplier.id, supplier]));
  const assigned = (assignments.data ?? []).filter((item) => item.branch_id === branchId);
  const firoza = (suppliers.data ?? []).filter(
    (supplier) =>
      supplier.status === "active" && supplier.name.trim().toLowerCase() === "firoza enterprise",
  );
  const loadError =
    branches.error ??
    suppliers.error ??
    assignments.error ??
    defaultSupplier.error ??
    assignmentHistory.error;
  const defaultSupplierActive = (suppliers.data ?? []).some(
    (supplier) => supplier.id === defaultSupplier.data?.supplier_id && supplier.status === "active",
  );
  const history = (assignmentHistory.data ?? []).filter((entry) => {
    const oldValue = entry.old_value;
    const newValue = entry.new_value;
    const matches = (value: typeof oldValue) =>
      Boolean(
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        "branch_id" in value &&
        value["branch_id"] === branchId,
      );
    return matches(oldValue) || matches(newValue);
  });

  return (
    <section className="mb-6 space-y-4 rounded-lg border bg-card p-4">
      <div>
        <h2 className="font-semibold">Brand shop supplier assignments</h2>
        <p className="text-sm text-muted-foreground">
          FIROZA ENTERPRISE is assigned as the default supplier. Administrators can add active
          suppliers to individual shops.
        </p>
      </div>
      {loadError && <p className="text-sm text-destructive">{friendlyError(loadError)}</p>}
      {defaultSupplier.isSuccess && !defaultSupplier.data && (
        <p className="text-sm text-destructive">
          No default supplier is configured. Create or activate the FIROZA ENTERPRISE supplier
          record, then configure it here before opening another brand shop.
        </p>
      )}
      {defaultSupplier.isSuccess &&
        defaultSupplier.data &&
        suppliers.data &&
        !defaultSupplierActive && (
          <p className="text-sm text-destructive">
            The configured default supplier is inactive or unavailable. Reactivate that supplier
            before opening shops or posting purchases.
          </p>
        )}
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={branchId}
          onChange={(event) => setBranchId(event.target.value)}
          aria-label="Brand shop"
        >
          <option value="">Select brand shop</option>
          {shops.map((shop) => (
            <option key={shop.id} value={shop.id}>
              {shop.name}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={supplierId}
          onChange={(event) => setSupplierId(event.target.value)}
          aria-label="Active supplier"
        >
          <option value="">Select active supplier</option>
          {(suppliers.data ?? [])
            .filter((supplier) => supplier.status === "active")
            .map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
        </select>
        <Button
          type="button"
          variant="outline"
          disabled={!branchId || !supplierId || assign.isPending}
          onClick={() => assign.mutate()}
        >
          {assign.isPending ? "Assigning…" : "Assign to shop"}
        </Button>
        <Button
          type="button"
          disabled={
            !supplierId ||
            !firoza.some((supplier) => supplier.id === supplierId) ||
            setDefault.isPending
          }
          onClick={() => setDefault.mutate()}
        >
          {setDefault.isPending ? "Saving…" : "Set FIROZA as default"}
        </Button>
      </div>
      {branchId && (
        <ul className="divide-y rounded-md border">
          {assigned.map((item) => {
            const supplier = supplierById.get(item.supplier_id);
            return (
              <li
                key={item.supplier_id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <span>{supplier?.name ?? "Unknown supplier"}</span>
                <span className="text-muted-foreground">
                  {item.is_default ? "Default supplier" : "Assigned supplier"}
                  {supplier?.status === "inactive" ? " · Inactive" : ""}
                  {" · "}
                  {new Date(item.assigned_at).toLocaleString()}
                  {" · "}
                  {item.assigned_by ?? "System"}
                </span>
              </li>
            );
          })}
          {assigned.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              No supplier is assigned to this shop.
            </li>
          )}
          {branchId && (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">Assignment history</summary>
              {assignmentHistory.isPending ? (
                <p className="mt-2 text-sm text-muted-foreground">Loading assignment history…</p>
              ) : history.length ? (
                <ul className="mt-2 divide-y">
                  {history.slice(0, 20).map((entry) => {
                    const values = [entry.new_value, entry.old_value].find(
                      (value) =>
                        value &&
                        typeof value === "object" &&
                        !Array.isArray(value) &&
                        "branch_id" in value &&
                        value["branch_id"] === branchId,
                    );
                    const supplierKey =
                      values && typeof values === "object" && !Array.isArray(values)
                        ? values["supplier_id"]
                        : null;
                    const supplierName =
                      typeof supplierKey === "string"
                        ? (supplierById.get(supplierKey)?.name ?? supplierKey.slice(0, 8))
                        : "Supplier assignment";
                    return (
                      <li
                        key={entry.id}
                        className="flex flex-wrap justify-between gap-2 py-2 text-sm"
                      >
                        <span>
                          {entry.action} · {supplierName}
                        </span>
                        <span className="text-muted-foreground">
                          {entry.actor_name ?? entry.user_id ?? "System"} ·{" "}
                          {new Date(entry.created_at).toLocaleString()}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No assignment history found.</p>
              )}
            </details>
          )}
        </ul>
      )}
    </section>
  );
}
