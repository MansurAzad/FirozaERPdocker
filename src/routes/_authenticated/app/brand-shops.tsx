import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Store,
  Plus,
  ShoppingCart,
  Truck,
  Boxes,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Printer,
  Receipt,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness, useCan } from "@/lib/business";
import { BRAND_SHOPS } from "@/lib/home-entry";
import { bdt, friendlyError } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { F, today, monthStart } from "@/components/erp/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { shopReportPageSchema, shopReportSchema } from "@/lib/brand-shop";
import { makePdf, makeXlsx, download, type Sheet } from "@/lib/export";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const REPORT_PAGE_SIZE = 50;
const REPORT_SECTIONS = {
  Sales: "sales",
  Purchases: "purchases",
  Stock: "stock",
  Expenses: "expenses",
  Returns: "returns",
  Payments: "payments",
  Report: "report",
} as const;
type ReportTab = keyof typeof REPORT_SECTIONS;

export const Route = createFileRoute("/_authenticated/app/brand-shops")({
  validateSearch: (search: Record<string, unknown>) => ({
    branch: typeof search["branch"] === "string" ? search["branch"] : undefined,
  }),
  head: ({ matches }) => ({
    meta: [
      { title: `Brand Shops — ${matchedCompany(matches)}` },
      {
        name: "description",
        content:
          "Separate purchases, sales, returns, expenses and stock accounts for company shops and stock houses.",
      },
      { property: "og:title", content: `Brand Shops — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: "Shop and stock-house accounts, inventory and date-filtered reports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BrandShops,
});

function BrandShops() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { business, role } = useBusiness();
  const canSetup = useCan("branches");
  const canViewReport = ["owner", "manager", "accountant", "branch_manager"].includes(role);
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<"branch" | "warehouse">("branch");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [tab, setTab] = useState<ReportTab>("Sales");
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);
  const shops = useQuery({
    queryKey: ["brand-shop-branches", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id,name,status,kind")
        .eq("business_id", business.id)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });
  const shopList = shops.data?.filter((b) => b.kind === "branch") ?? [];
  const houseList = shops.data?.filter((b) => b.kind !== "branch") ?? [];
  const branch = shops.data?.find((b) => b.id === search.branch);
  const selected = branch?.name ?? "";
  useEffect(() => {
    if (search.branch && shops.data && !branch) {
      void navigate({
        search: (prev) => ({ ...prev, branch: undefined }),
        replace: true,
      });
    }
  }, [branch, navigate, search.branch, shops.data]);
  useEffect(() => {
    setPage(0);
  }, [branch?.id, from, to, tab]);
  const setup = useMutation({
    mutationFn: async () => {
      const existing = shopList;
      const missing = BRAND_SHOPS.filter(
        (name) => !existing.some((b) => b.name.toLowerCase() === name.toLowerCase()),
      );
      if (!missing.length) return;
      const { error } = await supabase.from("branches").insert(
        missing.map((name) => ({
          business_id: business.id,
          name,
          kind: "branch" as const,
          status: "active" as const,
        })),
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success("Brand shops are ready");
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const addShop = useMutation({
    mutationFn: async () => {
      const name = newName.trim();
      if (!name) throw new Error("Write a shop name");
      if (shops.data?.some((b) => b.name.toLowerCase() === name.toLowerCase()))
        throw new Error("A shop or stock house with this name already exists");
      const { data, error } = await supabase
        .from("branches")
        .insert({ business_id: business.id, name, kind: newKind, status: "active" })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: async (id) => {
      setNewName("");
      await qc.invalidateQueries({ queryKey: ["brand-shop-branches", business.id] });
      void navigate({ search: (prev) => ({ ...prev, branch: id }) });
      toast.success("New shop opened with its own accounts");
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const accounts = useQuery({
    queryKey: [
      "brand-shop-accounts",
      business.id,
      branch?.id,
      from,
      to,
      REPORT_SECTIONS[tab],
      page,
    ],
    enabled: canViewReport && Boolean(branch) && Boolean(from) && Boolean(to) && from <= to,
    refetchInterval: 60_000,
    queryFn: async () => {
      if (!branch) throw new Error("Select a shop");
      const { data, error } = await supabase.rpc("brand_shop_report", {
        _biz: business.id,
        _branch: branch.id,
        _from: from,
        _to: to,
        _section: REPORT_SECTIONS[tab],
        _offset: page * REPORT_PAGE_SIZE,
        _limit: REPORT_PAGE_SIZE,
      });
      if (error) throw error;
      const result = shopReportPageSchema.parse(data);
      const report = shopReportSchema.parse({
        metrics: result.metrics,
        sales: tab === "Sales" ? result.rows : [],
        purchases: tab === "Purchases" ? result.rows : [],
        stock: tab === "Stock" ? result.rows : [],
        expenses: tab === "Expenses" ? result.rows : [],
        returns: tab === "Returns" ? result.rows : [],
        payments: tab === "Payments" ? result.rows : [],
      });
      return { report, total: result.total };
    },
  });
  const d = accounts.data?.report;
  const totalRows = accounts.data?.total ?? 0;
  const metrics = [
    ["Net sales · after returns", d?.metrics["net_sales"] ?? 0],
    ["Net purchases · after returns", d?.metrics["net_purchases"] ?? 0],
    ["Current stock value", d?.metrics["stock_value"] ?? 0],
    ["Income · excluding VAT", d?.metrics["revenue"] ?? 0],
    ["Cost of goods sold", d?.metrics["cost"] ?? 0],
    ["Gross profit · after returns", d?.metrics["gross_profit"] ?? 0],
    ["Shop expenses", d?.metrics["expenses"] ?? 0],
    ["Trading result · after expenses", d?.metrics["trading_result"] ?? 0],
  ] as const;
  const heads: Record<string, string[]> = {
    Sales: ["Date", "Invoice", "Total", "Paid at sale", "Due at sale"],
    Purchases: ["Date", "Invoice", "Total", "Paid at purchase", "Due at purchase"],
    Stock: ["Product", "SKU", "Qty", "Reorder at", "Avg cost", "Current value"],
    Expenses: ["Date", "Category", "Description", "Amount"],
    Returns: ["Date", "Type", "Return", "Total", "Refund"],
    Payments: ["Date", "Type", "Invoice", "Method", "Amount"],
    Report: ["Account", "BDT"],
  };
  const rows: Record<ReportTab, (string | number)[][]> = {
    Sales: d?.sales.map((r) => [r.sale_date, r.invoice_no, r.total, r.paid, r.due]) ?? [],
    Purchases:
      d?.purchases.map((r) => [r.purchase_date, r.invoice_no, r.total, r.paid, r.due]) ?? [],
    Stock:
      d?.stock.map((r) => [r.product, r.sku, r.qty, r.reorder_level, r.avg_cost, r.value]) ?? [],
    Expenses: d?.expenses.map((r) => [r.date, r.category, r.description ?? "", r.amount]) ?? [],
    Returns: d?.returns.map((r) => [r.date, r.kind, r.number, r.total, r.refund]) ?? [],
    Payments: d?.payments.map((r) => [r.date, r.kind, r.invoice, r.method, r.amount]) ?? [],
    Report: metrics.map(([label, value]) => [label, value]),
  };
  async function loadAllRows(section: ReportTab, expectedTotal: number) {
    if (!branch) throw new Error("Select a shop");
    const allRows: unknown[] = [];
    for (let offset = 0; offset < expectedTotal; offset += REPORT_PAGE_SIZE) {
      const { data, error } = await supabase.rpc("brand_shop_report", {
        _biz: business.id,
        _branch: branch.id,
        _from: from,
        _to: to,
        _section: REPORT_SECTIONS[section],
        _offset: offset,
        _limit: REPORT_PAGE_SIZE,
      });
      if (error) throw error;
      const result = shopReportPageSchema.parse(data);
      allRows.push(...result.rows);
      if (result.rows.length < 1) break;
    }
    if (allRows.length !== expectedTotal) {
      throw new Error("The report changed while exporting. Refresh it and try again.");
    }
    return shopReportSchema.parse({
      metrics: d?.metrics ?? {},
      sales: section === "Sales" ? allRows : [],
      purchases: section === "Purchases" ? allRows : [],
      stock: section === "Stock" ? allRows : [],
      expenses: section === "Expenses" ? allRows : [],
      returns: section === "Returns" ? allRows : [],
      payments: section === "Payments" ? allRows : [],
    });
  }
  async function output(kind: "pdf" | "xlsx") {
    if (!d) return;
    setExporting(true);
    try {
      const report = tab === "Report" ? d : await loadAllRows(tab, totalRows);
      const exportRows: Record<ReportTab, (string | number)[][]> = {
        Sales: report.sales.map((r) => [r.sale_date, r.invoice_no, r.total, r.paid, r.due]) ?? [],
        Purchases:
          report.purchases.map((r) => [r.purchase_date, r.invoice_no, r.total, r.paid, r.due]) ??
          [],
        Stock:
          report.stock.map((r) => [
            r.product,
            r.sku,
            r.qty,
            r.reorder_level,
            r.avg_cost,
            r.value,
          ]) ?? [],
        Expenses:
          report.expenses.map((r) => [r.date, r.category, r.description ?? "", r.amount]) ?? [],
        Returns: report.returns.map((r) => [r.date, r.kind, r.number, r.total, r.refund]) ?? [],
        Payments: report.payments.map((r) => [r.date, r.kind, r.invoice, r.method, r.amount]) ?? [],
        Report: metrics.map(([label, value]) => [label, value]),
      };
      const s: Sheet = {
        title: `${business.name} — ${selected} · ${tab}`,
        subtitle: [
          `${from} to ${to} · BDT`,
          "Stock is current; receipts include invoice-linked payments only.",
          ...(tab === "Report" ? ["Net figures include returns; income excludes VAT."] : []),
        ],
        head: heads[tab] ?? [],
        rows: exportRows[tab],
        fileName: `${selected}-${tab}-${from}-${to}`,
      };
      download(await (kind === "pdf" ? makePdf(s) : makeXlsx(s)), `${s.fileName}.${kind}`);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="min-w-0 max-w-full space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">ব্র্যান্ডশপ</h1>
          <p className="break-words text-sm text-muted-foreground">{business.name}</p>
        </div>
        <Button asChild variant="outline" className="print:hidden">
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
            Home
          </Link>
        </Button>
      </div>
      {[
        ["ব্র্যান্ডশপ · Shops", shopList, Store],
        ["স্টক হাউজ · Stock houses", houseList, Boxes],
      ].map(([title, list, Icon]) => {
        const items = list as typeof shopList;
        const I = Icon as typeof Store;
        return items.length ? (
          <div key={title as string} className="space-y-2 print:hidden">
            <h2 className="text-sm font-semibold text-muted-foreground">{title as string}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {items.map((b) => (
                <Button
                  key={b.id}
                  variant={branch?.id === b.id ? "default" : "outline"}
                  title={b.name}
                  className="h-auto min-h-32 min-w-0 w-full flex-col gap-2 px-3 py-4 text-center text-sm sm:text-base"
                  onClick={() => {
                    setPage(0);
                    void navigate({ search: (prev) => ({ ...prev, branch: b.id }) });
                  }}
                >
                  <I className="h-7 w-7 shrink-0" />
                  <span className="max-w-full break-words">{b.name}</span>
                  <span className="text-xs font-normal opacity-75">Open shop screen</span>
                  {b.status !== "active" && <span className="text-xs">inactive</span>}
                </Button>
              ))}
            </div>
          </div>
        ) : null;
      })}
      {canSetup && (
        <form
          className="grid min-w-0 grid-cols-1 items-end gap-3 border-y py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,160px)] xl:grid-cols-[minmax(0,1fr)_160px_auto_auto] print:hidden"
          onSubmit={(e) => {
            e.preventDefault();
            addShop.mutate();
          }}
        >
          <F className="min-w-0" label="নতুন শপ / স্টক হাউজের নাম · New shop name">
            <Input
              aria-label="New shop name"
              className="min-w-0 w-full"
              value={newName}
              maxLength={60}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Samsung, Realme, Agrabad shop"
            />
          </F>
          <F label="Type">
            <select
              aria-label="Type"
              className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm"
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as "branch" | "warehouse")}
            >
              <option value="branch">Brand shop</option>
              <option value="warehouse">Stock house</option>
            </select>
          </F>
          <Button type="submit" disabled={addShop.isPending}>
            <Plus className="h-4 w-4" />
            {addShop.isPending ? "Opening…" : "Open shop"}
          </Button>
          {shopList.length < BRAND_SHOPS.length && (
            <Button
              className="h-auto min-h-9 whitespace-normal"
              type="button"
              variant="outline"
              onClick={() => setup.mutate()}
              disabled={setup.isPending}
            >
              Add the 6 default brand shops
            </Button>
          )}
        </form>
      )}
      {shops.error && <p className="text-destructive">{friendlyError(shops.error)}</p>}
      {shops.isPending ? (
        <p className="text-muted-foreground">Loading shops…</p>
      ) : !branch ? (
        <div className="py-12 text-center">
          {shopList.length + houseList.length > 0 ? (
            <p className="my-2 font-medium">Choose a shop or stock house to open its workspace.</p>
          ) : (
            <>
              <p className="my-2 text-muted-foreground">এখনো কোনো শপ চালু হয়নি।</p>
              {!canSetup && (
                <p className="text-sm text-muted-foreground">
                  দোকান চালু করতে মালিক বা ম্যানেজারের সঙ্গে যোগাযোগ করুন।
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <Dialog
          open={Boolean(branch)}
          onOpenChange={(open) => {
            if (!open) void navigate({ search: (prev) => ({ ...prev, branch: undefined }) });
          }}
        >
          <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] max-w-6xl overflow-y-auto overflow-x-hidden p-4 sm:w-full sm:p-6">
            <DialogHeader className="pr-8">
              <DialogTitle className="break-words">{selected} · Shop workspace</DialogTitle>
              <DialogDescription>
                Shop actions, financial summary and reports for {from} – {to}.
              </DialogDescription>
            </DialogHeader>
            <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <h2 className="min-w-0 break-words text-xl font-semibold">
                {selected}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  · {from} – {to}
                </span>
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap print:hidden">
                {branch.status === "active" && (
                  <>
                    <Button asChild>
                      <Link to="/app/sales/new" search={{ branch: branch.id }}>
                        <ShoppingCart className="h-4 w-4" />
                        New sale
                      </Link>
                    </Button>
                    <Button asChild variant="secondary">
                      <Link to="/app/purchases/new" search={{ branch: branch.id }}>
                        <Truck className="h-4 w-4" />
                        Purchase
                      </Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link to="/app/expenses" search={{ branch: branch.id }}>
                        <Receipt className="h-4 w-4" />
                        Expense
                      </Link>
                    </Button>
                  </>
                )}
                <Button asChild variant="outline">
                  <Link to="/app/stock" search={{ branch: branch.id }}>
                    <Boxes className="h-4 w-4" />
                    Stock
                  </Link>
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap print:hidden">
              <F className="min-w-0 sm:w-40" label="From">
                <Input
                  aria-label="From"
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setPage(0);
                    setFrom(e.target.value);
                  }}
                />
              </F>
              <F className="min-w-0 sm:w-40" label="To">
                <Input
                  aria-label="To"
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setPage(0);
                    setTo(e.target.value);
                  }}
                />
              </F>
              <Button
                variant="outline"
                onClick={() => {
                  setFrom("2000-01-01");
                  setTo(today());
                }}
              >
                All time
              </Button>
              <Button variant="outline" disabled={!d || exporting} onClick={() => output("pdf")}>
                <Download className="h-4 w-4" />
                PDF
              </Button>
              <Button variant="outline" disabled={!d || exporting} onClick={() => output("xlsx")}>
                <Download className="h-4 w-4" />
                Excel
              </Button>
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                Print
              </Button>
            </div>
            {from > to && <p className="text-destructive">From date must be before To date.</p>}
            {!canViewReport ? (
              <p className="text-sm text-muted-foreground">
                Shop financial reports are available to owners, managers, accountants, and branch
                managers.
              </p>
            ) : accounts.error ? (
              <p className="text-destructive">{friendlyError(accounts.error)}</p>
            ) : accounts.isPending ? (
              <p className="text-muted-foreground">Loading accounts…</p>
            ) : (
              <>
                <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-3">
                  {metrics.map(([label, value]) => (
                    <div key={label} className="min-w-0 bg-card p-4 sm:p-5">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="num mt-2 break-words text-xl font-semibold sm:text-2xl">
                        {bdt(value)}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex max-w-full gap-1 overflow-x-auto border-b pb-1 print:hidden">
                  {Object.keys(heads).map((t) => (
                    <Button
                      key={t}
                      variant={tab === t ? "secondary" : "ghost"}
                      className="shrink-0"
                      onClick={() => {
                        setPage(0);
                        setTab(t as ReportTab);
                      }}
                    >
                      {t}
                    </Button>
                  ))}
                </div>
                <section className="min-w-0 max-w-full">
                  <h3 className="mb-3 break-words font-semibold">
                    {selected} · {tab}
                  </h3>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {heads[tab]?.map((h) => (
                            <TableHead key={h}>{h}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows[tab]?.map((r, i) => (
                          <TableRow key={i}>
                            {r.map((v, j) => (
                              <TableCell
                                key={j}
                                className={typeof v === "number" ? "num whitespace-nowrap" : ""}
                              >
                                {j === 1 && tab === "Sales" && d?.sales[i] ? (
                                  <Link
                                    className="text-primary underline"
                                    to="/app/sales/$id"
                                    params={{ id: d.sales[i].id }}
                                  >
                                    {v}
                                  </Link>
                                ) : j === 1 && tab === "Purchases" && d?.purchases[i] ? (
                                  <Link
                                    className="text-primary underline"
                                    to="/app/purchases/$id"
                                    params={{ id: d.purchases[i].id }}
                                  >
                                    {v}
                                  </Link>
                                ) : typeof v === "number" &&
                                  !(tab === "Stock" && (j === 2 || j === 3)) ? (
                                  bdt(v)
                                ) : (
                                  v
                                )}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                        {!rows[tab]?.length && (
                          <TableRow>
                            <TableCell
                              colSpan={heads[tab]?.length}
                              className="py-8 text-center text-muted-foreground"
                            >
                              No records in this shop for the selected period
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </section>
                {tab !== "Report" && totalRows > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
                    <p className="text-sm text-muted-foreground" aria-live="polite">
                      Showing {page * REPORT_PAGE_SIZE + 1}–
                      {Math.min((page + 1) * REPORT_PAGE_SIZE, totalRows)} of {totalRows}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        disabled={page === 0 || accounts.isFetching}
                        onClick={() => setPage((current) => Math.max(0, current - 1))}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        disabled={(page + 1) * REPORT_PAGE_SIZE >= totalRows || accounts.isFetching}
                        onClick={() => setPage((current) => current + 1)}
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
                {tab === "Payments" && (
                  <p className="text-sm text-muted-foreground">
                    Invoice-linked receipts and payments only. Unallocated party payments remain in
                    the company ledger.
                  </p>
                )}
                <div className="flex flex-wrap gap-2 print:hidden">
                  <Button asChild variant="outline">
                    <Link to="/app/branches" search={{ branch: branch.id }}>
                      Edit shop details
                    </Link>
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/app/ledger">Party ledger</Link>
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
