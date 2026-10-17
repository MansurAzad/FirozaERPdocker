import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { useMoneyAccounts } from "@/lib/finance";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, METHODS, Stat, methodLabel, selectCls, today, type Method } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ExcelDataTools,
  type ExcelColumn,
  type ExcelRecord,
} from "@/components/erp/ExcelDataTools";
import { hasAccess } from "@/lib/access-control";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/app/dealers")({
  head: ({ matches }) => ({
    meta: [
      { title: `Dealers — ${matchedCompany(matches)}` },
      {
        title: `Dealer & Sub-dealer Management — ${matchedCompany(matches)}`,
        description: "Manage dealer and sub-dealer credit limits, outstanding dues and payments.",
      },
      {
        property: "og:description",
        content: "Dealer credit limits, outstanding dues and collections.",
      },
      { property: "og:type", content: "website" },
      { property: "twitter:card", content: "summary" },
    ],
  }),
  component: Dealers,
});

const DEALER_TYPES = ["wholesale_dealer", "sub_dealer", "dealer"] as const;
const TYPE_LABEL: Record<string, string> = {
  wholesale_dealer: "Wholesale dealer",
  sub_dealer: "Sub dealer",
  dealer: "Dealer",
};
const DEALER_STATUS = [
  { value: "active", label: "Active" },
  { value: "blocked", label: "Blocked" },
  { value: "suspended", label: "Suspended" },
];

function Dealers() {
  const { business, role, access } = useBusiness();
  const qc = useQueryClient();
  const canEdit = role === "owner" || role === "manager" || role === "accountant";
  const canCollect = canEdit || role === "salesman" || role === "branch_manager";
  const accounts = useMoneyAccounts(business.id);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"dealers" | "payments">("dealers");
  const [credit, setCredit] = useState<{ id: string; name: string } | null>(null);
  const [selectedDealer, setSelectedDealer] = useState<(typeof rows)[number] | null>(null);
  const [cf, setCf] = useState<Record<string, string>>({});
  const [pay, setPay] = useState<{ id: string; name: string; due: number } | null>(null);
  const [pf, setPf] = useState<Record<string, string>>({});

  const balances = useQuery({
    queryKey: ["dealer-balances", business.id],
    queryFn: async () => {
      const all = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase
          .from("customer_balances")
          .select("*")
          .eq("business_id", business.id)
          .in("type", [...DEALER_TYPES])
          .order("name")
          .order("customer_id", { ascending: true })
          .range(offset, offset + 999);
        if (error) throw error;
        all.push(...data);
        if (data.length < 1000) return all;
      }
    },
  });

  const credits = useQuery({
    queryKey: ["dealer-credit", business.id],
    queryFn: async () => {
      const all = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase
          .from("dealer_credit")
          .select("*")
          .eq("business_id", business.id)
          .order("customer_id", { ascending: true })
          .range(offset, offset + 999);
        if (error) throw error;
        all.push(...data);
        if (data.length < 1000) return all;
      }
    },
  });
  const creditRows = credits.data;
  const dealerCustomers = useQuery({
    queryKey: ["dealer-customer-details", business.id],
    enabled: hasAccess(access, "customers", "export"),
    queryFn: async () => {
      const all = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase
          .from("customers")
          .select("*")
          .eq("business_id", business.id)
          .in("type", [...DEALER_TYPES])
          .order("name")
          .order("id", { ascending: true })
          .range(offset, offset + 999);
        if (error) throw error;
        all.push(...data);
        if (data.length < 1000) return all;
      }
    },
  });

  const dealerIds = useMemo(
    () => (balances.data ?? []).map((b) => b.customer_id).filter((x): x is string => !!x),
    [balances.data],
  );

  const payments = useQuery({
    queryKey: ["dealer-payments", business.id, dealerIds.length],
    enabled: dealerIds.length > 0,
    queryFn: async () => {
      const all = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase
          .from("customer_payments")
          .select("id, amount, method, txn_ref, paid_on, notes, customer_id, account_id")
          .eq("business_id", business.id)
          .in("customer_id", dealerIds)
          .order("paid_on", { ascending: false })
          .order("id", { ascending: true })
          .range(offset, offset + 999);
        if (error) throw error;
        all.push(...data);
        if (data.length < 1000) return all;
      }
    },
  });

  const creditByCustomer = useMemo(() => {
    const m = new Map<string, NonNullable<typeof creditRows>[number]>();
    for (const c of creditRows ?? []) m.set(c.customer_id, c);
    return m;
  }, [creditRows]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (balances.data ?? [])
      .map((b) => {
        const c = b.customer_id ? creditByCustomer.get(b.customer_id) : undefined;
        const limit = Number(b.credit_limit ?? 0);
        const due = Number(b.current_due ?? 0);
        return {
          ...b,
          status: c?.status ?? "active",
          available: limit - due,
          over: limit > 0 && due > limit,
          hasCredit: !!c,
        };
      })
      .filter((r) =>
        !s
          ? true
          : [r.name, r.business_name, r.mobile].some((x) => (x ?? "").toLowerCase().includes(s)),
      );
  }, [balances.data, creditByCustomer, q]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          due: a.due + Number(r.current_due ?? 0),
          limit: a.limit + Number(r.credit_limit ?? 0),
          over: a.over + (r.over ? 1 : 0),
        }),
        { due: 0, limit: 0, over: 0 },
      ),
    [rows],
  );

  const nameOf = (id: string | null) =>
    (balances.data ?? []).find((b) => b.customer_id === id)?.name ?? "—";

  const dealerImportColumns: ExcelColumn[] = [
    { key: "name", label: "Name", required: true },
    { key: "mobile", label: "Mobile", required: true },
    { key: "business_name", label: "Business name" },
    { key: "alt_mobile", label: "Alternative mobile" },
    { key: "type", label: "Dealer type", required: true },
    { key: "credit_limit", label: "Credit limit", type: "number" },
    { key: "payment_terms_days", label: "Payment terms (days)", type: "number" },
    { key: "status", label: "Status" },
    { key: "price_level", label: "Price level" },
    { key: "dealer_discount", label: "Dealer discount", type: "number" },
    { key: "dealer_level", label: "Dealer level" },
    { key: "dealer_type", label: "Dealer category" },
    { key: "address", label: "Address" },
    { key: "nid", label: "NID" },
    { key: "trade_license", label: "Trade license" },
    { key: "notes", label: "Notes" },
  ];
  const dealerExportColumns: ExcelColumn[] = [
    ...dealerImportColumns,
    { key: "current_due", label: "Current due", type: "number" },
    { key: "available", label: "Available credit", type: "number" },
  ];
  const dealerExportRows: ExcelRecord[] = (balances.data ?? []).map((row) => {
    const credit = row.customer_id ? creditByCustomer.get(row.customer_id) : undefined;
    const customer = (dealerCustomers.data ?? []).find((item) => item.id === row.customer_id);
    const limit = Number(row.credit_limit ?? 0);
    const due = Number(row.current_due ?? 0);
    return {
      name: row.name ?? "",
      mobile: row.mobile ?? "",
      business_name: row.business_name ?? "",
      type: row.type ?? "",
      credit_limit: limit,
      payment_terms_days: row.payment_terms_days ?? 0,
      status: credit?.status ?? "active",
      price_level: customer?.price_level ?? "",
      alt_mobile: customer?.alt_mobile ?? "",
      dealer_discount: customer?.dealer_discount ?? 0,
      dealer_level: customer?.dealer_level ?? "",
      dealer_type: customer?.dealer_type ?? "",
      address: customer?.address ?? "",
      nid: customer?.nid ?? "",
      trade_license: customer?.trade_license ?? "",
      notes: customer?.notes ?? "",
      current_due: due,
      available: limit - due,
    };
  });
  const paymentExportColumns: ExcelColumn[] = [
    { key: "customer_mobile", label: "Dealer mobile", required: true },
    { key: "paid_on", label: "Date" },
    { key: "dealer", label: "Dealer" },
    { key: "amount", label: "Amount", type: "number" },
    { key: "method", label: "Method" },
    { key: "account", label: "Account", required: true },
    { key: "txn_ref", label: "Reference" },
    { key: "notes", label: "Note" },
  ];
  const paymentExportRows: ExcelRecord[] = (payments.data ?? []).map((payment) => ({
    customer_mobile:
      (balances.data ?? []).find((item) => item.customer_id === payment.customer_id)?.mobile ?? "",
    paid_on: payment.paid_on,
    dealer: nameOf(payment.customer_id),
    amount: payment.amount,
    method: payment.method,
    account: accounts.data?.find((item) => item.id === payment.account_id)?.name ?? "",
    txn_ref: payment.txn_ref ?? "",
    notes: payment.notes ?? "",
  }));
  const importDealers = async (records: ExcelRecord[]) => {
    if (!navigator.onLine) throw new Error("Connect to the internet before importing Excel data.");
    const existing: { mobile: string }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("customers")
        .select("mobile")
        .eq("business_id", business.id)
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      if (error) throw error;
      existing.push(...data);
      if (data.length < 1000) break;
    }
    const knownMobiles = new Set(existing.map((item) => item.mobile.replace(/\D/g, "")));
    const seenMobiles = new Set<string>();
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const [index, row] of records.entries()) {
      const mobile = String(row.mobile).replace(/\D/g, "");
      if (knownMobiles.has(mobile) || seenMobiles.has(mobile)) {
        skipped += 1;
        continue;
      }
      const type = String(row.type).trim();
      const creditLimit = Number(row.credit_limit || 0);
      const terms = Math.trunc(Number(row.payment_terms_days || 0));
      const status =
        String(row.status ?? "")
          .trim()
          .toLowerCase() || "active";
      const priceLevel =
        String(row.price_level ?? "")
          .trim()
          .toLowerCase() || "dealer";
      try {
        const { data: customer, error } = await supabase
          .from("customers")
          .insert({
            business_id: business.id,
            name: String(row.name).trim(),
            mobile,
            business_name: String(row.business_name ?? "").trim() || null,
            alt_mobile: String(row.alt_mobile ?? "").trim() || null,
            type: type as Database["public"]["Enums"]["customer_type"],
            credit_limit: creditLimit,
            payment_terms_days: terms,
            price_level: priceLevel as Database["public"]["Enums"]["price_level"],
            dealer_discount: Number(row.dealer_discount || 0),
            dealer_level: String(row.dealer_level ?? "").trim() || null,
            dealer_type: String(row.dealer_type ?? "").trim() || null,
            address: String(row.address ?? "").trim() || null,
            nid: String(row.nid ?? "").trim() || null,
            trade_license: String(row.trade_license ?? "").trim() || null,
            notes: String(row.notes ?? "").trim() || null,
          })
          .select("id")
          .single();
        if (error) throw error;
        const { error: creditError } = await supabase.rpc("set_dealer_credit", {
          _biz: business.id,
          _customer: customer.id,
          _credit_limit: creditLimit,
          _payment_terms_days: terms,
          _status: status,
        });
        if (creditError)
          throw new Error(
            `Dealer was created, but credit setup failed and must be completed from the Dealers page: ${friendlyError(creditError)}`,
          );
        knownMobiles.add(mobile);
        imported += 1;
      } catch (error) {
        errors.push(`Row ${index + 2}: ${friendlyError(error)}`);
      }
      seenMobiles.add(mobile);
    }
    if (imported) {
      await qc.invalidateQueries({ queryKey: ["dealer-balances", business.id] });
      await qc.invalidateQueries({ queryKey: ["dealer-credit", business.id] });
    }
    return { imported, skipped, errors };
  };
  const paymentImportColumns: ExcelColumn[] = [
    { key: "customer_mobile", label: "Dealer mobile", required: true },
    { key: "paid_on", label: "Date", required: true },
    { key: "amount", label: "Amount", required: true, type: "number" },
    { key: "method", label: "Method", required: true },
    { key: "account", label: "Account", required: true },
    { key: "txn_ref", label: "Reference", required: true },
    { key: "notes", label: "Note" },
  ];
  const importDealerPayments = async (records: ExcelRecord[]) => {
    if (!navigator.onLine) throw new Error("Connect to the internet before importing Excel data.");
    const knownReferences = new Set(
      (payments.data ?? [])
        .map((payment) => payment.txn_ref?.trim().toLowerCase())
        .filter((value): value is string => !!value),
    );
    const fileReferences = new Set<string>();
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const [index, row] of records.entries()) {
      const reference = String(row.txn_ref).trim();
      const referenceKey = reference.toLowerCase();
      if (knownReferences.has(referenceKey) || fileReferences.has(referenceKey)) {
        skipped += 1;
        continue;
      }
      const mobile = String(row.customer_mobile).replace(/\D/g, "");
      const dealer = (balances.data ?? []).find(
        (item) => item.mobile?.replace(/\D/g, "") === mobile,
      );
      const matchingAccounts = (accounts.data ?? []).filter(
        (item) =>
          item.status === "active" &&
          (item.name ?? "").trim().toLowerCase() === String(row.account).trim().toLowerCase(),
      );
      if (!dealer?.customer_id || matchingAccounts.length !== 1) {
        errors.push(`Row ${index + 2}: Dealer or unique active account no longer exists.`);
        continue;
      }
      try {
        const { error } = await supabase.rpc("receive_customer_payment", {
          _biz: business.id,
          _customer: dealer.customer_id,
          _account: matchingAccounts[0]!.id!,
          _amount: Number(row.amount),
          _date: String(row.paid_on),
          _method: String(row.method) as Method,
          _txn_ref: reference,
          _note: String(row.notes ?? ""),
        });
        if (error) throw error;
        knownReferences.add(referenceKey);
        imported += 1;
      } catch (error) {
        errors.push(`Row ${index + 2}: ${friendlyError(error)}`);
      }
      fileReferences.add(referenceKey);
    }
    if (imported) {
      await qc.invalidateQueries({ queryKey: ["dealer-payments", business.id] });
      await qc.invalidateQueries({ queryKey: ["dealer-balances", business.id] });
    }
    return { imported, skipped, errors };
  };
  const canImportDealers =
    ["owner", "manager", "accountant"].includes(role) &&
    hasAccess(access, "dealers", "create") &&
    hasAccess(access, "customers", "create");
  const canImportPayments =
    canImportDealers &&
    hasAccess(access, "due_collection", "create") &&
    hasAccess(access, "cash_bank", "view");

  const saveCredit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("set_dealer_credit", {
        _biz: business.id,
        _customer: credit!.id,
        _credit_limit: Number(cf["limit"] || 0),
        _payment_terms_days: Number(cf["terms"] || 0),
        _status: cf["status"] ?? "active",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dealer credit saved");
      setCredit(null);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const receive = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("receive_customer_payment", {
        _biz: business.id,
        _customer: pay!.id,
        _account: pf["account"] || accounts.data?.[0]?.id || "",
        _amount: Number(pf["amount"] || 0),
        _date: pf["date"] ?? today(),
        _method: (pf["method"] ?? "cash") as Method,
        _txn_ref: pf["ref"] ?? "",
        _note: pf["note"] ?? "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment received");
      setPay(null);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <div>
      <PageHeader
        title="Dealers & sub-dealers"
        sub="Credit limits, dues and payments for wholesale dealers and sub-dealers."
        actions={
          <>
            <ExcelDataTools
              canExport={hasAccess(access, "dealers", "export") && !!balances.data}
              canImport={canImportDealers && !!balances.data && !!credits.data}
              importLabel="Import dealers"
              exports={[
                {
                  label: "Export dealers",
                  fileName: "dealers",
                  columns: dealerExportColumns,
                  rows: dealerExportRows,
                },
              ]}
              importConfig={{
                title: "dealers",
                fileName: "dealers",
                description:
                  "Adds new dealer customers and credit settings. Existing mobile numbers and duplicates are skipped.",
                columns: dealerImportColumns,
                validateRow: (row) => {
                  if (!/^(01[3-9]\d{8}|\d{10})$/.test(String(row.mobile).replace(/\D/g, "")))
                    return "Enter a Bangladesh mobile number (01XXXXXXXXX).";
                  if (!DEALER_TYPES.includes(String(row.type) as (typeof DEALER_TYPES)[number]))
                    return "Dealer type must be wholesale_dealer, sub_dealer, or dealer.";
                  if (Number(row.credit_limit || 0) < 0) return "Credit limit cannot be negative.";
                  if (
                    !Number.isInteger(Number(row.payment_terms_days || 0)) ||
                    Number(row.payment_terms_days || 0) < 0
                  )
                    return "Payment terms must be a whole number of days.";
                  if (
                    !DEALER_STATUS.some((option) => option.value === String(row.status || "active"))
                  )
                    return "Status must be active, blocked, or suspended.";
                  if (
                    !["retail", "wholesale", "dealer", "special"].includes(
                      String(row.price_level || "dealer"),
                    )
                  )
                    return "Price level must be retail, wholesale, dealer, or special.";
                  return null;
                },
                onImport: importDealers,
              }}
            />
            <ExcelDataTools
              canExport={
                hasAccess(access, "dealers", "export") &&
                hasAccess(access, "cash_bank", "view") &&
                !!payments.data
              }
              canImport={canImportPayments && !!balances.data && !!payments.data && !!accounts.data}
              importLabel="Import payments"
              exports={[
                {
                  label: "Export payment history",
                  fileName: "dealer-payment-history",
                  columns: paymentExportColumns,
                  rows: paymentExportRows,
                },
              ]}
              importConfig={{
                title: "dealer payments",
                fileName: "dealer-payments",
                description:
                  "Each row creates a real receipt and ledger posting and cannot exceed the dealer's current due. A unique transaction reference is required to avoid duplicate imports.",
                columns: paymentImportColumns,
                validateRow: (row) => {
                  const mobile = String(row.customer_mobile).replace(/\D/g, "");
                  if (!/^(01[3-9]\d{8}|\d{10})$/.test(mobile))
                    return "Enter a Bangladesh dealer mobile number.";
                  if (
                    !(balances.data ?? []).some(
                      (item) => item.mobile?.replace(/\D/g, "") === mobile,
                    )
                  )
                    return "Dealer mobile does not match a dealer in this business.";
                  const date = String(row.paid_on);
                  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))
                    return "Date must use YYYY-MM-DD.";
                  if (Number(row.amount) <= 0) return "Payment amount must be greater than zero.";
                  if (!METHODS.includes(String(row.method) as Method))
                    return `Method must be one of: ${METHODS.join(", ")}.`;
                  if (!String(row.txn_ref).trim())
                    return "A unique transaction reference is required.";
                  if (
                    !(accounts.data ?? []).some(
                      (item) =>
                        item.status === "active" &&
                        (item.name ?? "").trim().toLowerCase() ===
                          String(row.account).trim().toLowerCase(),
                    )
                  )
                    return "Account must match an active account.";
                  return null;
                },
                onImport: importDealerPayments,
              }}
            />
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4">
        <Stat label="Dealers" value={rows.length} note={`${totals.over} over limit`} />
        <Stat label="Total credit limit" value={totals.limit} />
        <Stat label="Total due" value={totals.due} tone={totals.due > 0 ? "neg" : undefined} />
        <Stat label="Available credit" value={Math.max(totals.limit - totals.due, 0)} tone="pos" />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Button
          className="h-14 justify-start gap-3 text-left"
          variant={tab === "dealers" ? "default" : "outline"}
          onClick={() => setTab("dealers")}
        >
          Dealers & sub-dealers
        </Button>
        <Button
          className="h-14 justify-start gap-3 text-left"
          variant={tab === "payments" ? "default" : "outline"}
          onClick={() => setTab("payments")}
        >
          Payment history
        </Button>
      </div>

      {tab === "dealers" ? (
        <div className="rounded-lg border bg-card">
          <div className="border-b p-3">
            <Input
              placeholder="Search dealer or mobile…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="max-w-xs"
            />
          </div>
          {balances.error ? (
            <p className="p-6 text-sm text-destructive">{friendlyError(balances.error)}</p>
          ) : rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              No dealers yet. Add a customer with type “Wholesale Dealer” or “Sub Dealer” from
              Customers.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dealer</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Due</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.customer_id!}>
                      <TableCell>
                        <div className="font-medium">{r.name}</div>
                        <div className="num text-xs text-muted-foreground">
                          {r.mobile}
                          {r.business_name ? ` · ${r.business_name}` : ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{typeLabel(r.type)}</Badge>
                      </TableCell>
                      <TableCell
                        className={
                          "num text-right font-semibold " + (r.over ? "text-destructive" : "")
                        }
                      >
                        {bdt(r.current_due)}
                      </TableCell>
                      <TableCell
                        className={"num text-right " + (r.available < 0 ? "text-destructive" : "")}
                      >
                        {bdt(r.available)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.status === "active" ? "secondary" : "destructive"}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <Button
                          size="sm"
                          onClick={() => {
                            setSelectedDealer(r);
                          }}
                        >
                          Open
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          {payments.error ? (
            <p className="p-6 text-sm text-destructive">{friendlyError(payments.error)}</p>
          ) : !payments.data?.length ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              No dealer payments yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Dealer</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.data.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="num">{p.paid_on}</TableCell>
                      <TableCell>{nameOf(p.customer_id)}</TableCell>
                      <TableCell className="num text-right font-semibold">
                        {bdt(p.amount)}
                      </TableCell>
                      <TableCell>{methodLabel(p.method)}</TableCell>
                      <TableCell className="num text-sm text-muted-foreground">
                        {p.txn_ref ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {p.notes ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      <Dialog open={!!selectedDealer} onOpenChange={(open) => !open && setSelectedDealer(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="break-words">{selectedDealer?.name}</DialogTitle>
          </DialogHeader>
          {selectedDealer && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border bg-card p-4">
                  <p className="text-xs text-muted-foreground">Dealer type</p>
                  <p className="mt-1 font-medium">{typeLabel(selectedDealer.type)}</p>
                </div>
                <div className="rounded-md border bg-card p-4">
                  <p className="text-xs text-muted-foreground">Mobile</p>
                  <p className="mt-1 font-medium">{selectedDealer.mobile}</p>
                </div>
                <Stat label="Credit limit" value={Number(selectedDealer.credit_limit ?? 0)} />
                <Stat
                  label="Current due"
                  value={Number(selectedDealer.current_due ?? 0)}
                  tone={Number(selectedDealer.current_due ?? 0) > 0 ? "neg" : undefined}
                />
                <Stat label="Available credit" value={Math.max(selectedDealer.available, 0)} />
                <div className="rounded-md border bg-card p-4">
                  <p className="text-xs text-muted-foreground">Payment terms</p>
                  <p className="mt-1 font-medium">{selectedDealer.payment_terms_days ?? 0} days</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={selectedDealer.status === "active" ? "secondary" : "destructive"}>
                  {selectedDealer.status}
                </Badge>
                {selectedDealer.last_payment && (
                  <Badge variant="outline">Last payment: {selectedDealer.last_payment}</Badge>
                )}
              </div>
              <DialogFooter className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Button asChild variant="outline">
                  <Link
                    to="/app/ledger"
                    search={{ kind: "customer", party: String(selectedDealer.customer_id) }}
                  >
                    Ledger
                  </Link>
                </Button>
                {canEdit && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCf({
                        limit: String(selectedDealer.credit_limit ?? 0),
                        terms: String(selectedDealer.payment_terms_days ?? 0),
                        status: selectedDealer.status,
                      });
                      setCredit({
                        id: selectedDealer.customer_id!,
                        name: selectedDealer.name!,
                      });
                      setSelectedDealer(null);
                    }}
                  >
                    Credit settings
                  </Button>
                )}
                <Button
                  disabled={!canCollect || Number(selectedDealer.current_due ?? 0) <= 0}
                  onClick={() => {
                    setPf({
                      date: today(),
                      method: "cash",
                      amount: String(selectedDealer.current_due ?? 0),
                    });
                    setPay({
                      id: selectedDealer.customer_id!,
                      name: selectedDealer.name!,
                      due: Number(selectedDealer.current_due ?? 0),
                    });
                    setSelectedDealer(null);
                  }}
                >
                  Receive payment
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!credit} onOpenChange={(o) => !o && setCredit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Credit settings — {credit?.name}</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveCredit.mutate();
            }}
          >
            <F label="Credit limit (৳)">
              <Input
                type="number"
                step="0.01"
                value={cf["limit"] ?? ""}
                onChange={(e) => setCf({ ...cf, limit: e.target.value })}
              />
            </F>
            <F label="Payment terms (days)">
              <Input
                type="number"
                value={cf["terms"] ?? ""}
                onChange={(e) => setCf({ ...cf, terms: e.target.value })}
              />
            </F>
            <F label="Status">
              <select
                className={selectCls}
                value={cf["status"] ?? "active"}
                onChange={(e) => setCf({ ...cf, status: e.target.value })}
              >
                {DEALER_STATUS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </F>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setCredit(null)}>
                Cancel
              </Button>
              <Button disabled={saveCredit.isPending}>Save credit</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pay} onOpenChange={(o) => !o && setPay(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Receive from {pay?.name} — due {bdt(pay?.due)}
            </DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              receive.mutate();
            }}
          >
            <F label="Amount (৳)">
              <Input
                type="number"
                step="0.01"
                value={pf["amount"] ?? ""}
                onChange={(e) => setPf({ ...pf, amount: e.target.value })}
              />
            </F>
            <F label="Method">
              <select
                className={selectCls}
                value={pf["method"] ?? "cash"}
                onChange={(e) => setPf({ ...pf, method: e.target.value })}
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {methodLabel(m)}
                  </option>
                ))}
              </select>
            </F>
            <F label="Receive into">
              <select
                className={selectCls}
                value={pf["account"] ?? ""}
                onChange={(e) => setPf({ ...pf, account: e.target.value })}
              >
                {accounts.data
                  ?.filter((a) => a.status === "active")
                  .map((a) => (
                    <option key={a.id!} value={a.id!}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </F>
            <F label="Date">
              <Input
                type="date"
                value={pf["date"] ?? ""}
                onChange={(e) => setPf({ ...pf, date: e.target.value })}
              />
            </F>
            <F label="Transaction ID">
              <Input
                value={pf["ref"] ?? ""}
                onChange={(e) => setPf({ ...pf, ref: e.target.value })}
              />
            </F>
            <F label="Note">
              <Input
                value={pf["note"] ?? ""}
                onChange={(e) => setPf({ ...pf, note: e.target.value })}
              />
            </F>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setPay(null)}>
                Cancel
              </Button>
              <Button disabled={receive.isPending}>Receive payment</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function typeLabel(t: string | null) {
  return t ? (TYPE_LABEL[t] ?? t) : "—";
}
