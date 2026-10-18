import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Download, FileUp, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { F, monthStart, selectCls, today } from "@/components/erp/ui";
import { PageHeader } from "@/components/erp/EntityManager";
import { useBranches } from "@/lib/finance";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { hasAccess } from "@/lib/access-control";
import { bdt, friendlyError } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/app/partner-finance/")({
  head: ({ matches }) => ({
    meta: [{ title: `Partner Finance — ${matchedCompany(matches)}` }],
  }),
  component: PartnerFinance,
});

type Provider = {
  id: string;
  name: string;
  legal_name: string | null;
  status: string;
  notes: string | null;
};
type FinanceSale = {
  id: string;
  sale_id: string;
  invoice_no: string;
  sale_date: string;
  sale_price: string | number;
  provider_id: string;
  branch_id: string;
  provider_name: string;
  branch_name: string;
  customer_name: string;
  customer_mobile: string | null;
  downpayment: string | number;
  financed_amount: string | number;
  expected_settlement: string | number;
  installment_count: number;
  installment_amount: string | number;
  customer_total_repayment: string | number;
  approval_reference: string;
  settled_amount: string | number;
  fee_total: string | number;
  outstanding_settlement: string | number;
  settlement_status: "pending" | "partial" | "settled" | "overpaid";
  status: string;
};
type Settlement = {
  id: string;
  provider_id: string;
  provider_name: string;
  invoice_no: string | null;
  external_reference: string | null;
  gross_amount: string | number;
  fee_amount: string | number;
  adjustment_amount: string | number;
  net_amount: string | number;
  paid_on: string;
  status: "matched" | "unmatched";
  sale_invoice: string | null;
  branch_id: string | null;
};
type Snapshot = { providers: Provider[]; sales: FinanceSale[]; settlements: Settlement[] };
type ImportRow = {
  invoice_no: string | null;
  external_reference: string | null;
  gross_amount: number;
  fee_amount: number;
  adjustment_amount: number;
  net_amount: number;
  paid_on: string;
  note: string | null;
};
type ImportPreview = { rows: ImportRow[]; errors: string[]; fileName: string };
type StockRow = {
  qty: number;
  variant_id: string;
  product_variants: {
    id: string;
    sku: string;
    ram: string | null;
    storage: string | null;
    color: string | null;
    retail_price: string | number;
    min_price: string | number;
    warranty_months: number;
    products: {
      model: string;
      brands: { name: string } | null;
      categories: { is_serialized: boolean } | null;
    } | null;
  } | null;
};
type Imei = { id: string; imei1: string; variant_id: string };

const number = (value: string | number | null | undefined) => Number(value ?? 0);
const emptyProvider = { name: "", legal_name: "", notes: "" };
const csvColumns = [
  "invoice_no",
  "external_reference",
  "gross_amount",
  "fee_amount",
  "adjustment_amount",
  "net_amount",
  "paid_on",
  "note",
];

function normalizeDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed)
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    if (new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text) return text;
    throw new Error("Use a valid paid_on date (YYYY-MM-DD).");
  }
  const parsed = new Date(text);
  if (!text || Number.isNaN(parsed.getTime()))
    throw new Error("Use a valid paid_on date (YYYY-MM-DD).");
  return parsed.toISOString().slice(0, 10);
}

function parseAmount(value: unknown, field: string, row: number, required = false) {
  const text = String(value ?? "").trim();
  if (!text && !required) return 0;
  const amount = Number(text.replaceAll(",", ""));
  if (!Number.isFinite(amount) || amount < 0 || (required && amount === 0)) {
    throw new Error(
      `Row ${row}: ${field} must be ${required ? "greater than zero" : "zero or greater"}.`,
    );
  }
  return Math.round(amount * 100) / 100;
}

function PartnerFinance() {
  const { business, access, role } = useBusiness();
  const qc = useQueryClient();
  const branches = useBranches(business.id);
  const [tab, setTab] = useState<"overview" | "sale" | "settlements" | "providers">("overview");
  const [providerFilter, setProviderFilter] = useState("");
  const [reportBranchId, setReportBranchId] = useState("");
  const [reportFrom, setReportFrom] = useState(monthStart());
  const [reportTo, setReportTo] = useState(today());
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [providerForm, setProviderForm] = useState(emptyProvider);
  const [branchId, setBranchId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [imeiId, setImeiId] = useState("");
  const [saleDate, setSaleDate] = useState(today());
  const [salePrice, setSalePrice] = useState("");
  const [downpayment, setDownpayment] = useState("0");
  const [expectedSettlement, setExpectedSettlement] = useState("");
  const [installmentCount, setInstallmentCount] = useState("12");
  const [installmentAmount, setInstallmentAmount] = useState("");
  const [customerRepayment, setCustomerRepayment] = useState("");
  const [applicationReference, setApplicationReference] = useState("");
  const [approvalReference, setApprovalReference] = useState("");
  const [saleNotes, setSaleNotes] = useState("");
  const [settlementProvider, setSettlementProvider] = useState("");
  const [settlementSaleId, setSettlementSaleId] = useState("");
  const [settlementInvoice, setSettlementInvoice] = useState("");
  const [settlementReference, setSettlementReference] = useState("");
  const [grossAmount, setGrossAmount] = useState("");
  const [feeAmount, setFeeAmount] = useState("0");
  const [adjustmentAmount, setAdjustmentAmount] = useState("0");
  const [paidOn, setPaidOn] = useState(today());
  const [settlementNote, setSettlementNote] = useState("");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);

  const snapshot = useQuery({
    queryKey: ["partner-finance", business.id, providerFilter],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("partner_finance_snapshot", {
        _biz: business.id,
        _provider: providerFilter || null,
      });
      if (error) throw error;
      return data as Snapshot;
    },
    refetchInterval: 60_000,
  });
  const providerList = snapshot.data?.providers ?? [];
  const settlementLines = snapshot.data?.settlements ?? [];
  const activeBranches = (branches.data ?? []).filter((branch) => branch.kind === "branch");
  const financeSales = useMemo(
    () => (snapshot.data?.sales ?? []).filter((sale) => sale.status === "active"),
    [snapshot.data?.sales],
  );
  const visibleSales = financeSales.filter(
    (sale) =>
      (!reportBranchId || sale.branch_id === reportBranchId) &&
      sale.sale_date >= reportFrom &&
      sale.sale_date <= reportTo,
  );
  const visibleSettlements = settlementLines.filter(
    (line) =>
      (!reportBranchId ||
        line.branch_id === reportBranchId ||
        (line.status === "unmatched" && !line.branch_id)) &&
      line.paid_on >= reportFrom &&
      line.paid_on <= reportTo,
  );
  const stock = useQuery({
    enabled: !!branchId,
    queryKey: ["partner-finance-stock", business.id, branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock")
        .select(
          "qty,variant_id,product_variants(id,sku,ram,storage,color,retail_price,min_price,warranty_months,products(model,brands(name),categories(is_serialized)))",
        )
        .eq("business_id", business.id)
        .eq("branch_id", branchId)
        .gt("qty", 0);
      if (error) throw error;
      return data as unknown as StockRow[];
    },
  });
  const phoneStock = (stock.data ?? []).filter(
    (item) => item.product_variants?.products?.categories?.is_serialized,
  );
  const imeis = useQuery({
    enabled: !!branchId && !!variantId,
    queryKey: ["partner-finance-imeis", business.id, branchId, variantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_imeis")
        .select("id,imei1,variant_id")
        .eq("business_id", business.id)
        .eq("branch_id", branchId)
        .eq("variant_id", variantId)
        .eq("status", "IN_STOCK")
        .order("imei1")
        .limit(500);
      if (error) throw error;
      return data as Imei[];
    },
  });
  const customers = useQuery({
    queryKey: ["partner-finance-customers", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id,name,mobile")
        .eq("business_id", business.id)
        .eq("status", "active")
        .order("name")
        .limit(1000);
      if (error) throw error;
      return data;
    },
  });

  const canView = hasAccess(access, "sales", "view");
  const canCreate = hasAccess(access, "sales", "create");
  const canManageProviders =
    (role === "owner" || role === "manager") && (canCreate || hasAccess(access, "sales", "edit"));
  const canReconcile = canCreate && ["owner", "manager", "accountant"].includes(role);

  const refresh = () => qc.invalidateQueries({ queryKey: ["partner-finance", business.id] });
  const saveProvider = useMutation({
    mutationFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("save_finance_provider", {
        _biz: business.id,
        _id: editingProvider?.id ?? null,
        _name: providerForm.name,
        _legal_name: providerForm.legal_name,
        _status: editingProvider?.status ?? "active",
        _notes: providerForm.notes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Provider saved");
      setEditingProvider(null);
      setProviderForm(emptyProvider);
      refresh();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const createSale = useMutation({
    mutationFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("create_partner_financed_sale", {
        _biz: business.id,
        _branch: branchId,
        _customer: customerId,
        _provider: providerId,
        _variant: variantId,
        _imei: imeiId,
        _sale_price: Number(salePrice),
        _downpayment: Number(downpayment),
        _expected_settlement: Number(expectedSettlement),
        _installment_count: Number(installmentCount),
        _installment_amount: Number(installmentAmount),
        _customer_total_repayment: Number(customerRepayment),
        _application_reference: applicationReference,
        _approval_reference: approvalReference,
        _sale_date: saleDate,
        _notes: saleNotes,
      });
      if (error) throw error;
      return data as { invoice_no: string };
    },
    onSuccess: (result) => {
      toast.success(`Financed sale recorded: ${result.invoice_no}`);
      setCustomerId("");
      setVariantId("");
      setImeiId("");
      setApprovalReference("");
      setSaleNotes("");
      qc.invalidateQueries();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const recordSettlement = useMutation({
    mutationFn: async () => {
      const selectedSale = financeSales.find((sale) => sale.sale_id === settlementSaleId);
      const net = Number(grossAmount) - Number(feeAmount || 0) + Number(adjustmentAmount || 0);
      if (!Number.isFinite(net) || net <= 0)
        throw new Error("Net settlement must be greater than zero.");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("record_partner_settlement", {
        _biz: business.id,
        _provider: settlementProvider,
        _invoice: selectedSale?.invoice_no ?? (settlementInvoice.trim() || null),
        _external_reference: selectedSale ? null : settlementReference.trim() || null,
        _gross: Number(grossAmount),
        _fee: Number(feeAmount || 0),
        _adjustment: Number(adjustmentAmount || 0),
        _net: net,
        _paid_on: paidOn,
        _note: settlementNote,
      });
      if (error) throw error;
      return data as "matched" | "unmatched";
    },
    onSuccess: (result) => {
      toast.success(
        result === "matched"
          ? "Settlement recorded and matched"
          : "Settlement recorded as unmatched",
      );
      setGrossAmount("");
      setFeeAmount("0");
      setAdjustmentAmount("0");
      setSettlementSaleId("");
      setSettlementInvoice("");
      setSettlementReference("");
      setSettlementNote("");
      refresh();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const importSettlements = useMutation({
    mutationFn: async () => {
      if (!importPreview || !settlementProvider)
        throw new Error("Choose a provider and file first.");
      if (importPreview.errors.length) throw new Error("Fix all invalid rows before importing.");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("import_partner_settlements", {
        _biz: business.id,
        _provider: settlementProvider,
        _file_name: importPreview.fileName,
        _rows: importPreview.rows,
      });
      if (error) throw error;
      return data as {
        inserted: number;
        matched: number;
        unmatched: number;
        duplicates_skipped: number;
      };
    },
    onSuccess: (result) => {
      toast.success(
        `Imported ${result.inserted}; matched ${result.matched}, unmatched ${result.unmatched}, duplicates skipped ${result.duplicates_skipped}.`,
      );
      setImportPreview(null);
      refresh();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const matchSettlement = useMutation({
    mutationFn: async ({ lineId, saleId }: { lineId: string; saleId: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("match_partner_settlement", {
        _biz: business.id,
        _line: lineId,
        _sale: saleId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Settlement matched");
      refresh();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  function loadProvider(provider: Provider) {
    setEditingProvider(provider);
    setProviderForm({
      name: provider.name,
      legal_name: provider.legal_name ?? "",
      notes: provider.notes ?? "",
    });
  }

  async function readSettlementFile(file: File) {
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("Maximum file size is 10 MB.");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]!];
      if (!firstSheet) throw new Error("The selected file has no worksheet.");
      const source = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
      if (source.length > 5000) throw new Error("Maximum import size is 5,000 rows.");
      const rows: ImportRow[] = [];
      const errors: string[] = [];
      source.forEach((record, index) => {
        const values = new Map(
          Object.entries(record).map(([key, value]) => [key.trim().toLowerCase(), value]),
        );
        const get = (key: string) => values.get(key) ?? "";
        try {
          const invoice = String(get("invoice_no") ?? "").trim();
          const reference = String(get("external_reference") ?? "").trim();
          if (!invoice && !reference)
            throw new Error(`Row ${index + 2}: invoice_no or external_reference is required.`);
          const gross = parseAmount(get("gross_amount"), "gross_amount", index + 2, true);
          const fee = parseAmount(get("fee_amount"), "fee_amount", index + 2);
          const adjustmentText = String(get("adjustment_amount") ?? "").trim();
          const adjustment = adjustmentText ? Number(adjustmentText.replaceAll(",", "")) : 0;
          if (!Number.isFinite(adjustment))
            throw new Error(`Row ${index + 2}: adjustment_amount must be numeric.`);
          const net = parseAmount(get("net_amount"), "net_amount", index + 2, true);
          if (Math.abs(Math.round((gross - fee + adjustment) * 100) / 100 - net) > 0.01) {
            throw new Error(
              `Row ${index + 2}: net_amount must equal gross_amount - fee_amount + adjustment_amount.`,
            );
          }
          rows.push({
            invoice_no: invoice || null,
            external_reference: reference || null,
            gross_amount: gross,
            fee_amount: fee,
            adjustment_amount: Math.round(adjustment * 100) / 100,
            net_amount: net,
            paid_on: normalizeDate(get("paid_on")),
            note: String(get("note") ?? "").trim() || null,
          });
        } catch (error) {
          errors.push(error instanceof Error ? error.message : `Row ${index + 2}: invalid data.`);
        }
      });
      if (!source.length) throw new Error("The worksheet has no settlement rows.");
      setImportPreview({ rows, errors, fileName: file.name });
    } catch (error) {
      toast.error(friendlyError(error));
      setImportPreview(null);
    }
  }

  function downloadTemplate() {
    const csv = `${csvColumns.join(",")}\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "partner-settlement-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!canView) {
    return (
      <div>
        <PageHeader title="Partner Finance" />
        <p className="text-sm text-destructive">
          You do not have permission to view partner finance.
        </p>
      </div>
    );
  }

  const totalExpected = visibleSales.reduce(
    (sum, sale) => sum + number(sale.expected_settlement),
    0,
  );
  const totalSettled = visibleSales.reduce((sum, sale) => sum + number(sale.settled_amount), 0);
  const totalOutstanding = visibleSales.reduce(
    (sum, sale) => sum + number(sale.outstanding_settlement),
    0,
  );
  const netSettlement = number(grossAmount) - number(feeAmount) + number(adjustmentAmount);
  const chosenVariant = phoneStock.find((item) => item.variant_id === variantId)?.product_variants;
  const validSale =
    !!branchId &&
    !!customerId &&
    !!providerId &&
    !!variantId &&
    !!imeiId &&
    Number(salePrice) > 0 &&
    Number(expectedSettlement) > 0 &&
    Number(installmentCount) > 0 &&
    Number(installmentAmount) > 0 &&
    Number(customerRepayment) > 0 &&
    !!approvalReference.trim();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Partner Finance"
        sub="Track brand-shop sales financed by third-party providers and reconcile dealer settlements. No accounting entries are posted."
        actions={
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        }
      />
      <div className="flex flex-wrap gap-2 border-b pb-3">
        {(
          [
            ["overview", "Overview"],
            ["sale", "New financed sale"],
            ["settlements", "Settlements"],
            ["providers", "Providers"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={tab === key ? "default" : "outline"}
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
        <div className="ml-auto min-w-48">
          <select
            className={selectCls}
            value={providerFilter}
            onChange={(event) => setProviderFilter(event.target.value)}
          >
            <option value="">All providers</option>
            {providerList.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <F label="Shop filter">
          <select
            className={selectCls}
            value={reportBranchId}
            onChange={(event) => setReportBranchId(event.target.value)}
          >
            <option value="">All shops</option>
            {activeBranches.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </F>
        <F label="From date">
          <Input
            type="date"
            value={reportFrom}
            onChange={(event) => setReportFrom(event.target.value)}
          />
        </F>
        <F label="To date">
          <Input
            type="date"
            value={reportTo}
            onChange={(event) => setReportTo(event.target.value)}
          />
        </F>
      </div>

      {snapshot.isError && (
        <p className="text-sm text-destructive">{friendlyError(snapshot.error)}</p>
      )}

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Partner-financed sales", visibleSales.length.toString()],
              ["Expected dealer settlement", bdt(totalExpected)],
              ["Settlement received", bdt(totalSettled)],
              ["Still outstanding", bdt(totalOutstanding)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border bg-card p-4">
                <div className="text-sm text-muted-foreground">{label}</div>
                <div className="num mt-1 text-xl font-semibold">{value}</div>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="p-3">Invoice / date</th>
                  <th>Provider</th>
                  <th>Shop / customer</th>
                  <th className="text-right">Sale</th>
                  <th className="text-right">Down payment</th>
                  <th className="text-right">Expected payout</th>
                  <th className="text-right">Received</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleSales.map((sale) => (
                  <tr key={sale.id} className="border-b last:border-0">
                    <td className="p-3">
                      <div className="font-medium">{sale.invoice_no}</div>
                      <div className="text-xs text-muted-foreground">{sale.sale_date}</div>
                    </td>
                    <td>{sale.provider_name}</td>
                    <td>
                      {sale.branch_name}
                      <div className="text-xs text-muted-foreground">
                        {sale.customer_name} · {sale.customer_mobile ?? "No mobile"}
                      </div>
                    </td>
                    <td className="num text-right">{bdt(number(sale.sale_price))}</td>
                    <td className="num text-right">{bdt(number(sale.downpayment))}</td>
                    <td className="num text-right">{bdt(number(sale.expected_settlement))}</td>
                    <td className="num text-right">{bdt(number(sale.settled_amount))}</td>
                    <td>
                      <Badge
                        variant={
                          sale.settlement_status === "settled"
                            ? "secondary"
                            : sale.settlement_status === "overpaid"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {sale.settlement_status}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {!financeSales.length && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      No partner-financed sales yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "sale" && (
        <section className="max-w-4xl rounded-lg border bg-card p-4">
          <h2 className="mb-1 font-semibold">Record partner-financed phone sale</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Posts the sale and stock/IMEI movement atomically. Customer down payment and partner
            payout are tracking-only; no cash, journal or customer due is posted.
          </p>
          {!canCreate && (
            <p className="mb-3 text-sm text-destructive">You need Sales create permission.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <F label="Brand shop">
              <select
                className={selectCls}
                value={branchId}
                onChange={(e) => {
                  setBranchId(e.target.value);
                  setVariantId("");
                  setImeiId("");
                }}
              >
                <option value="">Select shop</option>
                {activeBranches.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </F>
            <F label="Finance provider">
              <select
                className={selectCls}
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
              >
                <option value="">Select provider</option>
                {providerList
                  .filter((item) => item.status === "active")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            </F>
            <F label="Customer">
              <select
                className={selectCls}
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">Select customer</option>
                {(customers.data ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.mobile ? ` · ${item.mobile}` : ""}
                  </option>
                ))}
              </select>
            </F>
            <F label="Sale date">
              <Input type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
            </F>
            <F label="In-stock phone">
              <select
                className={selectCls}
                value={variantId}
                onChange={(e) => {
                  setVariantId(e.target.value);
                  setImeiId("");
                  const item = phoneStock.find(
                    (row) => row.variant_id === e.target.value,
                  )?.product_variants;
                  if (item) setSalePrice(String(item.retail_price));
                }}
              >
                <option value="">Select phone</option>
                {phoneStock.map((item) => {
                  const variant = item.product_variants;
                  return variant ? (
                    <option key={variant.id} value={variant.id}>
                      {variant.products?.brands?.name} {variant.products?.model} {variant.ram} /{" "}
                      {variant.storage} / {variant.color} · {item.qty} in stock
                    </option>
                  ) : null;
                })}
              </select>
            </F>
            <F label="Available IMEI">
              <select
                className={selectCls}
                value={imeiId}
                onChange={(e) => setImeiId(e.target.value)}
              >
                <option value="">Select IMEI</option>
                {(imeis.data ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.imei1}
                  </option>
                ))}
              </select>
            </F>
            <F label="Sale price">
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
              />
            </F>
            <F label="Customer down payment (tracking only)">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={downpayment}
                onChange={(e) => setDownpayment(e.target.value)}
              />
            </F>
            <F label="Partner expected payout">
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={expectedSettlement}
                onChange={(e) => setExpectedSettlement(e.target.value)}
              />
            </F>
            <F label="Installment count">
              <Input
                type="number"
                min="1"
                step="1"
                value={installmentCount}
                onChange={(e) => setInstallmentCount(e.target.value)}
              />
            </F>
            <F label="Customer installment amount">
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={installmentAmount}
                onChange={(e) => setInstallmentAmount(e.target.value)}
              />
            </F>
            <F label="Customer total repayment">
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={customerRepayment}
                onChange={(e) => setCustomerRepayment(e.target.value)}
              />
            </F>
            <F label="Application reference (optional)">
              <Input
                value={applicationReference}
                onChange={(e) => setApplicationReference(e.target.value)}
              />
            </F>
            <F label="Provider approval reference (required)">
              <Input
                value={approvalReference}
                onChange={(e) => setApprovalReference(e.target.value)}
              />
            </F>
            <F label="Notes">
              <Input value={saleNotes} onChange={(e) => setSaleNotes(e.target.value)} />
            </F>
          </div>
          {chosenVariant && (
            <p className="mt-3 text-xs text-muted-foreground">
              SKU {chosenVariant.sku} · Minimum price {bdt(number(chosenVariant.min_price))} ·
              Warranty {chosenVariant.warranty_months} months
            </p>
          )}
          <Button
            className="mt-4"
            disabled={!canCreate || !validSale || createSale.isPending}
            onClick={() => createSale.mutate()}
          >
            Record financed sale
          </Button>
        </section>
      )}

      {tab === "settlements" && (
        <div className="space-y-4">
          <section className="max-w-4xl rounded-lg border bg-card p-4">
            <h2 className="mb-3 font-semibold">Manual settlement</h2>
            {!canReconcile && (
              <p className="mb-3 text-sm text-destructive">
                Settlement entry requires Sales create permission and an owner, manager or
                accountant role.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <F label="Provider">
                <select
                  className={selectCls}
                  value={settlementProvider}
                  onChange={(e) => {
                    setSettlementProvider(e.target.value);
                    setSettlementSaleId("");
                  }}
                >
                  <option value="">Select provider</option>
                  {providerList.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </F>
              <F label="Match to financed sale (optional)">
                <select
                  className={selectCls}
                  value={settlementSaleId}
                  onChange={(e) => setSettlementSaleId(e.target.value)}
                >
                  <option value="">Enter invoice/reference to match automatically</option>
                  {financeSales
                    .filter((sale) => sale.provider_id === settlementProvider)
                    .map((sale) => (
                      <option key={sale.sale_id} value={sale.sale_id}>
                        {sale.invoice_no} · {sale.customer_name} ·{" "}
                        {bdt(number(sale.expected_settlement))}
                      </option>
                    ))}
                </select>
              </F>
              {!settlementSaleId && (
                <>
                  <F label="Invoice number (enter one identifier)">
                    <Input
                      value={settlementInvoice}
                      onChange={(e) => setSettlementInvoice(e.target.value)}
                    />
                  </F>
                  <F label="Provider approval reference (or invoice)">
                    <Input
                      value={settlementReference}
                      onChange={(e) => setSettlementReference(e.target.value)}
                    />
                  </F>
                </>
              )}
              <F label="Gross amount">
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={grossAmount}
                  onChange={(e) => setGrossAmount(e.target.value)}
                />
              </F>
              <F label="Provider fee">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={feeAmount}
                  onChange={(e) => setFeeAmount(e.target.value)}
                />
              </F>
              <F label="Adjustment (+/-)">
                <Input
                  type="number"
                  step="0.01"
                  value={adjustmentAmount}
                  onChange={(e) => setAdjustmentAmount(e.target.value)}
                />
              </F>
              <F label="Net received">
                <Input readOnly value={netSettlement.toFixed(2)} />
              </F>
              <F label="Paid on">
                <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </F>
              <F label="Note">
                <Input value={settlementNote} onChange={(e) => setSettlementNote(e.target.value)} />
              </F>
            </div>
            <Button
              className="mt-4"
              disabled={
                !canReconcile ||
                !settlementProvider ||
                Number(grossAmount) <= 0 ||
                netSettlement <= 0 ||
                recordSettlement.isPending
              }
              onClick={() => recordSettlement.mutate()}
            >
              Save settlement
            </Button>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">Import provider settlement CSV / Excel</h2>
                <p className="text-sm text-muted-foreground">
                  Use invoice_no or external_reference, gross_amount, fee_amount, adjustment_amount,
                  net_amount, paid_on and note.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                <Download className="mr-2 h-4 w-4" /> Template
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <F label="Import provider">
                <select
                  className={selectCls}
                  value={settlementProvider}
                  onChange={(e) => setSettlementProvider(e.target.value)}
                >
                  <option value="">Select provider</option>
                  {providerList.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </F>
              <F label="Settlement file">
                <Input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void readSettlementFile(file);
                    e.currentTarget.value = "";
                  }}
                />
              </F>
              <Button
                disabled={
                  !canReconcile ||
                  !settlementProvider ||
                  !importPreview ||
                  !!importPreview.errors.length ||
                  importSettlements.isPending
                }
                onClick={() => importSettlements.mutate()}
              >
                <FileUp className="mr-2 h-4 w-4" /> Import rows
              </Button>
            </div>
            {importPreview && (
              <div className="mt-3 rounded-md border p-3 text-sm">
                <div className="font-medium">
                  {importPreview.fileName}: {importPreview.rows.length} valid rows,{" "}
                  {importPreview.errors.length} errors
                </div>
                {!!importPreview.errors.length && (
                  <ul className="mt-2 list-inside list-disc text-destructive">
                    {importPreview.errors.slice(0, 10).map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          <section className="overflow-x-auto rounded-lg border bg-card">
            <h2 className="p-4 font-semibold">Settlement history and unmatched lines</h2>
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-y text-left text-xs uppercase text-muted-foreground">
                  <th className="p-3">Paid on</th>
                  <th>Provider</th>
                  <th>Invoice / provider ref</th>
                  <th className="text-right">Gross</th>
                  <th className="text-right">Fee</th>
                  <th className="text-right">Net</th>
                  <th>Match</th>
                  <th>Match to sale</th>
                </tr>
              </thead>
              <tbody>
                {visibleSettlements.map((line) => (
                  <tr key={line.id} className="border-b last:border-0">
                    <td className="p-3">{line.paid_on}</td>
                    <td>{line.provider_name}</td>
                    <td>
                      {line.invoice_no ?? "—"}
                      <div className="text-xs text-muted-foreground">
                        {line.external_reference ?? ""}
                      </div>
                    </td>
                    <td className="num text-right">{bdt(number(line.gross_amount))}</td>
                    <td className="num text-right">{bdt(number(line.fee_amount))}</td>
                    <td className="num text-right">{bdt(number(line.net_amount))}</td>
                    <td>
                      <Badge variant={line.status === "matched" ? "secondary" : "outline"}>
                        {line.status}
                        {line.sale_invoice ? ` · ${line.sale_invoice}` : ""}
                      </Badge>
                    </td>
                    <td>
                      {line.status === "unmatched" && canReconcile ? (
                        <select
                          className={selectCls}
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value)
                              matchSettlement.mutate({ lineId: line.id, saleId: e.target.value });
                          }}
                        >
                          <option value="">Select same-provider sale</option>
                          {financeSales
                            .filter((sale) => sale.provider_id === line.provider_id)
                            .map((sale) => (
                              <option key={sale.sale_id} value={sale.sale_id}>
                                {sale.invoice_no} · {sale.customer_name}
                              </option>
                            ))}
                        </select>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
                {!visibleSettlements.length && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      No settlement entries yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
      )}

      {tab === "providers" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-3 font-semibold">Finance providers</h2>
            <div className="divide-y">
              {providerList.map((provider) => (
                <div key={provider.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <div className="font-medium">
                      {provider.name}{" "}
                      <Badge variant={provider.status === "active" ? "secondary" : "outline"}>
                        {provider.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {provider.legal_name ?? provider.notes ?? "No details"}
                    </div>
                  </div>
                  {canManageProviders && (
                    <Button size="sm" variant="outline" onClick={() => loadProvider(provider)}>
                      Edit
                    </Button>
                  )}
                </div>
              ))}
              {!providerList.length && (
                <p className="py-5 text-sm text-muted-foreground">No providers configured.</p>
              )}
            </div>
            {canManageProviders && (
              <Button
                className="mt-3"
                variant="outline"
                onClick={() => {
                  setEditingProvider(null);
                  setProviderForm(emptyProvider);
                }}
              >
                <Plus className="mr-2 h-4 w-4" /> New provider
              </Button>
            )}
          </section>
          <section className="h-fit rounded-lg border bg-card p-4">
            <h2 className="mb-3 font-semibold">
              {editingProvider ? "Edit provider" : "Add provider"}
            </h2>
            {!canManageProviders && (
              <p className="mb-3 text-sm text-muted-foreground">
                Only owners and managers with Sales create/edit access can manage providers.
              </p>
            )}
            <div className="grid gap-3">
              <F label="Provider name">
                <Input
                  value={providerForm.name}
                  onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })}
                  maxLength={100}
                />
              </F>
              <F label="Legal name (optional)">
                <Input
                  value={providerForm.legal_name}
                  onChange={(e) => setProviderForm({ ...providerForm, legal_name: e.target.value })}
                />
              </F>
              {editingProvider && (
                <F label="Status">
                  <select
                    className={selectCls}
                    value={editingProvider.status}
                    onChange={(e) =>
                      setEditingProvider({ ...editingProvider, status: e.target.value })
                    }
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </F>
              )}
              <F label="Notes">
                <Input
                  value={providerForm.notes}
                  onChange={(e) => setProviderForm({ ...providerForm, notes: e.target.value })}
                />
              </F>
            </div>
            <Button
              className="mt-4"
              disabled={!canManageProviders || !providerForm.name.trim() || saveProvider.isPending}
              onClick={() => saveProvider.mutate()}
            >
              {editingProvider ? "Update provider" : "Save provider"}
            </Button>
          </section>
        </div>
      )}
    </div>
  );
}
