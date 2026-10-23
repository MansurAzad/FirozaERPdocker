import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
import { calculatePartnerFinanceDownpayment } from "@/lib/partner-finance";

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
  discount_amount: string | number;
  net_downpayment: string | number;
  discount_approval_status: "not_required" | "approved";
  discount_approved_by: string | null;
  discount_approved_at: string | null;
  discount_approved_by_name: string | null;
  downpayment_money_transaction_id: string | null;
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
  accounting_status: "unposted" | "posted" | "reversed";
  money_transaction_id: string | null;
  journal_entry_id: string | null;
  reversal_money_transaction_id: string | null;
  reversal_journal_entry_id: string | null;
  reversal_reason: string | null;
  reversed_by: string | null;
  reversed_at: string | null;
};
type FinanceInstallment = {
  id: string;
  agreement_id: string;
  installment_no: number;
  branch_id: string;
  branch_name: string;
  customer_id: string;
  customer_name: string;
  invoice_no: string;
  due_date: string;
  scheduled_amount: string | number;
  paid_amount: string | number;
  waived_amount: string | number;
  outstanding: string | number;
  status: "paid" | "partial" | "overdue" | "pending";
};
type FinanceTransaction = {
  id: string;
  agreement_id: string;
  installment_id: string | null;
  branch_id: string;
  branch_name: string;
  customer_id: string;
  customer_name: string;
  event_type: "payment" | "refund" | "downpayment_refund" | "waiver";
  amount: string | number;
  transaction_date: string;
  money_account_id: string | null;
  money_transaction_id: string | null;
  source_money_transaction_id: string | null;
  journal_entry_id: string | null;
  reversal_of: string | null;
  approved_by: string | null;
  remarks: string | null;
  status: "posted" | "reversed";
};
type FinanceCustomer = { id: string; name: string; mobile: string | null };
type FinanceMember = {
  user_id: string;
  role: string;
  display_name: string | null;
};
type FinanceSummary = {
  agreement_count: number;
  contract_value: string | number;
  scheduled_downpayment: string | number;
  downpayment_discount: string | number;
  net_downpayment: string | number;
  partner_receivable_outstanding: string | number;
  settlement_fee_total: string | number;
  settlement_adjustment_total: string | number;
  installment_collected: string | number;
  installment_due: string | number;
  customer_due: string | number;
  overdue_installments: number;
  refund_total: string | number;
  installment_waivers: string | number;
};
type Snapshot = {
  providers: Provider[];
  sales: FinanceSale[];
  settlements: Settlement[];
  installments: FinanceInstallment[];
  transactions: FinanceTransaction[];
  customers: FinanceCustomer[];
  summary: FinanceSummary;
  monthly_summary: { month: string; agreement_count: number; contract_value: number }[];
  yearly_summary: { year: number; agreement_count: number; contract_value: number }[];
  discount_policy: { maximum_downpayment_discount_rate: number; approval_required: boolean };
};
type MoneyAccount = {
  id: string;
  name: string;
  kind: "cash" | "bank" | "mfs";
  branch_id: string | null;
  status: string;
};
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
  const centralFinanceRole = ["owner", "manager", "accountant"].includes(role);
  const branchAccess = useQuery({
    queryKey: ["partner-finance-branch-access", business.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("partner_finance_branch_access")
        .select("user_id,branch_id")
        .eq("business_id", business.id);
      if (error) throw error;
      return data as { user_id: string; branch_id: string }[];
    },
  });
  const assignableMembers = useQuery({
    enabled: ["owner", "manager"].includes(role),
    queryKey: ["partner-finance-members", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_members")
        .select("user_id,role,display_name")
        .eq("business_id", business.id)
        .in("role", ["branch_manager", "salesman", "store_keeper"])
        .order("display_name");
      if (error) throw error;
      return data as FinanceMember[];
    },
  });
  const [tab, setTab] = useState<"overview" | "sale" | "collections" | "settlements" | "providers">(
    "overview",
  );
  const [providerFilter, setProviderFilter] = useState("");
  const [reportBranchId, setReportBranchId] = useState("");
  const [reportCustomerId, setReportCustomerId] = useState("");
  const [reportStatus, setReportStatus] = useState("");
  const [reportTransactionType, setReportTransactionType] = useState("");
  const [collectionChartPeriod, setCollectionChartPeriod] = useState<"daily" | "monthly">("daily");
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
  const [downpaymentMode, setDownpaymentMode] = useState<"fixed" | "percentage">("fixed");
  const [downpaymentValue, setDownpaymentValue] = useState("0");
  const [discountMode, setDiscountMode] = useState<"fixed" | "percentage">("fixed");
  const [discountValue, setDiscountValue] = useState("0");
  const [downpaymentAccountId, setDownpaymentAccountId] = useState("");
  const [policyMaximumRate, setPolicyMaximumRate] = useState("0");
  const [policyApprovalRequired, setPolicyApprovalRequired] = useState(true);
  const [policyDirty, setPolicyDirty] = useState(false);
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
  const [selectedInstallment, setSelectedInstallment] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState("");
  const [selectedPayment, setSelectedPayment] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundIdempotencyKey, setRefundIdempotencyKey] = useState("");
  const [selectedDownpaymentAgreement, setSelectedDownpaymentAgreement] = useState("");
  const [downpaymentRefundAmount, setDownpaymentRefundAmount] = useState("");
  const [downpaymentRefundReason, setDownpaymentRefundReason] = useState("");
  const [downpaymentRefundIdempotencyKey, setDownpaymentRefundIdempotencyKey] = useState("");
  const [waiverAmount, setWaiverAmount] = useState("");
  const [waiverReason, setWaiverReason] = useState("");
  const [waiverIdempotencyKey, setWaiverIdempotencyKey] = useState("");
  const [settlementAccountId, setSettlementAccountId] = useState("");
  const [settlementIdempotencyKey, setSettlementIdempotencyKey] = useState("");
  const [reversingSettlementId, setReversingSettlementId] = useState("");
  const [settlementReversalReason, setSettlementReversalReason] = useState("");
  const [settlementReversalDate, setSettlementReversalDate] = useState(today());
  const [settlementReversalKey, setSettlementReversalKey] = useState("");
  const [accessUserId, setAccessUserId] = useState("");
  const [accessBranchId, setAccessBranchId] = useState("");

  const snapshot = useQuery({
    queryKey: [
      "partner-finance",
      business.id,
      providerFilter,
      reportFrom,
      reportTo,
      reportBranchId,
      reportCustomerId,
      reportStatus,
      reportTransactionType,
    ],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("partner_finance_operational_report", {
        _biz: business.id,
        _provider: providerFilter || null,
        _from: reportFrom || null,
        _to: reportTo || null,
        _branch: reportBranchId || null,
        _customer: reportCustomerId || null,
        _status: reportStatus || null,
        _transaction_type: reportTransactionType || null,
      });
      if (error) throw error;
      return data as Snapshot;
    },
    refetchInterval: 60_000,
  });
  useEffect(() => {
    if (!snapshot.data?.discount_policy || policyDirty) return;
    setPolicyMaximumRate(String(snapshot.data.discount_policy.maximum_downpayment_discount_rate));
    setPolicyApprovalRequired(snapshot.data.discount_policy.approval_required);
  }, [snapshot.data?.discount_policy, policyDirty]);
  const providerList = snapshot.data?.providers ?? [];
  const settlementLines = snapshot.data?.settlements ?? [];
  const activeBranches = (branches.data ?? []).filter(
    (branch) =>
      branch.kind === "branch" &&
      (centralFinanceRole ||
        (branchAccess.data ?? []).some((access) => access.branch_id === branch.id)),
  );
  const customerOptions = useQuery({
    enabled: !!branchId,
    queryKey: ["partner-finance-customer-options", business.id, branchId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("partner_finance_customer_options", {
        _biz: business.id,
        _branch: branchId,
      });
      if (error) throw error;
      return data as FinanceCustomer[];
    },
  });
  const financeSales = useMemo(
    () => (snapshot.data?.sales ?? []).filter((sale) => sale.status === "active"),
    [snapshot.data?.sales],
  );
  const visibleSales = financeSales.filter(
    (sale) =>
      (!reportBranchId || sale.branch_id === reportBranchId) &&
      (!reportFrom || sale.sale_date >= reportFrom) &&
      (!reportTo || sale.sale_date <= reportTo),
  );
  const visibleSettlements = settlementLines.filter(
    (line) =>
      (!reportBranchId || line.branch_id === reportBranchId) &&
      (!reportFrom || line.paid_on >= reportFrom) &&
      (!reportTo || line.paid_on <= reportTo),
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
  const moneyAccounts = useQuery({
    queryKey: ["partner-finance-money-accounts", business.id],
    queryFn: async (): Promise<MoneyAccount[]> => {
      const { data, error } = await supabase
        .from("money_accounts")
        .select("id,name,kind,branch_id,status")
        .eq("business_id", business.id)
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const canView = hasAccess(access, "sales", "view");
  const canCreate = hasAccess(access, "sales", "create");
  const canManageProviders =
    (role === "owner" || role === "manager") && (canCreate || hasAccess(access, "sales", "edit"));
  const canApproveDiscount = role === "owner" || role === "manager";
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
  const saveDiscountPolicy = useMutation({
    mutationFn: async () => {
      const maximumRate = Number(policyMaximumRate);
      if (!Number.isFinite(maximumRate) || maximumRate < 0 || maximumRate > 100) {
        throw new Error("Approval threshold must be between 0 and 100 percent.");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("save_partner_finance_discount_policy", {
        _biz: business.id,
        _maximum_downpayment_discount_rate: maximumRate,
        _approval_required: policyApprovalRequired,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Partner Finance discount policy saved");
      setPolicyDirty(false);
      void qc.invalidateQueries({ queryKey: ["partner-finance", business.id] });
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
        _downpayment_value: Number(downpaymentValue),
        _downpayment_type: downpaymentMode,
        _discount_value: Number(discountValue),
        _discount_type: discountMode,
        _downpayment_account: downpaymentAccountId || null,
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
      return data as {
        invoice_no: string;
        net_downpayment: number;
        discount_approval_status: string;
      };
    },
    onSuccess: (result) => {
      toast.success(
        `Financed sale recorded: ${result.invoice_no}. Net down payment ${bdt(result.net_downpayment)}.`,
      );
      setCustomerId("");
      setVariantId("");
      setImeiId("");
      setApprovalReference("");
      setSaleNotes("");
      setDownpaymentMode("fixed");
      setDownpaymentValue("0");
      setDiscountMode("fixed");
      setDiscountValue("0");
      setDownpaymentAccountId("");
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
      const idempotencyKey = settlementIdempotencyKey || crypto.randomUUID();
      setSettlementIdempotencyKey(idempotencyKey);
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
        _account: settlementAccountId,
        _idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      return data as { status: "matched" | "unmatched"; accounting_status: "posted" };
    },
    onSuccess: (result) => {
      toast.success(
        result.status === "matched"
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
      setSettlementAccountId("");
      setSettlementIdempotencyKey("");
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
  const postImportedSettlement = useMutation({
    mutationFn: async (lineId: string) => {
      if (!settlementAccountId) throw new Error("Select the account that received this payout.");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("post_partner_settlement", {
        _biz: business.id,
        _line: lineId,
        _account: settlementAccountId,
        _idempotency_key: `settlement-post-${lineId}`,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Provider settlement posted to the ledger");
      refresh();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const reverseSettlement = useMutation({
    mutationFn: async ({
      lineId,
      reason,
      date,
      idempotencyKey,
    }: {
      lineId: string;
      reason: string;
      date: string;
      idempotencyKey: string;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("reverse_partner_settlement", {
        _biz: business.id,
        _line: lineId,
        _date: date,
        _idempotency_key: idempotencyKey,
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Provider settlement reversed with matching ledger entries");
      setReversingSettlementId("");
      setSettlementReversalReason("");
      setSettlementReversalKey("");
      refresh();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const receiveInstallment = useMutation({
    mutationFn: async () => {
      if (!selectedInstallment || !paymentAccountId || Number(paymentAmount) <= 0)
        throw new Error("Select an installment, account and positive payment amount.");
      const idempotencyKey = paymentIdempotencyKey || crypto.randomUUID();
      setPaymentIdempotencyKey(idempotencyKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("receive_partner_finance_installment", {
        _biz: business.id,
        _installment: selectedInstallment,
        _account: paymentAccountId,
        _amount: Number(paymentAmount),
        _date: paymentDate,
        _idempotency_key: idempotencyKey,
        _remarks: "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Installment payment recorded and posted");
      setPaymentAmount("");
      setPaymentIdempotencyKey("");
      refresh();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const refundInstallment = useMutation({
    mutationFn: async () => {
      if (
        !selectedPayment ||
        !paymentAccountId ||
        Number(refundAmount) <= 0 ||
        !refundReason.trim()
      )
        throw new Error("Select a payment, refund account, amount and reason.");
      const idempotencyKey = refundIdempotencyKey || crypto.randomUUID();
      setRefundIdempotencyKey(idempotencyKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("refund_partner_finance_payment", {
        _biz: business.id,
        _payment: selectedPayment,
        _account: paymentAccountId,
        _amount: Number(refundAmount),
        _date: paymentDate,
        _idempotency_key: idempotencyKey,
        _reason: refundReason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Installment refund posted as a reversal");
      setRefundAmount("");
      setRefundReason("");
      setRefundIdempotencyKey("");
      refresh();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const refundDownpayment = useMutation({
    mutationFn: async () => {
      const agreement = financeSales.find((sale) => sale.id === selectedDownpaymentAgreement);
      if (
        !agreement?.downpayment_money_transaction_id ||
        !paymentAccountId ||
        Number(downpaymentRefundAmount) <= 0 ||
        !downpaymentRefundReason.trim()
      ) {
        throw new Error("Select a down-payment receipt, refund account, amount and reason.");
      }
      const idempotencyKey = downpaymentRefundIdempotencyKey || crypto.randomUUID();
      setDownpaymentRefundIdempotencyKey(idempotencyKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("refund_partner_finance_downpayment", {
        _biz: business.id,
        _source_money_transaction: agreement.downpayment_money_transaction_id,
        _account: paymentAccountId,
        _amount: Number(downpaymentRefundAmount),
        _date: paymentDate,
        _idempotency_key: idempotencyKey,
        _reason: downpaymentRefundReason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Down-payment refund posted; customer receivable was restored");
      setDownpaymentRefundAmount("");
      setDownpaymentRefundReason("");
      setDownpaymentRefundIdempotencyKey("");
      refresh();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const waiveInstallment = useMutation({
    mutationFn: async () => {
      if (!selectedInstallment || Number(waiverAmount) <= 0 || !waiverReason.trim())
        throw new Error("Select an installment and provide a positive adjustment with a reason.");
      const idempotencyKey = waiverIdempotencyKey || crypto.randomUUID();
      setWaiverIdempotencyKey(idempotencyKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("waive_partner_finance_installment", {
        _biz: business.id,
        _installment: selectedInstallment,
        _amount: Number(waiverAmount),
        _date: paymentDate,
        _idempotency_key: idempotencyKey,
        _reason: waiverReason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Approved installment adjustment posted");
      setWaiverAmount("");
      setWaiverReason("");
      setWaiverIdempotencyKey("");
      refresh();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const assignBranchAccess = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!accessUserId || !accessBranchId) throw new Error("Select a member and brand shop.");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("assign_partner_finance_branch_access", {
        _biz: business.id,
        _user: accessUserId,
        _branch: accessBranchId,
        _enabled: enabled,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Partner Finance shop access updated");
      void qc.invalidateQueries({ queryKey: ["partner-finance-branch-access", business.id] });
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

  const totalSettled = visibleSales.reduce((sum, sale) => sum + number(sale.settled_amount), 0);
  const netSettlement = number(grossAmount) - number(feeAmount) + number(adjustmentAmount);
  const chosenVariant = phoneStock.find((item) => item.variant_id === variantId)?.product_variants;
  const reportingSummaries = [
    {
      title: "Monthly summary",
      rows: (snapshot.data?.monthly_summary ?? []).map((row) => ({
        period: row.month,
        agreement_count: row.agreement_count,
        contract_value: row.contract_value,
      })),
    },
    {
      title: "Yearly summary",
      rows: (snapshot.data?.yearly_summary ?? []).map((row) => ({
        period: String(row.year),
        agreement_count: row.agreement_count,
        contract_value: row.contract_value,
      })),
    },
  ];
  const discountPolicy = snapshot.data?.discount_policy ?? {
    maximum_downpayment_discount_rate: 0,
    approval_required: true,
  };
  const downpaymentCalculation = calculatePartnerFinanceDownpayment({
    totalPrice: Number(salePrice),
    downpaymentMode,
    downpaymentValue: Number(downpaymentValue),
    discountMode,
    discountValue: Number(discountValue),
    maximumDiscountRate: number(discountPolicy.maximum_downpayment_discount_rate),
    approvalRequired: discountPolicy.approval_required,
  });
  const accountRequired = downpaymentCalculation.netDownpayment > 0;
  const validSale =
    !!branchId &&
    !!customerId &&
    !!providerId &&
    !!variantId &&
    !!imeiId &&
    downpaymentCalculation.errors.length === 0 &&
    (!accountRequired || !!downpaymentAccountId) &&
    (!accountRequired || !moneyAccounts.error) &&
    (!downpaymentCalculation.requiresApproval || canApproveDiscount) &&
    Number(expectedSettlement) > 0 &&
    Number(installmentCount) > 0 &&
    Number(installmentAmount) > 0 &&
    Number(customerRepayment) > 0 &&
    !!approvalReference.trim();
  const collectionChartRows = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const transaction of snapshot.data?.transactions ?? []) {
      if (
        transaction.status !== "posted" ||
        (transaction.event_type !== "payment" && transaction.event_type !== "refund")
      ) {
        continue;
      }
      const key =
        collectionChartPeriod === "daily"
          ? transaction.transaction_date
          : transaction.transaction_date.slice(0, 7);
      grouped.set(
        key,
        (grouped.get(key) ?? 0) +
          (transaction.event_type === "payment" ? 1 : -1) * number(transaction.amount),
      );
    }
    const end = new Date(`${reportTo || today()}T00:00:00Z`);
    const keys =
      collectionChartPeriod === "daily"
        ? Array.from({ length: 14 }, (_, index) => {
            const date = new Date(end);
            date.setUTCDate(date.getUTCDate() - (13 - index));
            return date.toISOString().slice(0, 10);
          }).filter((date) => !reportFrom || date >= reportFrom)
        : Array.from({ length: 6 }, (_, index) => {
            const date = new Date(
              Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (5 - index), 1),
            );
            return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
          }).filter((month) => !reportFrom || month >= reportFrom.slice(0, 7));
    return keys.map((key) => ({ key, amount: grouped.get(key) ?? 0 }));
  }, [collectionChartPeriod, reportFrom, reportTo, snapshot.data?.transactions]);
  const collectionChartMax = Math.max(1, ...collectionChartRows.map((row) => Math.abs(row.amount)));

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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Partner Finance"
        sub="Record brand-shop financed sales, discount approvals and down-payment receipts with linked ledger entries; reconcile provider settlements."
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
            ["collections", "Installments & ledger"],
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
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
        <F label="Customer filter">
          <select
            className={selectCls}
            value={reportCustomerId}
            onChange={(event) => setReportCustomerId(event.target.value)}
          >
            <option value="">All customers</option>
            {(snapshot.data?.customers ?? []).map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name} {customer.mobile ? `· ${customer.mobile}` : ""}
              </option>
            ))}
          </select>
        </F>
        <F label="Status / transaction type">
          <div className="flex gap-2">
            <select
              className={selectCls}
              value={reportStatus}
              onChange={(event) => setReportStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {[
                "active",
                "cancelled",
                "pending",
                "partial",
                "overdue",
                "paid",
                "matched",
                "unmatched",
                "posted",
                "reversed",
              ].map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <select
              className={selectCls}
              value={reportTransactionType}
              onChange={(event) => setReportTransactionType(event.target.value)}
            >
              <option value="">All transactions</option>
              {["agreement", "payment", "refund", "downpayment_refund", "waiver"].map((type) => (
                <option key={type} value={type}>
                  {type.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>
        </F>
      </div>

      {snapshot.isError && (
        <p className="text-sm text-destructive">{friendlyError(snapshot.error)}</p>
      )}

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              [
                "Partner-financed sales",
                number(snapshot.data?.summary?.agreement_count).toString(),
              ],
              ["Total contract value", bdt(number(snapshot.data?.summary?.contract_value))],
              ["Settlement received", bdt(totalSettled)],
              [
                "Partner receivable outstanding",
                bdt(number(snapshot.data?.summary?.partner_receivable_outstanding)),
              ],
              [
                "Provider settlement fees",
                bdt(number(snapshot.data?.summary?.settlement_fee_total)),
              ],
              [
                "Provider settlement adjustments",
                bdt(number(snapshot.data?.summary?.settlement_adjustment_total)),
              ],
              [
                "Scheduled down payments",
                bdt(number(snapshot.data?.summary?.scheduled_downpayment)),
              ],
              ["Down-payment discounts", bdt(number(snapshot.data?.summary?.downpayment_discount))],
              ["Net down payments", bdt(number(snapshot.data?.summary?.net_downpayment))],
              [
                "Installments collected",
                bdt(number(snapshot.data?.summary?.installment_collected)),
              ],
              ["Customer due", bdt(number(snapshot.data?.summary?.customer_due))],
              [
                "Overdue installments",
                number(snapshot.data?.summary?.overdue_installments).toString(),
              ],
              ["Refunds", bdt(number(snapshot.data?.summary?.refund_total))],
              ["Installment adjustments", bdt(number(snapshot.data?.summary?.installment_waivers))],
            ].map(([label, value]) => (
              <div
                key={label}
                className="min-w-0 overflow-hidden rounded-lg border bg-card p-3 sm:p-4"
              >
                <div className="break-words text-sm text-muted-foreground">{label}</div>
                <div className="num mt-1 break-all text-lg font-semibold sm:text-xl">{value}</div>
              </div>
            ))}
          </div>
          <section className="rounded-lg border bg-card p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Customer collection trend</h2>
                <p className="text-sm text-muted-foreground">
                  Posted installment payments minus posted refunds in the selected report scope.
                </p>
              </div>
              <div className="flex gap-2">
                {(["daily", "monthly"] as const).map((period) => (
                  <Button
                    key={period}
                    type="button"
                    size="sm"
                    variant={collectionChartPeriod === period ? "default" : "outline"}
                    onClick={() => setCollectionChartPeriod(period)}
                  >
                    {period === "daily" ? "Daily" : "Monthly"}
                  </Button>
                ))}
              </div>
            </div>
            {snapshot.isPending ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Loading collection history…
              </p>
            ) : collectionChartRows.length === 0 ||
              collectionChartRows.every((row) => row.amount === 0) ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No collection data in this reporting period.
              </p>
            ) : (
              <div
                className="grid min-h-48 grid-flow-col auto-cols-fr items-end gap-2 border-b px-1"
                role="img"
                aria-label={`${collectionChartPeriod} net customer collections`}
              >
                {collectionChartRows.map((row) => (
                  <div key={row.key} className="flex h-full min-w-0 flex-col justify-end gap-2">
                    <span className="truncate text-center text-[10px] text-muted-foreground">
                      {bdt(row.amount)}
                    </span>
                    <div
                      className={`min-h-1 rounded-t bg-primary ${row.amount < 0 ? "bg-destructive" : ""}`}
                      style={{
                        height: `${Math.max(3, (Math.abs(row.amount) / collectionChartMax) * 100)}%`,
                      }}
                      title={`${row.key}: ${bdt(row.amount)}`}
                    />
                    <span className="truncate text-center text-[10px] text-muted-foreground">
                      {collectionChartPeriod === "daily" ? row.key.slice(5) : row.key}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            {reportingSummaries.map((summary) => (
              <section key={summary.title} className="overflow-x-auto rounded-lg border bg-card">
                <h2 className="border-b p-3 text-sm font-semibold">{summary.title}</h2>
                <table className="w-full min-w-[360px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-muted-foreground">
                      <th className="p-3">Period</th>
                      <th className="text-right">Agreements</th>
                      <th className="text-right">Contract value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.rows.map((row) => (
                      <tr key={row.period} className="border-t">
                        <td className="p-3">{row.period}</td>
                        <td className="num text-right">{row.agreement_count}</td>
                        <td className="num text-right">{bdt(number(row.contract_value))}</td>
                      </tr>
                    ))}
                    {!summary.rows.length && (
                      <tr>
                        <td colSpan={3} className="p-4 text-center text-muted-foreground">
                          No data for this reporting period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[1180px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="p-3">Invoice / date</th>
                  <th>Provider</th>
                  <th>Shop / customer</th>
                  <th className="text-right">Sale</th>
                  <th className="text-right">Scheduled down payment</th>
                  <th className="text-right">Discount</th>
                  <th className="text-right">Net collected</th>
                  <th className="text-right">Expected payout</th>
                  <th className="text-right">Received</th>
                  <th>Discount approval</th>
                  <th>Settlement</th>
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
                    <td className="num text-right">{bdt(number(sale.discount_amount))}</td>
                    <td className="num text-right">{bdt(number(sale.net_downpayment))}</td>
                    <td className="num text-right">{bdt(number(sale.expected_settlement))}</td>
                    <td className="num text-right">{bdt(number(sale.settled_amount))}</td>
                    <td>
                      <Badge
                        variant={
                          sale.discount_approval_status === "approved" ? "secondary" : "outline"
                        }
                      >
                        {sale.discount_approval_status === "approved" ? "Approved" : "Not required"}
                      </Badge>
                      {sale.discount_approval_status === "approved" && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          <div title={sale.discount_approved_by ?? undefined}>
                            Approved by{" "}
                            {sale.discount_approved_by_name ??
                              sale.discount_approved_by?.slice(0, 8) ??
                              "—"}
                          </div>
                          <div>
                            {sale.discount_approved_at
                              ? new Date(sale.discount_approved_at).toLocaleString()
                              : ""}
                          </div>
                        </div>
                      )}
                    </td>
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
                    <td colSpan={11} className="p-8 text-center text-muted-foreground">
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
            The sale, stock and IMEI update, net down-payment receipt, discount and balanced journal
            entries are posted atomically. The financed amount is total price minus scheduled down
            payment; the down-payment discount is not deducted from it.
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
                  setDownpaymentAccountId("");
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
                {(customerOptions.data ?? []).map((item) => (
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
            <F label="Down payment type">
              <select
                className={selectCls}
                value={downpaymentMode}
                onChange={(e) => setDownpaymentMode(e.target.value as "fixed" | "percentage")}
              >
                <option value="fixed">Fixed amount</option>
                <option value="percentage">Percentage of total price</option>
              </select>
            </F>
            <F
              label={
                downpaymentMode === "percentage"
                  ? "Down payment rate (%)"
                  : "Scheduled down payment amount"
              }
            >
              <Input
                type="number"
                min="0"
                max={downpaymentMode === "percentage" ? "100" : undefined}
                step="0.01"
                value={downpaymentValue}
                onChange={(e) => setDownpaymentValue(e.target.value)}
              />
            </F>
            <F label="Down-payment discount type">
              <select
                className={selectCls}
                value={discountMode}
                onChange={(e) => setDiscountMode(e.target.value as "fixed" | "percentage")}
              >
                <option value="fixed">Fixed amount</option>
                <option value="percentage">Percentage of down payment</option>
              </select>
            </F>
            <F label={discountMode === "percentage" ? "Discount rate (%)" : "Discount amount"}>
              <Input
                type="number"
                min="0"
                max={discountMode === "percentage" ? "100" : undefined}
                step="0.01"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
              />
            </F>
            {accountRequired && (
              <F label="Receive down payment into">
                <select
                  className={selectCls}
                  value={downpaymentAccountId}
                  onChange={(e) => setDownpaymentAccountId(e.target.value)}
                  disabled={moneyAccounts.isPending}
                >
                  <option value="">Select active cash / bank account</option>
                  {(moneyAccounts.data ?? [])
                    .filter((account) => !account.branch_id || account.branch_id === branchId)
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                        {account.branch_id ? " · this shop" : " · shared"}
                      </option>
                    ))}
                </select>
              </F>
            )}
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
          <section
            aria-label="Down payment and finance calculation"
            className="mt-4 grid min-w-0 gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <h3 className="font-medium sm:col-span-2 lg:col-span-4">Payment preview</h3>
            <Calculation
              label="Scheduled down payment"
              value={bdt(downpaymentCalculation.downpayment)}
            />
            <Calculation
              label="Discount"
              value={`− ${bdt(downpaymentCalculation.discountAmount)}`}
            />
            <Calculation
              label="Net amount collected"
              value={bdt(downpaymentCalculation.netDownpayment)}
            />
            <Calculation
              label="Remaining finance amount"
              value={bdt(downpaymentCalculation.financedAmount)}
            />
          </section>
          {downpaymentCalculation.errors.length > 0 && (
            <ul className="mt-3 list-inside list-disc text-sm text-destructive">
              {downpaymentCalculation.errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
          {downpaymentCalculation.requiresApproval && !canApproveDiscount && (
            <p className="mt-3 text-sm text-destructive">
              This discount is above the configured{" "}
              {discountPolicy.maximum_downpayment_discount_rate}% approval limit. An owner or
              manager must approve and record the agreement.
            </p>
          )}
          {downpaymentCalculation.requiresApproval && canApproveDiscount && (
            <p className="mt-3 text-sm text-amber-700">
              This discount exceeds the configured limit and will be recorded as approved by you.
            </p>
          )}
          {accountRequired && moneyAccounts.error && (
            <p className="mt-3 text-sm text-destructive">
              Could not load cash / bank accounts: {friendlyError(moneyAccounts.error)}
            </p>
          )}
          {accountRequired &&
            !moneyAccounts.isPending &&
            !moneyAccounts.error &&
            moneyAccounts.data?.length === 0 && (
              <p className="mt-3 text-sm text-destructive">
                No active cash or bank account is available for this shop. Configure a money account
                before recording a collected down payment.
              </p>
            )}
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
            {createSale.isPending ? "Posting financed sale…" : "Post financed sale"}
          </Button>
        </section>
      )}

      {tab === "collections" && (
        <div className="space-y-4">
          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-1 font-semibold">Installments, payments and reversals</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Collections and refunds post to the selected shop account and the provider receivable
              ledger in one transaction. Refunds and approved installment adjustments are separate
              audited postings; posted records cannot be edited or deleted.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <F label="Installment">
                <select
                  className={selectCls}
                  value={selectedInstallment}
                  onChange={(event) => setSelectedInstallment(event.target.value)}
                >
                  <option value="">Select outstanding installment</option>
                  {(snapshot.data?.installments ?? [])
                    .filter((item) => number(item.outstanding) > 0)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.branch_name} · {item.customer_name} · {item.invoice_no} · #
                        {item.installment_no} · {bdt(number(item.outstanding))}
                      </option>
                    ))}
                </select>
              </F>
              <F label="Payment amount">
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                />
              </F>
              <F label="Receipt account">
                <select
                  className={selectCls}
                  value={paymentAccountId}
                  onChange={(event) => setPaymentAccountId(event.target.value)}
                >
                  <option value="">Select cash / bank / MFS account</option>
                  {(moneyAccounts.data ?? [])
                    .filter((account) => {
                      const target = snapshot.data?.installments.find(
                        (item) => item.id === selectedInstallment,
                      )?.branch_id;
                      return !account.branch_id || account.branch_id === target;
                    })
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} · {account.kind.toUpperCase()}
                      </option>
                    ))}
                </select>
              </F>
              <F label="Transaction date">
                <Input
                  type="date"
                  max={today()}
                  value={paymentDate}
                  onChange={(event) => setPaymentDate(event.target.value)}
                />
              </F>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                disabled={
                  !selectedInstallment ||
                  !paymentAccountId ||
                  Number(paymentAmount) <= 0 ||
                  receiveInstallment.isPending
                }
                onClick={() => receiveInstallment.mutate()}
              >
                Record installment payment
              </Button>
              {canReconcile && (
                <Button
                  variant="outline"
                  disabled={
                    !selectedInstallment ||
                    Number(waiverAmount) <= 0 ||
                    !waiverReason.trim() ||
                    waiveInstallment.isPending
                  }
                  onClick={() => waiveInstallment.mutate()}
                >
                  Approve adjustment / write-off
                </Button>
              )}
            </div>
            {canReconcile && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <F label="Adjustment / write-off amount">
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={waiverAmount}
                    onChange={(event) => setWaiverAmount(event.target.value)}
                  />
                </F>
                <F label="Approval reason">
                  <Input
                    value={waiverReason}
                    onChange={(event) => setWaiverReason(event.target.value)}
                  />
                </F>
              </div>
            )}
          </section>

          {canReconcile && (
            <section className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-lg border bg-card p-4">
                <h2 className="font-semibold">Refund an installment payment</h2>
                <div className="mt-3 grid gap-3">
                  <F label="Original payment">
                    <select
                      className={selectCls}
                      value={selectedPayment}
                      onChange={(event) => setSelectedPayment(event.target.value)}
                    >
                      <option value="">Select original installment payment</option>
                      {(snapshot.data?.transactions ?? [])
                        .filter((item) => item.event_type === "payment")
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.transaction_date} · {item.customer_name} ·{" "}
                            {bdt(number(item.amount))}
                          </option>
                        ))}
                    </select>
                  </F>
                  <F label="Refund amount">
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={refundAmount}
                      onChange={(event) => setRefundAmount(event.target.value)}
                    />
                  </F>
                  <F label="Refund reason">
                    <Input
                      value={refundReason}
                      onChange={(event) => setRefundReason(event.target.value)}
                    />
                  </F>
                  <Button
                    variant="outline"
                    disabled={
                      !selectedPayment ||
                      !paymentAccountId ||
                      Number(refundAmount) <= 0 ||
                      !refundReason.trim() ||
                      refundInstallment.isPending
                    }
                    onClick={() => refundInstallment.mutate()}
                  >
                    Post installment refund
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <h2 className="font-semibold">Refund a down-payment collection</h2>
                <div className="mt-3 grid gap-3">
                  <F label="Down-payment receipt">
                    <select
                      className={selectCls}
                      value={selectedDownpaymentAgreement}
                      onChange={(event) => setSelectedDownpaymentAgreement(event.target.value)}
                    >
                      <option value="">Select agreement with a recorded receipt</option>
                      {financeSales
                        .filter((sale) => sale.downpayment_money_transaction_id)
                        .map((sale) => (
                          <option key={sale.id} value={sale.id}>
                            {sale.branch_name} · {sale.customer_name} · {sale.invoice_no} ·{" "}
                            {bdt(number(sale.net_downpayment))}
                          </option>
                        ))}
                    </select>
                  </F>
                  <F label="Refund amount">
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={downpaymentRefundAmount}
                      onChange={(event) => setDownpaymentRefundAmount(event.target.value)}
                    />
                  </F>
                  <F label="Refund reason">
                    <Input
                      value={downpaymentRefundReason}
                      onChange={(event) => setDownpaymentRefundReason(event.target.value)}
                    />
                  </F>
                  <Button
                    variant="outline"
                    disabled={
                      !selectedDownpaymentAgreement ||
                      !paymentAccountId ||
                      Number(downpaymentRefundAmount) <= 0 ||
                      !downpaymentRefundReason.trim() ||
                      refundDownpayment.isPending
                    }
                    onClick={() => refundDownpayment.mutate()}
                  >
                    Post down-payment refund
                  </Button>
                </div>
              </div>
            </section>
          )}

          <section className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="p-3">Due date / installment</th>
                  <th>Shop / customer</th>
                  <th>Invoice</th>
                  <th className="text-right">Scheduled</th>
                  <th className="text-right">Collected</th>
                  <th className="text-right">Waived</th>
                  <th className="text-right">Due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(snapshot.data?.installments ?? []).map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="p-3">
                      {item.due_date} · #{item.installment_no}
                    </td>
                    <td>
                      {item.branch_name}
                      <div className="text-xs text-muted-foreground">{item.customer_name}</div>
                    </td>
                    <td>{item.invoice_no}</td>
                    <td className="num text-right">{bdt(number(item.scheduled_amount))}</td>
                    <td className="num text-right">{bdt(number(item.paid_amount))}</td>
                    <td className="num text-right">{bdt(number(item.waived_amount))}</td>
                    <td className="num text-right">{bdt(number(item.outstanding))}</td>
                    <td>
                      <Badge
                        variant={
                          item.status === "overdue"
                            ? "destructive"
                            : item.status === "paid"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {item.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
                {!snapshot.data?.installments.length && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      No installments in this report scope.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
          <section className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="p-3">Date</th>
                  <th>Shop / customer</th>
                  <th>Type</th>
                  <th className="text-right">Amount</th>
                  <th>Approval / reason</th>
                  <th>Money transaction</th>
                  <th>Journal entry</th>
                </tr>
              </thead>
              <tbody>
                {(snapshot.data?.transactions ?? []).map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="p-3">{item.transaction_date}</td>
                    <td>
                      {item.branch_name}
                      <div className="text-xs text-muted-foreground">{item.customer_name}</div>
                    </td>
                    <td>{item.event_type.replaceAll("_", " ")}</td>
                    <td className="num text-right">{bdt(number(item.amount))}</td>
                    <td>
                      {item.approved_by
                        ? `Approved · ${item.approved_by.slice(0, 8)}`
                        : (item.remarks ?? "—")}
                    </td>
                    <td className="font-mono text-xs">
                      {item.money_transaction_id?.slice(0, 8) ?? "—"}
                    </td>
                    <td className="font-mono text-xs">
                      {item.journal_entry_id?.slice(0, 8) ?? "—"}
                    </td>
                  </tr>
                ))}
                {!snapshot.data?.transactions.length && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      No finance transactions in this report scope.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
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
              <F label="Payout account">
                <select
                  className={selectCls}
                  value={settlementAccountId}
                  onChange={(e) => setSettlementAccountId(e.target.value)}
                >
                  <option value="">Select cash / bank / MFS account</option>
                  {(moneyAccounts.data ?? []).map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {account.kind.toUpperCase()}
                    </option>
                  ))}
                </select>
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
                !settlementAccountId ||
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
                  <th>Accounting</th>
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
                      <Badge
                        variant={line.accounting_status === "posted" ? "secondary" : "outline"}
                      >
                        {line.accounting_status}
                      </Badge>
                      {line.reversal_journal_entry_id && (
                        <div
                          className="mt-1 text-xs text-muted-foreground"
                          title={line.reversal_journal_entry_id}
                        >
                          Reversal journal {line.reversal_journal_entry_id.slice(0, 8)}
                          {line.reversal_reason ? ` · ${line.reversal_reason}` : ""}
                          {line.reversed_by ? ` · by ${line.reversed_by.slice(0, 8)}` : ""}
                          {line.reversed_at
                            ? ` · ${new Date(line.reversed_at).toLocaleDateString()}`
                            : ""}
                        </div>
                      )}
                      {line.accounting_status === "unposted" && canReconcile && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-2"
                          disabled={!settlementAccountId || postImportedSettlement.isPending}
                          onClick={() => postImportedSettlement.mutate(line.id)}
                        >
                          Post
                        </Button>
                      )}
                      {line.accounting_status === "posted" && canReconcile && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-2"
                          onClick={() => {
                            setReversingSettlementId(line.id);
                            setSettlementReversalReason("");
                            setSettlementReversalDate(today());
                            setSettlementReversalKey(crypto.randomUUID());
                          }}
                        >
                          Reverse
                        </Button>
                      )}
                      {reversingSettlementId === line.id && (
                        <form
                          className="mt-2 grid min-w-56 gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            reverseSettlement.mutate({
                              lineId: line.id,
                              reason: settlementReversalReason,
                              date: settlementReversalDate,
                              idempotencyKey: settlementReversalKey,
                            });
                          }}
                        >
                          <Input
                            type="date"
                            max={today()}
                            value={settlementReversalDate}
                            onChange={(event) => setSettlementReversalDate(event.target.value)}
                          />
                          <Input
                            value={settlementReversalReason}
                            minLength={3}
                            placeholder="Reason for reversal"
                            onChange={(event) => setSettlementReversalReason(event.target.value)}
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={
                                reverseSettlement.isPending ||
                                !settlementReversalDate ||
                                settlementReversalReason.trim().length < 3
                              }
                            >
                              Confirm reversal
                            </Button>
                            <Button
                              size="sm"
                              type="button"
                              variant="outline"
                              onClick={() => setReversingSettlementId("")}
                            >
                              Cancel
                            </Button>
                          </div>
                        </form>
                      )}
                    </td>
                    <td>
                      {line.status === "unmatched" &&
                      line.accounting_status !== "reversed" &&
                      canReconcile ? (
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
                    <td colSpan={9} className="p-8 text-center text-muted-foreground">
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
        <div className="space-y-4">
          {canManageProviders && (
            <section className="rounded-lg border bg-card p-4">
              <h2 className="font-semibold">Shop access for branch-scoped members</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Owners, managers and accountants have central access. Branch managers, sales staff
                and store keepers can see only shops explicitly assigned here.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                <F label="Member">
                  <select
                    className={selectCls}
                    value={accessUserId}
                    onChange={(event) => setAccessUserId(event.target.value)}
                  >
                    <option value="">Select member</option>
                    {(assignableMembers.data ?? []).map((member) => (
                      <option key={member.user_id} value={member.user_id}>
                        {member.display_name || member.user_id} · {member.role.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </F>
                <F label="Brand shop">
                  <select
                    className={selectCls}
                    value={accessBranchId}
                    onChange={(event) => setAccessBranchId(event.target.value)}
                  >
                    <option value="">Select shop</option>
                    {activeBranches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </F>
                {(() => {
                  const granted = (branchAccess.data ?? []).some(
                    (entry) => entry.user_id === accessUserId && entry.branch_id === accessBranchId,
                  );
                  return (
                    <Button
                      variant={granted ? "outline" : "default"}
                      disabled={!accessUserId || !accessBranchId || assignBranchAccess.isPending}
                      onClick={() => assignBranchAccess.mutate(!granted)}
                    >
                      {assignBranchAccess.isPending
                        ? "Saving…"
                        : granted
                          ? "Revoke access"
                          : "Grant access"}
                    </Button>
                  );
                })()}
              </div>
              {branchAccess.error && (
                <p className="mt-2 text-sm text-destructive">
                  Could not load shop assignments: {friendlyError(branchAccess.error)}
                </p>
              )}
              {assignableMembers.error && (
                <p className="mt-2 text-sm text-destructive">
                  Could not load assignable members: {friendlyError(assignableMembers.error)}
                </p>
              )}
              {!!branchAccess.data?.length && (
                <div className="mt-4 divide-y rounded border">
                  {branchAccess.data.map((entry) => (
                    <div
                      key={`${entry.user_id}-${entry.branch_id}`}
                      className="flex flex-wrap justify-between gap-2 p-2 text-sm"
                    >
                      <span>
                        {assignableMembers.data?.find((member) => member.user_id === entry.user_id)
                          ?.display_name ?? entry.user_id}
                      </span>
                      <span className="text-muted-foreground">
                        {activeBranches.find((branch) => branch.id === entry.branch_id)?.name ??
                          entry.branch_id}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          {canManageProviders && (
            <section className="rounded-lg border bg-card p-4">
              <h2 className="font-semibold">Discount approval policy</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The threshold is measured against the scheduled down payment. Discounts above it
                require owner or manager approval before the agreement can be posted.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-end">
                <F label="Maximum discount without approval (%)">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={policyMaximumRate}
                    onChange={(event) => {
                      setPolicyDirty(true);
                      setPolicyMaximumRate(event.target.value);
                    }}
                  />
                </F>
                <label className="flex min-h-9 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={policyApprovalRequired}
                    onChange={(event) => {
                      setPolicyDirty(true);
                      setPolicyApprovalRequired(event.target.checked);
                    }}
                    className="h-4 w-4 accent-primary"
                  />
                  Require approval above this limit
                </label>
                <Button
                  onClick={() => saveDiscountPolicy.mutate()}
                  disabled={saveDiscountPolicy.isPending}
                >
                  {saveDiscountPolicy.isPending ? "Saving…" : "Save policy"}
                </Button>
              </div>
            </section>
          )}
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
                    onChange={(e) =>
                      setProviderForm({ ...providerForm, legal_name: e.target.value })
                    }
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
                disabled={
                  !canManageProviders || !providerForm.name.trim() || saveProvider.isPending
                }
                onClick={() => saveProvider.mutate()}
              >
                {editingProvider ? "Update provider" : "Save provider"}
              </Button>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function Calculation({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="break-words text-xs text-muted-foreground">{label}</div>
      <div className="num mt-1 break-all text-sm font-semibold sm:text-base">{value}</div>
    </div>
  );
}
