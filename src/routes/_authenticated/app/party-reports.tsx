import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, FileText, Share2 } from "lucide-react";
import { PageHeader } from "@/components/erp/EntityManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { useBranches } from "@/lib/finance";
import { download, makePdf, makeXlsx, shareFile, type Sheet } from "@/lib/export";
import {
  balanceAsOf,
  groupPartyEvents,
  outstandingDues,
  selectReportColumns,
  type DatedBalanceChange,
  type PartyDueRow,
  type PartyKind,
  type PartyReportEvent,
  type PartyReportGroup,
  type PartyReportMode,
  type ReportPeriod,
} from "@/lib/party-report";
import { selectCls, Stat } from "@/components/erp/ui";

export const Route = createFileRoute("/_authenticated/app/party-reports")({
  head: () => ({
    meta: [
      { title: "Party transactions & dues" },
      { name: "description", content: "Date-filtered customer, dealer, and supplier reports." },
    ],
  }),
  component: PartyReports,
});

type PartyFilter = "all" | PartyKind;
type PeriodPreset = "daily" | "weekly" | "monthly" | "custom";
type Filters = {
  partyFilter: PartyFilter;
  party: string;
  branch: string;
  from: string;
  to: string;
  periodPreset: PeriodPreset;
  period: ReportPeriod;
  mode: PartyReportMode;
  dueOnly: boolean;
  minimumDue: string;
};

type DbRow = { data: unknown[] | null; error: { message: string } | null };

async function loadAll<T>(query: (from: number, to: number) => PromiseLike<DbRow>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw error;
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function presetDates(preset: PeriodPreset, today = new Date()) {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (preset === "daily") return { from: localDate(end), to: localDate(end) };
  if (preset === "weekly") {
    const start = new Date(end);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return { from: localDate(start), to: localDate(end) };
  }
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  return { from: localDate(start), to: localDate(end) };
}

const GROUP_COLUMNS = [
  ["period", "Day / period"],
  ["branch", "Branch"],
  ["party", "Party"],
  ["type", "Party type"],
  ["sales", "Sales"],
  ["paymentsIn", "Customer receipts"],
  ["salesReturns", "Sales returns"],
  ["refundsOut", "Refunds paid"],
  ["purchases", "Purchases"],
  ["paymentsOut", "Supplier payments"],
  ["purchaseReturns", "Purchase returns"],
  ["refundsIn", "Refunds received"],
] as const;
const DUE_COLUMNS = [
  ["branch", "Branch"],
  ["party", "Party"],
  ["type", "Party type"],
  ["currentDue", "Balance as of report end"],
] as const;

const kindLabel = (kind: PartyKind) =>
  kind === "dealer" ? "Dealer" : kind === "supplier" ? "Supplier" : "Customer";
const isDealerType = (type: string | null) => /dealer|wholesale|sub_dealer/i.test(type ?? "");
const optionKey = (row: PartyDueRow) => `${row.partyKind}:${row.partyId}:${row.branchId ?? "all"}`;

function PartyReports() {
  const { business, role, userId, access } = useBusiness();
  const queryClient = useQueryClient();
  const branchesQuery = useBranches(business.id);
  const isCentral = ["owner", "manager", "accountant"].includes(role);
  const canViewSuppliers =
    isCentral &&
    (role === "owner" ||
      (access.suppliers?.view === true &&
        access.supplier_payments?.view === true &&
        access.purchases?.view === true));
  const canExport = access.ledger?.export === true || role === "owner";
  const branchAccess = useQuery({
    queryKey: ["party-report-branch-access", business.id, userId],
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
  const allowedBranches = useMemo(
    () =>
      (branchesQuery.data ?? []).filter(
        (branch) =>
          branch.kind === "branch" && (isCentral || (branchAccess.data ?? []).includes(branch.id)),
      ),
    [branchesQuery.data, isCentral, branchAccess.data],
  );
  const [filters, setFilters] = useState<Filters>(() => {
    const dates = presetDates("weekly");
    return {
      partyFilter: "all",
      party: "",
      branch: "all",
      ...dates,
      periodPreset: "weekly",
      period: "week",
      mode: "transactions",
      dueOnly: true,
      minimumDue: "",
    };
  });
  const [columns, setColumns] = useState<string[]>(GROUP_COLUMNS.map(([key]) => key));
  const [reportName, setReportName] = useState("");
  const [savedReportId, setSavedReportId] = useState("");
  const [busy, setBusy] = useState(false);

  const reportBranches = useMemo(
    () =>
      filters.branch === "all"
        ? allowedBranches
        : allowedBranches.filter((branch) => branch.id === filters.branch),
    [allowedBranches, filters.branch],
  );
  const branchIds = reportBranches.map((branch) => branch.id);
  const branchNameById = useMemo(
    () => new Map(allowedBranches.map((branch) => [branch.id, branch.name])),
    [allowedBranches],
  );
  const supplierScopeAllowed =
    canViewSuppliers &&
    filters.branch === "all" &&
    filters.partyFilter !== "customer" &&
    filters.partyFilter !== "dealer";
  const wantsCustomer =
    filters.partyFilter === "all" ||
    filters.partyFilter === "customer" ||
    filters.partyFilter === "dealer";
  const today = localDate(new Date());
  const canLoadReport =
    (branchIds.length > 0 || supplierScopeAllowed) &&
    filters.from <= filters.to &&
    filters.to <= today;

  const report = useQuery({
    queryKey: [
      "party-financial-report",
      business.id,
      role,
      filters.partyFilter,
      filters.party,
      filters.branch,
      filters.from,
      filters.to,
      filters.mode,
    ],
    enabled: canLoadReport,
    queryFn: async (): Promise<{ events: PartyReportEvent[]; dues: PartyDueRow[] }> => {
      const [branchBalances, supplierBalances] = await Promise.all([
        wantsCustomer && branchIds.length > 0
          ? loadAll<{
              branch_id: string | null;
              customer_id: string | null;
              name: string | null;
              type: string | null;
              current_due: number | null;
            }>((from, to) =>
              supabase
                .from("customer_branch_balances")
                .select("branch_id,customer_id,name,type,current_due")
                .eq("business_id", business.id)
                .in("branch_id", branchIds)
                .order("name")
                .order("branch_id")
                .order("customer_id")
                .range(from, to),
            )
          : Promise.resolve([]),
        supplierScopeAllowed
          ? loadAll<{
              supplier_id: string | null;
              name: string | null;
              current_payable: number | null;
            }>((from, to) =>
              supabase
                .from("supplier_balances")
                .select("supplier_id,name,current_payable")
                .eq("business_id", business.id)
                .order("name")
                .order("supplier_id")
                .range(from, to),
            )
          : Promise.resolve([]),
      ]);

      const selectedCustomerBalances = branchBalances.filter((row) => {
        const kind: PartyKind = isDealerType(row.type) ? "dealer" : "customer";
        return (
          row.customer_id &&
          row.branch_id &&
          (filters.partyFilter === "all" || filters.partyFilter === kind) &&
          (!filters.party || filters.party === `${kind}:${row.customer_id}:${row.branch_id}`)
        );
      });
      const selectedCustomerKeys = new Set(
        selectedCustomerBalances.map((row) => `${row.customer_id}:${row.branch_id}`),
      );
      const selectedCustomerIds = [
        ...new Set(
          selectedCustomerBalances.flatMap((row) => (row.customer_id ? [row.customer_id] : [])),
        ),
      ];
      const suppliersById = new Map(
        supplierBalances.filter((row) => row.supplier_id).map((row) => [row.supplier_id!, row]),
      );
      const selectedSupplierIds = [...suppliersById.keys()].filter(
        (id) => !filters.party || filters.party === `supplier:${id}:all`,
      );
      const customerDueRows: PartyDueRow[] = selectedCustomerBalances.map((row) => ({
        partyId: row.customer_id!,
        partyName: row.name ?? row.customer_id!,
        partyKind: isDealerType(row.type) ? "dealer" : "customer",
        branchName: branchNameById.get(row.branch_id!) ?? "Branch",
        branchId: row.branch_id!,
        currentDue: Number(row.current_due ?? 0),
      }));
      const supplierDueRows: PartyDueRow[] = selectedSupplierIds.map((id) => ({
        partyId: id,
        partyName: suppliersById.get(id)?.name ?? id,
        partyKind: "supplier",
        branchName: "All branches",
        currentDue: Number(suppliersById.get(id)?.current_payable ?? 0),
      }));
      const eventStart = new Date(`${filters.to}T00:00:00`);
      eventStart.setDate(eventStart.getDate() + 1);
      const eventFrom = filters.mode === "dues" ? localDate(eventStart) : filters.from;

      const customerEventsPromise =
        selectedCustomerKeys.size > 0
          ? Promise.all([
              loadAll<{
                id: string;
                customer_id: string | null;
                branch_id: string;
                sale_date: string;
                total: number;
              }>((from, to) =>
                supabase
                  .from("sales")
                  .select("id,customer_id,branch_id,sale_date,total")
                  .eq("business_id", business.id)
                  .eq("status", "posted")
                  .eq("partner_financed", false)
                  .in("branch_id", branchIds)
                  .in("customer_id", selectedCustomerIds)
                  .gte("sale_date", eventFrom)
                  .order("sale_date")
                  .order("id")
                  .range(from, to),
              ),
              loadAll<{
                id: string;
                customer_id: string | null;
                branch_id: string | null;
                paid_on: string;
                amount: number;
              }>((from, to) =>
                supabase
                  .from("customer_payments")
                  .select("id,customer_id,branch_id,paid_on,amount")
                  .eq("business_id", business.id)
                  .in("branch_id", branchIds)
                  .in("customer_id", selectedCustomerIds)
                  .gte("paid_on", eventFrom)
                  .order("paid_on")
                  .order("id")
                  .range(from, to),
              ),
              loadAll<{
                id: string;
                customer_id: string | null;
                branch_id: string;
                return_date: string;
                total: number;
                refund: number;
              }>((from, to) =>
                supabase
                  .from("sales_returns")
                  .select("id,customer_id,branch_id,return_date,total,refund")
                  .eq("business_id", business.id)
                  .in("branch_id", branchIds)
                  .in("customer_id", selectedCustomerIds)
                  .gte("return_date", eventFrom)
                  .order("return_date")
                  .order("id")
                  .range(from, to),
              ),
            ])
          : Promise.resolve([[], [], []] as const);

      const supplierEventsPromise =
        selectedSupplierIds.length > 0
          ? Promise.all([
              loadAll<{
                id: string;
                supplier_id: string;
                branch_id: string;
                invoice_no: string;
                purchase_date: string;
                total: number;
              }>((from, to) =>
                supabase
                  .from("purchases")
                  .select("id,supplier_id,branch_id,invoice_no,purchase_date,total")
                  .eq("business_id", business.id)
                  .eq("status", "posted")
                  .in("supplier_id", selectedSupplierIds)
                  .gte("purchase_date", eventFrom)
                  .order("purchase_date")
                  .order("id")
                  .range(from, to),
              ),
              loadAll<{
                id: string;
                supplier_id: string;
                branch_id: string | null;
                paid_on: string;
                amount: number;
              }>((from, to) =>
                supabase
                  .from("supplier_payments")
                  .select("id,supplier_id,branch_id,paid_on,amount")
                  .eq("business_id", business.id)
                  .in("supplier_id", selectedSupplierIds)
                  .gte("paid_on", eventFrom)
                  .order("paid_on")
                  .order("id")
                  .range(from, to),
              ),
              loadAll<{
                id: string;
                supplier_id: string;
                branch_id: string;
                return_date: string;
                total: number;
                refund: number;
              }>((from, to) =>
                supabase
                  .from("purchase_returns")
                  .select("id,supplier_id,branch_id,return_date,total,refund")
                  .eq("business_id", business.id)
                  .in("supplier_id", selectedSupplierIds)
                  .gte("return_date", eventFrom)
                  .order("return_date")
                  .order("id")
                  .range(from, to),
              ),
            ])
          : Promise.resolve([[], [], []] as const);

      const [
        [sales, customerPayments, salesReturns],
        [purchases, supplierPayments, purchaseReturns],
      ] = await Promise.all([customerEventsPromise, supplierEventsPromise]);
      const customerChanges = new Map<string, DatedBalanceChange[]>();
      const addCustomerChange = (
        customerId: string | null,
        branchId: string | null,
        date: string,
        change: number,
      ) => {
        if (!customerId || !branchId) return;
        const key = `${customerId}:${branchId}`;
        customerChanges.set(key, [...(customerChanges.get(key) ?? []), { date, change }]);
      };
      for (const row of sales)
        addCustomerChange(row.customer_id, row.branch_id, row.sale_date, Number(row.total));
      for (const row of customerPayments)
        addCustomerChange(row.customer_id, row.branch_id, row.paid_on, -Number(row.amount));
      for (const row of salesReturns)
        addCustomerChange(
          row.customer_id,
          row.branch_id,
          row.return_date,
          -(Number(row.total) - Number(row.refund)),
        );
      const supplierChanges = new Map<string, DatedBalanceChange[]>();
      const addSupplierChange = (supplierId: string, date: string, change: number) =>
        supplierChanges.set(supplierId, [
          ...(supplierChanges.get(supplierId) ?? []),
          { date, change },
        ]);
      for (const row of purchases)
        addSupplierChange(row.supplier_id, row.purchase_date, Number(row.total));
      for (const row of supplierPayments)
        addSupplierChange(row.supplier_id, row.paid_on, -Number(row.amount));
      for (const row of purchaseReturns)
        addSupplierChange(
          row.supplier_id,
          row.return_date,
          -(Number(row.total) - Number(row.refund)),
        );
      const dueRows = [
        ...customerDueRows.map((row) => ({
          ...row,
          currentDue: balanceAsOf(
            row.currentDue,
            customerChanges.get(`${row.partyId}:${row.branchId}`) ?? [],
            filters.to,
          ),
        })),
        ...supplierDueRows.map((row) => ({
          ...row,
          currentDue: balanceAsOf(
            row.currentDue,
            supplierChanges.get(row.partyId) ?? [],
            filters.to,
          ),
        })),
      ];
      const customerMap = new Map(
        selectedCustomerBalances.map((row) => [
          `${row.customer_id}:${row.branch_id}`,
          {
            name: row.name ?? row.customer_id!,
            kind: (isDealerType(row.type) ? "dealer" : "customer") as PartyKind,
            branch: branchNameById.get(row.branch_id!) ?? "Branch",
          },
        ]),
      );
      const events: PartyReportEvent[] = [];
      const addCustomerEvent = (
        row: { id: string; customer_id: string | null; branch_id: string | null },
        date: string,
        eventKind: PartyReportEvent["eventKind"],
        amount: number,
      ) => {
        if (!row.customer_id || !row.branch_id) return;
        const party = customerMap.get(`${row.customer_id}:${row.branch_id}`);
        if (!party) return;
        events.push({
          id: row.id,
          date,
          partyId: row.customer_id,
          partyName: party.name,
          partyKind: party.kind,
          branchName: party.branch,
          branchId: row.branch_id,
          eventKind,
          amount: Number(amount),
        });
      };
      for (const row of sales)
        if (row.sale_date >= filters.from && row.sale_date <= filters.to)
          addCustomerEvent(row, row.sale_date, "sale", row.total);
      for (const row of customerPayments)
        if (row.paid_on >= filters.from && row.paid_on <= filters.to)
          addCustomerEvent(row, row.paid_on, "payment_in", row.amount);
      for (const row of salesReturns) {
        if (row.return_date >= filters.from && row.return_date <= filters.to) {
          addCustomerEvent(row, row.return_date, "sales_return", row.total);
          if (Number(row.refund) > 0)
            addCustomerEvent(row, row.return_date, "refund_out", row.refund);
        }
      }
      const supplierMap = new Map(
        selectedSupplierIds.map((id) => [
          id,
          { name: suppliersById.get(id)?.name ?? id, branch: "All branches" },
        ]),
      );
      const addSupplierEvent = (
        row: { id: string; supplier_id: string; branch_id: string | null },
        date: string,
        eventKind: PartyReportEvent["eventKind"],
        amount: number,
      ) => {
        const party = supplierMap.get(row.supplier_id);
        if (!party) return;
        events.push({
          id: row.id,
          date,
          partyId: row.supplier_id,
          partyName: party.name,
          partyKind: "supplier",
          branchName: "All branches",
          eventKind,
          amount: Number(amount),
        });
      };
      for (const row of purchases)
        if (row.purchase_date >= filters.from && row.purchase_date <= filters.to)
          addSupplierEvent(row, row.purchase_date, "purchase", row.total);
      for (const row of supplierPayments)
        if (row.paid_on >= filters.from && row.paid_on <= filters.to)
          addSupplierEvent(row, row.paid_on, "payment_out", row.amount);
      for (const row of purchaseReturns) {
        if (row.return_date >= filters.from && row.return_date <= filters.to) {
          addSupplierEvent(row, row.return_date, "purchase_return", row.total);
          if (Number(row.refund) > 0)
            addSupplierEvent(row, row.return_date, "refund_in", row.refund);
        }
      }
      return { events: filters.mode === "dues" ? [] : events, dues: dueRows };
    },
  });

  const savedReports = useQuery({
    queryKey: ["saved-party-financial-reports", business.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_saved_reports", {
        _biz: business.id,
        _report_type: "party_financial_transactions",
      });
      if (error) throw error;
      return data;
    },
  });
  const saveConfig = useMutation({
    mutationFn: async () => {
      if (!reportName.trim()) throw new Error("Enter a name for this report.");
      const { error } = await supabase.rpc("save_report_config", {
        _biz: business.id,
        _name: reportName.trim(),
        _description: "Party financial transactions and dues",
        _report_type: "party_financial_transactions",
        _filters: filters,
        _columns: columns,
        _sort_by: { period: "desc", party: "asc" },
        _is_public: false,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Report configuration saved.");
      setReportName("");
      await queryClient.invalidateQueries({ queryKey: ["saved-party-financial-reports"] });
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const parties = useMemo(() => {
    const rows = report.data?.dues ?? [];
    return rows.filter(
      (row) => filters.partyFilter === "all" || filters.partyFilter === row.partyKind,
    );
  }, [report.data?.dues, filters.partyFilter]);
  const selectedColumns = filters.mode === "dues" ? DUE_COLUMNS : GROUP_COLUMNS;
  const visibleColumns = selectReportColumns(selectedColumns, columns);
  useEffect(() => {
    const available = (filters.mode === "dues" ? DUE_COLUMNS : GROUP_COLUMNS).map(([key]) => key);
    setColumns((current) => {
      const next = current.filter((key) => available.includes(key as never));
      return next.length ? next : available;
    });
  }, [filters.mode]);

  const dueRows = useMemo(() => {
    const min =
      filters.minimumDue.trim() === "" ? Number.NEGATIVE_INFINITY : Number(filters.minimumDue);
    return outstandingDues(report.data?.dues ?? [], filters.dueOnly).filter(
      (row) => Number.isFinite(row.currentDue) && row.currentDue >= min,
    );
  }, [report.data?.dues, filters.dueOnly, filters.minimumDue]);
  const groups = useMemo(
    () => groupPartyEvents(report.data?.events ?? [], filters.period, report.data?.dues ?? []),
    [report.data?.events, report.data?.dues, filters.period],
  );
  const visibleGroups = useMemo(
    () =>
      groups.filter(
        (row) =>
          (filters.partyFilter === "all" || filters.partyFilter === row.partyKind) &&
          (!filters.party ||
            filters.party === `${row.partyKind}:${row.partyId}:${row.branchId ?? "all"}`),
      ),
    [groups, filters.party, filters.partyFilter],
  );
  const currentTotalDue = dueRows.reduce((total, row) => total + row.currentDue, 0);
  const totalSales = visibleGroups.reduce((total, row) => total + row.sales, 0);
  const totalReceipts = visibleGroups.reduce((total, row) => total + row.paymentsIn, 0);
  const totalPurchases = visibleGroups.reduce((total, row) => total + row.purchases, 0);
  const totalSupplierPayments = visibleGroups.reduce((total, row) => total + row.paymentsOut, 0);

  const currentPartyLabel = (kind: PartyKind) => kindLabel(kind);
  const headers = visibleColumns.map(([, label]) => label);
  const groupValue = (row: PartyReportGroup, key: string): string | number => {
    switch (key) {
      case "period":
        return row.period;
      case "branch":
        return row.branchName;
      case "party":
        return row.partyName;
      case "type":
        return currentPartyLabel(row.partyKind);
      case "sales":
        return row.sales;
      case "paymentsIn":
        return row.paymentsIn;
      case "salesReturns":
        return row.salesReturns;
      case "refundsOut":
        return row.refundsOut;
      case "purchases":
        return row.purchases;
      case "paymentsOut":
        return row.paymentsOut;
      case "purchaseReturns":
        return row.purchaseReturns;
      case "refundsIn":
        return row.refundsIn;
      default:
        return "";
    }
  };
  const dueValue = (row: PartyDueRow, key: string): string | number => {
    switch (key) {
      case "branch":
        return row.branchName;
      case "party":
        return row.partyName;
      case "type":
        return currentPartyLabel(row.partyKind);
      case "currentDue":
        return row.currentDue;
      default:
        return "";
    }
  };
  const sheet = (): Sheet => {
    const rows =
      filters.mode === "dues"
        ? dueRows.map((row) => visibleColumns.map(([key]) => dueValue(row, key)))
        : visibleGroups.map((row) => visibleColumns.map(([key]) => groupValue(row, key)));
    return {
      title: `${business.name} — Party ${filters.mode === "dues" ? "Dues" : "Transactions"}`,
      subtitle: [
        `${filters.from} to ${filters.to} · ${filters.periodPreset} · ${filters.branch === "all" ? "All accessible branches" : (branchNameById.get(filters.branch) ?? "")}`,
        filters.mode === "dues"
          ? `Outstanding balance as of ${filters.to}: Tk ${currentTotalDue.toFixed(2)}`
          : `Balances are shown as of ${filters.to}; supplier balances cover all branches.`,
      ],
      head: headers,
      rows,
      fileName: `party-${filters.mode}-${filters.from}-${filters.to}`,
    };
  };
  const exportReport = async (action: "pdf" | "xlsx" | "share-pdf" | "share-xlsx") => {
    setBusy(true);
    try {
      const current = sheet();
      const isXlsx = action.endsWith("xlsx");
      const blob = isXlsx ? await makeXlsx(current) : await makePdf(current);
      const extension = isXlsx ? "xlsx" : "pdf";
      if (action.startsWith("share")) {
        const result = await shareFile(
          blob,
          `${current.fileName}.${extension}`,
          `${current.title}\n${current.subtitle.join("\n")}`,
        );
        if (result === "fallback")
          toast.info(`${extension.toUpperCase()} downloaded. Attach it in your sharing app.`);
      } else {
        download(blob, `${current.fileName}.${extension}`);
      }
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setBusy(false);
    }
  };

  const updatePreset = (preset: PeriodPreset) => {
    if (preset === "custom") {
      setFilters((current) => ({ ...current, periodPreset: preset }));
      return;
    }
    const dates = presetDates(preset);
    setFilters((current) => ({
      ...current,
      ...dates,
      periodPreset: preset,
      period: preset === "daily" ? "day" : preset === "weekly" ? "week" : "month",
    }));
  };
  const loadSavedReport = (id: string) => {
    setSavedReportId(id);
    const saved = savedReports.data?.find((item) => item.id === id);
    if (!saved) return;
    const value = saved.filters as Partial<Filters> | null;
    if (value) {
      setFilters((current) => ({ ...current, ...value }));
    }
    if (Array.isArray(saved.columns)) {
      const selected = saved.columns.filter(
        (column): column is string => typeof column === "string",
      );
      if (selected.length) setColumns(selected);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Party transactions & dues"
        sub="Daily, weekly, monthly or custom-period reports for customers, dealers and suppliers. Balances are calculated as of the selected end date."
      />

      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-sm">
          Party group
          <select
            className={selectCls}
            value={filters.partyFilter}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                partyFilter: event.target.value as PartyFilter,
                branch: event.target.value === "supplier" ? "all" : current.branch,
                party: "",
              }))
            }
          >
            <option value="all">All parties</option>
            <option value="customer">Customers</option>
            <option value="dealer">Dealers</option>
            {canViewSuppliers && <option value="supplier">Suppliers</option>}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Report type
          <select
            className={selectCls}
            value={filters.mode}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                mode: event.target.value as PartyReportMode,
              }))
            }
          >
            <option value="transactions">Transactions by party</option>
            <option value="dues">Outstanding due list</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Time range
          <select
            className={selectCls}
            value={filters.periodPreset}
            onChange={(event) => updatePreset(event.target.value as PeriodPreset)}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="custom">Custom dates</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Group activity by
          <select
            className={selectCls}
            value={filters.period}
            onChange={(event) =>
              setFilters((current) => ({ ...current, period: event.target.value as ReportPeriod }))
            }
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          From
          <Input
            type="date"
            max={today}
            value={filters.from}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                from: event.target.value,
                periodPreset: "custom",
              }))
            }
          />
        </label>
        <label className="grid gap-1 text-sm">
          To
          <Input
            type="date"
            max={today}
            value={filters.to}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                to: event.target.value,
                periodPreset: "custom",
              }))
            }
          />
        </label>
        <label className="grid gap-1 text-sm">
          Branch / shop
          <select
            className={selectCls}
            value={filters.branch}
            disabled={filters.partyFilter === "supplier"}
            onChange={(event) =>
              setFilters((current) => ({ ...current, branch: event.target.value, party: "" }))
            }
          >
            <option value="all">All accessible branches</option>
            {allowedBranches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Individual party
          <select
            className={selectCls}
            value={filters.party}
            onChange={(event) =>
              setFilters((current) => ({ ...current, party: event.target.value }))
            }
          >
            <option value="">All matching parties</option>
            {parties
              .filter(
                (party) => filters.partyFilter === "all" || filters.partyFilter === party.partyKind,
              )
              .map((party) => (
                <option key={optionKey(party)} value={optionKey(party)}>
                  {party.partyName} · {kindLabel(party.partyKind)} · {party.branchName}
                </option>
              ))}
          </select>
        </label>
        {filters.mode === "dues" && (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={filters.dueOnly}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, dueOnly: event.target.checked }))
                }
              />
              Only positive outstanding balances
            </label>
            <label className="grid gap-1 text-sm">
              Minimum due
              <Input
                type="number"
                step="0.01"
                placeholder="No minimum"
                value={filters.minimumDue}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, minimumDue: event.target.value }))
                }
              />
            </label>
          </>
        )}
      </div>

      {filters.branch !== "all" && filters.partyFilter === "all" && canViewSuppliers && (
        <p className="text-sm text-muted-foreground">
          Supplier balances and supplier transactions are not included when a single branch is
          selected; supplier ledgers are maintained across branches.
        </p>
      )}
      {filters.partyFilter === "all" && !canViewSuppliers && (
        <p className="text-sm text-muted-foreground">
          Supplier reports are available to owner, manager and accountant roles. Your access is
          limited to assigned customer and dealer branches.
        </p>
      )}
      {report.error && <p className="text-sm text-destructive">{friendlyError(report.error)}</p>}
      {savedReports.error && (
        <p className="text-sm text-destructive">{friendlyError(savedReports.error)}</p>
      )}
      {branchesQuery.error && (
        <p className="text-sm text-destructive">{friendlyError(branchesQuery.error)}</p>
      )}
      {branchAccess.error && (
        <p className="text-sm text-destructive">{friendlyError(branchAccess.error)}</p>
      )}
      {!canLoadReport && !report.error && (
        <p className="text-sm text-muted-foreground">
          {filters.from > filters.to
            ? "The start date must be on or before the end date."
            : filters.to > today
              ? "The end date cannot be in the future."
              : "No assigned branch is available for this report."}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label={`Balance as of ${filters.to}`}
          value={currentTotalDue}
          tone={currentTotalDue > 0 ? "neg" : undefined}
        />
        <Stat label="Period sales" value={totalSales} />
        <Stat label="Customer receipts" value={totalReceipts} />
        <Stat label="Period purchases" value={totalPurchases} />
        <Stat label="Supplier payments" value={totalSupplierPayments} />
      </div>

      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-48 flex-1 gap-1 text-sm">
            Saved custom reports
            <select
              className={selectCls}
              value={savedReportId}
              onChange={(event) => loadSavedReport(event.target.value)}
            >
              <option value="">Select a saved report</option>
              {(savedReports.data ?? []).map((saved) => (
                <option key={saved.id} value={saved.id}>
                  {saved.name}
                </option>
              ))}
            </select>
          </label>
          <Input
            className="w-full sm:w-56"
            placeholder="Name this report"
            value={reportName}
            onChange={(event) => setReportName(event.target.value)}
          />
          <Button
            variant="outline"
            disabled={saveConfig.isPending || !reportName.trim()}
            onClick={() => saveConfig.mutate()}
          >
            Save report setup
          </Button>
          {canExport && (
            <>
              <Button
                variant="outline"
                disabled={busy || !report.data || columns.length === 0}
                onClick={() => exportReport("pdf")}
              >
                <FileText className="mr-1 h-4 w-4" /> PDF
              </Button>
              <Button
                variant="outline"
                disabled={busy || !report.data || columns.length === 0}
                onClick={() => exportReport("xlsx")}
              >
                <FileSpreadsheet className="mr-1 h-4 w-4" /> Excel
              </Button>
              <Button
                variant="outline"
                disabled={busy || !report.data || columns.length === 0}
                onClick={() => exportReport("share-pdf")}
              >
                <Share2 className="mr-1 h-4 w-4" /> Share PDF
              </Button>
              <Button
                variant="outline"
                disabled={busy || !report.data || columns.length === 0}
                onClick={() => exportReport("share-xlsx")}
              >
                <Share2 className="mr-1 h-4 w-4" /> Share Excel
              </Button>
            </>
          )}
        </div>
        <details>
          <summary className="cursor-pointer text-sm font-medium">Choose report columns</summary>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {selectedColumns.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={columns.includes(key)}
                  onChange={(event) =>
                    setColumns((current) =>
                      event.target.checked
                        ? [...current, key]
                        : current.filter((column) => column !== key),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
          {columns.length === 0 && (
            <p className="mt-2 text-sm text-destructive">
              Select at least one column before exporting.
            </p>
          )}
        </details>
      </section>

      <div className="overflow-x-auto rounded-lg border bg-card">
        {report.isPending ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Loading financial activity…
          </p>
        ) : filters.mode === "dues" ? (
          dueRows.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No outstanding balances match these filters.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {visibleColumns.map(([key, label]) => (
                    <TableHead key={key}>{label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {dueRows.map((row) => (
                  <TableRow key={optionKey(row)}>
                    {visibleColumns.map(([key]) => (
                      <TableCell
                        key={key}
                        className={
                          key === "currentDue"
                            ? "num text-right font-semibold text-destructive"
                            : ""
                        }
                      >
                        {key === "currentDue"
                          ? bdt(dueValue(row, key) as number)
                          : dueValue(row, key)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        ) : visibleGroups.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            No transactions match these dates and filters.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {visibleColumns.map(([key, label]) => (
                  <TableHead key={key}>{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleGroups.map((row, index) => (
                <TableRow
                  key={`${row.period}:${row.partyKind}:${row.partyId}:${row.branchName}:${index}`}
                >
                  {visibleColumns.map(([key]) => (
                    <TableCell
                      key={key}
                      className={
                        [
                          "sales",
                          "paymentsIn",
                          "salesReturns",
                          "refundsOut",
                          "purchases",
                          "paymentsOut",
                          "purchaseReturns",
                          "refundsIn",
                        ].includes(key)
                          ? "num text-right"
                          : ""
                      }
                    >
                      {[
                        "sales",
                        "paymentsIn",
                        "salesReturns",
                        "refundsOut",
                        "purchases",
                        "paymentsOut",
                        "purchaseReturns",
                        "refundsIn",
                      ].includes(key)
                        ? bdt(groupValue(row, key) as number)
                        : groupValue(row, key)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Sales and purchase totals include posted invoices only. Returns and refunds are shown
        separately. Balance is recalculated from the current ledger balance back to the selected end
        date using subsequent dated transactions. Supplier balances are all-branch totals.
      </p>
    </div>
  );
}
