import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EntityManager } from "@/components/erp/EntityManager";
import { useBusiness, useCan } from "@/lib/business";
import { useI18n } from "@/lib/i18n";
import { BD_MOBILE, bdt, friendlyError } from "@/lib/format";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useBranches } from "@/lib/finance";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/app/customers")({
  head: ({ matches }) => ({
    meta: [
      { title: `Customers — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Customers records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Customers — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Customers records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const TYPES = (
  [
    ["retail", "Retail Customer"],
    ["retail_shop", "Retail Shop"],
    ["wholesale_dealer", "Wholesale Dealer"],
    ["sub_dealer", "Sub Dealer"],
    ["corporate", "Corporate Customer"],
    ["vip", "VIP Customer"],
  ] as [string, string][]
).map(([value, label]) => ({ value, label }));
const LEVELS = (
  [
    ["retail", "Retail Price"],
    ["wholesale", "Wholesale Price"],
    ["dealer", "Dealer Price"],
    ["special", "Special Price"],
  ] as [string, string][]
).map(([value, label]) => ({ value, label }));
const label = (arr: { value: string; label: string }[], v: string) =>
  arr.find((x) => x.value === v)?.label ?? v;

type CustomerDetail = {
  id: string;
  name: string;
  mobile: string;
  openingBalance: number;
  currentDue: number;
};
type CustomerFinanceHistory = {
  sales: {
    id: string;
    invoice_no: string;
    sale_date: string;
    sale_price: number;
    provider_name: string;
    status: string;
  }[];
  transactions: {
    id: string;
    event_type: string;
    amount: number;
    transaction_date: string;
    status: string;
  }[];
};

function Page() {
  const { t } = useI18n();
  const { business, role, userId } = useBusiness();
  const qc = useQueryClient();
  const branches = useBranches(business.id);
  const isCentral = ["owner", "manager", "accountant"].includes(role);
  const canManageCustomers = useCan("customers");
  const canCreateCustomers = useCan("customers", "create");
  const canEditCustomers = useCan("customers", "edit");
  const canDeleteCustomers = useCan("deleteParty");
  const canExportCustomers = useCan("customers", "export");
  const branchAccess = useQuery({
    queryKey: ["customer-branch-access", business.id, userId],
    enabled: !isCentral,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_finance_branch_access")
        .select("branch_id")
        .eq("business_id", business.id)
        .eq("user_id", userId);
      if (error) throw error;
      return data.map((entry) => entry.branch_id);
    },
  });
  const accessibleBranches = (branches.data ?? []).filter(
    (branch) =>
      branch.kind === "branch" && (isCentral || (branchAccess.data ?? []).includes(branch.id)),
  );
  const [shopId, setShopId] = useState("");
  const [viewAll, setViewAll] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetail | null>(null);
  useEffect(() => {
    if (!accessibleBranches.some((branch) => branch.id === shopId)) {
      setShopId(accessibleBranches[0]?.id ?? "");
    }
  }, [accessibleBranches, shopId]);
  const assignmentQuery = useQuery({
    queryKey: ["customer-assignments", business.id, userId, isCentral],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_branch_assignments")
        .select("customer_id,branch_id")
        .eq("business_id", business.id);
      if (error) throw error;
      return data;
    },
  });
  const assign = useMutation({
    mutationFn: async (customerId: string) => {
      if (!shopId) throw new Error("Select a shop first.");
      const { error } = await supabase.rpc("assign_customer_to_branch", {
        _biz: business.id,
        _customer: customerId,
        _branch: shopId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Customer assigned to the shop.");
      void qc.invalidateQueries({ queryKey: ["customer-assignments", business.id] });
      void qc.invalidateQueries();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const customerFinanceHistory = useQuery({
    enabled: Boolean(selectedCustomer && shopId),
    queryKey: ["customer-finance-history", business.id, shopId, selectedCustomer?.id],
    queryFn: async (): Promise<CustomerFinanceHistory> => {
      if (!selectedCustomer || !shopId) throw new Error("Select a customer and shop.");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("partner_finance_operational_report", {
        _biz: business.id,
        _provider: null,
        _from: null,
        _to: null,
        _branch: shopId,
        _customer: selectedCustomer.id,
        _status: null,
        _transaction_type: null,
      });
      if (error) throw error;
      return {
        sales: (data?.sales ?? []) as CustomerFinanceHistory["sales"],
        transactions: (data?.transactions ?? []) as CustomerFinanceHistory["transactions"],
      };
    },
  });
  const customerPayments = useQuery({
    enabled: Boolean(selectedCustomer && shopId),
    queryKey: ["customer-payment-history", business.id, shopId, selectedCustomer?.id],
    queryFn: async () => {
      if (!selectedCustomer || !shopId) throw new Error("Select a customer and shop.");
      const { data, error } = await supabase
        .from("customer_payments")
        .select("id,paid_on,amount,method,txn_ref")
        .eq("business_id", business.id)
        .eq("branch_id", shopId)
        .eq("customer_id", selectedCustomer.id)
        .order("paid_on", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });
  return (
    <>
      <EntityManager
        table="customers"
        rowActions={(r) => (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setSelectedCustomer({
                  id: String(r.id),
                  name: String(r.name ?? ""),
                  mobile: String(r.mobile ?? ""),
                  openingBalance: Number(r.opening_balance ?? 0),
                  currentDue: Number(r["current_due"] ?? 0),
                })
              }
            >
              Details
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link
                to="/app/ledger"
                search={{ kind: "customer", party: String(r.id), branch: shopId || undefined }}
              >
                Ledger
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link
                to="/app/sales/new"
                search={{ customer: String(r.id), branch: shopId || undefined }}
              >
                Sell
              </Link>
            </Button>
            <Button asChild size="sm" variant="ghost">
              <Link to="/app/due-collection">Collect</Link>
            </Button>
            {isCentral &&
              shopId &&
              !(assignmentQuery.data ?? []).some(
                (assignment) => assignment.customer_id === r.id && assignment.branch_id === shopId,
              ) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={assign.isPending}
                  onClick={() => r.id && assign.mutate(r.id)}
                >
                  {assign.isPending ? "Assigning…" : "Assign to shop"}
                </Button>
              )}
          </>
        )}
        title={t("customers")}
        sub="Retail customers, shops and dealers with price level and credit limit."
        canWrite={canManageCustomers && Boolean(shopId)}
        canCreate={canCreateCustomers && Boolean(shopId)}
        canEdit={isCentral && canEditCustomers}
        canDelete={isCentral && canDeleteCustomers}
        canExport={canExportCustomers}
        canImport={canCreateCustomers && Boolean(shopId)}
        branchFilterId={viewAll && isCentral ? null : shopId}
        filterByBranchAssignment
        createOnlyFields={["opening_balance"]}
        createRecord={async (row) => {
          if (!shopId) throw new Error("Select a shop before creating a customer.");
          const payload: Json = Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key, value ?? null]),
          );
          const { error } = await supabase.rpc("create_customer_for_branch", {
            _biz: business.id,
            _branch: shopId,
            _data: payload,
          });
          if (error) throw error;
        }}
        enrichRows={async (rows) => {
          const balancesQuery =
            viewAll && isCentral
              ? supabase
                  .from("customer_balances")
                  .select("customer_id,current_due,opening_balance")
                  .eq("business_id", business.id)
              : supabase
                  .from("customer_branch_balances")
                  .select("customer_id,current_due,opening_balance")
                  .eq("business_id", business.id)
                  .eq("branch_id", shopId);
          const { data, error } = await balancesQuery;
          if (error) throw error;
          const balancesByCustomer = new Map(data.map((balance) => [balance.customer_id, balance]));
          return rows.map((row) => ({
            ...row,
            opening_balance: row.id ? (balancesByCustomer.get(row.id)?.opening_balance ?? 0) : 0,
            current_due: row.id ? (balancesByCustomer.get(row.id)?.current_due ?? 0) : 0,
          }));
        }}
        beforeContent={
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
            <label className="flex items-center gap-2 text-sm">
              <span>Shop for new customers</span>
              <select
                className="h-9 rounded-md border border-input bg-background px-3"
                value={shopId}
                onChange={(event) => setShopId(event.target.value)}
              >
                {accessibleBranches.length === 0 && <option value="">No assigned shop</option>}
                {accessibleBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            {isCentral && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={viewAll}
                  onChange={(event) => setViewAll(event.target.checked)}
                />
                View all customers
              </label>
            )}
            {(branches.error || branchAccess.error) && (
              <p className="text-sm text-destructive">
                {friendlyError(branches.error ?? branchAccess.error)}
              </p>
            )}
          </div>
        }
        searchKeys={["name", "business_name", "mobile"]}
        fields={[
          { key: "name", label: "Name", required: true },
          { key: "business_name", label: "Business name" },
          {
            key: "mobile",
            label: "Mobile",
            required: true,
            pattern: BD_MOBILE,
            patternMsg: "Enter a valid Bangladesh mobile number (01XXXXXXXXX).",
            placeholder: "01XXXXXXXXX",
          },
          {
            key: "alt_mobile",
            label: "Alternative mobile",
            pattern: BD_MOBILE,
            patternMsg: "Invalid alternative mobile.",
          },
          { key: "type", label: "Customer type", type: "select", options: TYPES },
          { key: "price_level", label: "Default price level", type: "select", options: LEVELS },
          { key: "credit_limit", label: "Credit limit (৳)", type: "number" },
          { key: "payment_terms_days", label: "Payment terms (days)", type: "number" },
          { key: "opening_balance", label: "Shop opening due (৳)", type: "number" },
          { key: "nid", label: "NID" },
          { key: "trade_license", label: "Trade license" },
          {
            key: "status",
            label: "Status",
            type: "select",
            options: [
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ],
          },
          { key: "address", label: "Address", full: true },
          { key: "notes", label: "Notes", type: "textarea" },
        ]}
        columns={[
          {
            key: "name",
            label: "Name",
            render: (r) => (
              <div>
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground">{r.business_name}</div>
              </div>
            ),
          },
          { key: "mobile", label: "Mobile", className: "num" },
          {
            key: "type",
            label: "Type",
            render: (r) => <Badge variant="secondary">{label(TYPES, r.type ?? "")}</Badge>,
          },
          {
            key: "price_level",
            label: "Price level",
            render: (r) => label(LEVELS, r.price_level ?? ""),
          },
          {
            key: "credit_limit",
            label: "Credit limit",
            className: "num text-right",
            render: (r) => bdt(r.credit_limit),
          },
          {
            key: "current_due",
            label: t("customerDue"),
            className: "num text-right",
            render: (r) => bdt(Number(r["current_due"] ?? 0)),
          },
        ]}
      />
      <Dialog
        open={Boolean(selectedCustomer)}
        onOpenChange={(open) => {
          if (!open) setSelectedCustomer(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedCustomer?.name || "Customer details"}</DialogTitle>
            <DialogDescription>
              {selectedCustomer?.mobile} ·{" "}
              {accessibleBranches.find((branch) => branch.id === shopId)?.name ?? "Selected shop"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border p-3">
              <div className="text-sm text-muted-foreground">Outstanding balance</div>
              <div className="num mt-1 font-semibold">{bdt(selectedCustomer?.currentDue ?? 0)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-sm text-muted-foreground">Shop opening due</div>
              <div className="num mt-1 font-semibold">
                {bdt(selectedCustomer?.openingBalance ?? 0)}
              </div>
            </div>
          </div>
          <div>
            <h3 className="mb-2 font-medium">Shop assignment status</h3>
            {assignmentQuery.isPending ? (
              <span className="text-sm text-muted-foreground">Checking shop assignment…</span>
            ) : assignmentQuery.error ? (
              <span className="text-sm text-destructive">
                Could not verify assignment: {friendlyError(assignmentQuery.error)}
              </span>
            ) : (
              <Badge variant="secondary">
                {(assignmentQuery.data ?? []).some(
                  (assignment) =>
                    assignment.customer_id === selectedCustomer?.id &&
                    assignment.branch_id === shopId,
                )
                  ? "Assigned to selected shop"
                  : "Not assigned to selected shop"}
              </Badge>
            )}
          </div>
          {selectedCustomer && shopId && (
            <Button asChild variant="outline">
              <Link
                to="/app/ledger"
                search={{ kind: "customer", party: selectedCustomer.id, branch: shopId }}
              >
                Open shop customer ledger
              </Link>
            </Button>
          )}
          <section>
            <h3 className="mb-2 font-medium">Partner Finance agreement history</h3>
            {customerFinanceHistory.isPending ? (
              <p className="text-sm text-muted-foreground">Loading agreements…</p>
            ) : customerFinanceHistory.error ? (
              <p className="text-sm text-destructive">
                {friendlyError(customerFinanceHistory.error)}
              </p>
            ) : customerFinanceHistory.data?.sales.length ? (
              <ul className="divide-y rounded-md border">
                {customerFinanceHistory.data.sales.map((sale) => (
                  <li key={sale.id} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
                    <span>
                      {sale.invoice_no} · {sale.provider_name} · {sale.sale_date}
                    </span>
                    <span className="num">{bdt(Number(sale.sale_price))}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No Partner Finance agreements.</p>
            )}
          </section>
          <section>
            <h3 className="mb-2 font-medium">Payment history</h3>
            {customerPayments.isPending ? (
              <p className="text-sm text-muted-foreground">Loading payments…</p>
            ) : customerPayments.error ? (
              <p className="text-sm text-destructive">{friendlyError(customerPayments.error)}</p>
            ) : customerPayments.data?.length ? (
              <ul className="divide-y rounded-md border">
                {customerPayments.data.map((payment) => (
                  <li key={payment.id} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
                    <span>
                      {payment.paid_on} · {payment.method} · {payment.txn_ref ?? "—"}
                    </span>
                    <span className="num">{bdt(Number(payment.amount))}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No customer payments for this shop.</p>
            )}
            {!!customerFinanceHistory.data?.transactions.length && (
              <div className="mt-2">
                <h4 className="mb-2 text-sm font-medium">Partner Finance payments & adjustments</h4>
                <ul className="divide-y rounded-md border">
                  {customerFinanceHistory.data.transactions.map((transaction) => (
                    <li
                      key={transaction.id}
                      className="flex flex-wrap justify-between gap-2 p-3 text-sm"
                    >
                      <span>
                        {transaction.transaction_date} ·{" "}
                        {transaction.event_type.replaceAll("_", " ")}
                      </span>
                      <span className="num">{bdt(Number(transaction.amount))}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </DialogContent>
      </Dialog>
    </>
  );
}
