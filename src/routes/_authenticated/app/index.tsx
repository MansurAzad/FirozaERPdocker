import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Package, Users, Handshake, GitBranch, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { useI18n } from "@/lib/i18n";
import { bdt, friendlyError } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export const Route = createFileRoute("/_authenticated/app/")({
  head: ({ matches }) => ({
    meta: [
      { title: `Dashboard — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Dashboard records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Dashboard — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Dashboard records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

async function count(
  table: "products" | "product_variants" | "customers" | "suppliers" | "branches",
  biz: string,
) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("business_id", biz);
  if (error) throw error;
  return count ?? 0;
}

type TrendPoint = { label: string; sales: number; profit: number; purchases: number };
type TopProduct = { name: string; revenue: number; qty: number };

const trendConfig = {
  sales: { label: "Sales", color: "var(--chart-1)" },
  profit: { label: "Gross profit", color: "var(--chart-3)" },
} satisfies ChartConfig;

const topConfig = {
  revenue: { label: "Revenue", color: "var(--chart-2)" },
} satisfies ChartConfig;

const axisFmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const compact = (v: number) => axisFmt.format(v);

function localIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** The last `n` calendar days in the browser's local timezone, oldest first. */
function lastDays(n: number) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out: { date: string; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push({
      date: localIso(d),
      label: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    });
  }
  return out;
}

function Dashboard() {
  const { business } = useBusiness();
  const { t } = useI18n();
  const { data } = useQuery({
    queryKey: ["dash", business.id],
    queryFn: async () => {
      const [products, variants, customers, suppliers, branches] = await Promise.all(
        (["products", "product_variants", "customers", "suppliers", "branches"] as const).map((x) =>
          count(x, business.id),
        ),
      );
      const { data: credit } = await supabase
        .from("customers")
        .select("credit_limit, opening_balance")
        .eq("business_id", business.id);
      const { data: sup } = await supabase
        .from("supplier_balances")
        .select("current_payable")
        .eq("business_id", business.id);
      const { data: ma } = await supabase
        .from("money_account_balances")
        .select("kind, balance")
        .eq("business_id", business.id);
      const { data: stk } = await supabase
        .from("stock")
        .select("qty, avg_cost")
        .eq("business_id", business.id);
      const today = new Date().toISOString().slice(0, 10);
      const { data: tp } = await supabase
        .from("purchases")
        .select("total")
        .eq("business_id", business.id)
        .eq("purchase_date", today)
        .eq("status", "posted");
      const { data: ts } = await supabase
        .from("sales")
        .select("total,tax,cogs")
        .eq("business_id", business.id)
        .eq("sale_date", today)
        .eq("status", "posted");
      const { data: cb } = await supabase
        .from("customer_balances")
        .select("current_due")
        .eq("business_id", business.id);
      return {
        products,
        variants,
        customers,
        suppliers,
        branches,
        customerDue: (cb ?? []).reduce((s, r) => s + Number(r.current_due ?? 0), 0),
        creditLimit: (credit ?? []).reduce((s, r) => s + Number(r.credit_limit), 0),
        supplierDue: (sup ?? []).reduce((s, r) => s + Number(r.current_payable ?? 0), 0),
        cash: (ma ?? [])
          .filter((m) => m.kind === "cash")
          .reduce((s, r) => s + Number(r.balance ?? 0), 0),
        bank: (ma ?? [])
          .filter((m) => m.kind !== "cash")
          .reduce((s, r) => s + Number(r.balance ?? 0), 0),
        stockValue: (stk ?? []).reduce((s, r) => s + r.qty * Number(r.avg_cost), 0),
        todayPurchase: (tp ?? []).reduce((s, r) => s + Number(r.total), 0),
        todaySales: (ts ?? []).reduce((s, r) => s + Number(r.total), 0),
        todayProfit: (ts ?? []).reduce(
          (s, r) => s + Number(r.total) - Number(r.tax) - Number(r.cogs),
          0,
        ),
      };
    },
  });

  const trend = useQuery({
    queryKey: ["dash-trend", business.id],
    queryFn: async (): Promise<TrendPoint[]> => {
      const days = lastDays(14);
      const start = days[0]?.date ?? "1970-01-01";
      const [s, p] = await Promise.all([
        supabase
          .from("sales")
          .select("sale_date,total,tax,cogs")
          .eq("business_id", business.id)
          .eq("status", "posted")
          .gte("sale_date", start),
        supabase
          .from("purchases")
          .select("purchase_date,total")
          .eq("business_id", business.id)
          .eq("status", "posted")
          .gte("purchase_date", start),
      ]);
      if (s.error) throw s.error;
      if (p.error) throw p.error;
      const salesByDay = new Map<string, { sales: number; profit: number }>();
      for (const r of s.data ?? []) {
        const cur = salesByDay.get(r.sale_date) ?? { sales: 0, profit: 0 };
        cur.sales += Number(r.total);
        cur.profit += Number(r.total) - Number(r.tax) - Number(r.cogs);
        salesByDay.set(r.sale_date, cur);
      }
      const purchasesByDay = new Map<string, number>();
      for (const r of p.data ?? []) {
        purchasesByDay.set(
          r.purchase_date,
          (purchasesByDay.get(r.purchase_date) ?? 0) + Number(r.total),
        );
      }
      return days.map((d) => ({
        label: d.label,
        sales: Math.round(salesByDay.get(d.date)?.sales ?? 0),
        profit: Math.round(salesByDay.get(d.date)?.profit ?? 0),
        purchases: Math.round(purchasesByDay.get(d.date) ?? 0),
      }));
    },
  });

  const top = useQuery({
    queryKey: ["dash-top", business.id],
    queryFn: async (): Promise<TopProduct[]> => {
      const start = lastDays(30)[0]?.date ?? "1970-01-01";
      const { data: rows, error } = await supabase
        .from("sales")
        .select(
          "sale_items(qty,line_total,variant_id,product_variants(sku,products(model,brands(name))))",
        )
        .eq("business_id", business.id)
        .eq("status", "posted")
        .gte("sale_date", start);
      if (error) throw error;
      type Joined = {
        sale_items: {
          qty: number;
          line_total: number;
          variant_id: string;
          product_variants: {
            sku: string;
            products: { model: string; brands: { name: string } | null } | null;
          } | null;
        }[];
      };
      const byVariant = new Map<string, TopProduct>();
      for (const sale of (rows ?? []) as unknown as Joined[]) {
        for (const r of sale.sale_items ?? []) {
          const label =
            (r.product_variants
              ? `${r.product_variants.products?.brands?.name ?? ""} ${
                  r.product_variants.products?.model ?? ""
                }`.trim() || r.product_variants.sku
              : r.variant_id) || r.variant_id;
          const cur = byVariant.get(r.variant_id) ?? { name: label, revenue: 0, qty: 0 };
          cur.revenue += Number(r.line_total);
          cur.qty += Number(r.qty);
          byVariant.set(r.variant_id, cur);
        }
      }
      return [...byVariant.values()]
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8)
        .map((r) => ({ ...r, revenue: Math.round(r.revenue) }));
    },
  });

  const money = [
    {
      k: "todaySales" as const,
      v: data?.todaySales ?? 0,
      note: `Gross profit ${bdt(data?.todayProfit)}`,
    },
    { k: "todayPurchase" as const, v: data?.todayPurchase ?? 0, note: "Posted purchases today" },
    { k: "cashBalance" as const, v: data?.cash ?? 0, note: "All cash accounts" },
    { k: "bankBalance" as const, v: data?.bank ?? 0, note: "Bank + bKash/Nagad/Rocket" },
    { k: "stockValue" as const, v: data?.stockValue ?? 0, note: "At landed cost" },
    { k: "customerDue" as const, v: data?.customerDue ?? 0, note: "Opening + sales − collections" },
    {
      k: "supplierDue" as const,
      v: data?.supplierDue ?? 0,
      note: "Opening + purchases − payments",
    },
  ];
  const counts = [
    {
      label: t("products"),
      v: data?.products,
      sub: `${data?.variants ?? 0} variants`,
      icon: Package,
      to: "/app/products" as const,
    },
    {
      label: t("customers"),
      v: data?.customers,
      sub: `Credit limits ${bdt(data?.creditLimit)}`,
      icon: Users,
      to: "/app/customers" as const,
    },
    {
      label: t("suppliers"),
      v: data?.suppliers,
      sub: "Active suppliers",
      icon: Handshake,
      to: "/app/suppliers" as const,
    },
    {
      label: t("branches"),
      v: data?.branches,
      sub: "Shops & warehouses",
      icon: GitBranch,
      to: "/app/branches" as const,
    },
  ];
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("dashboard")}</h1>
          <p className="text-sm text-muted-foreground">{t("tagline")}</p>
        </div>
      </div>

      <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {money.map((m) => (
          <div key={m.k} className="bg-card p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t(m.k)}
            </div>
            <div className="num mt-2 font-display text-3xl font-semibold">{bdt(m.v)}</div>
            <div className="mt-1 text-xs text-muted-foreground">{m.note}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {counts.map((c) => (
          <Link
            key={c.label}
            to={c.to}
            className="group rounded-lg border bg-card p-5 transition-colors hover:border-primary/40"
          >
            <c.icon className="h-5 w-5 text-primary" />
            <div className="num mt-3 font-display text-2xl font-semibold">{c.v ?? "—"}</div>
            <div className="text-sm font-medium">{c.label}</div>
            <div className="text-xs text-muted-foreground">{c.sub}</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-7">
        <div className="rounded-lg border bg-card p-5 shadow-sm lg:col-span-4">
          <div className="text-sm font-semibold">Sales &amp; profit — last 14 days</div>
          <div className="mb-4 text-xs text-muted-foreground">
            Posted invoices; gross profit before other expenses
          </div>
          <ChartContainer config={trendConfig} className="aspect-auto h-[240px] w-full">
            <AreaChart data={trend.data ?? []} margin={{ left: 4, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="fillSales" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-sales)" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="var(--color-sales)" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="fillProfit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-profit)" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="var(--color-profit)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={12}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={(v: number) => compact(v)}
              />
              <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
              <Area
                dataKey="sales"
                type="monotone"
                fill="url(#fillSales)"
                stroke="var(--color-sales)"
                strokeWidth={2}
              />
              <Area
                dataKey="profit"
                type="monotone"
                fill="url(#fillProfit)"
                stroke="var(--color-profit)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        </div>

        <div className="rounded-lg border bg-card p-5 shadow-sm lg:col-span-3">
          <div className="text-sm font-semibold">Top products — 30 days</div>
          <div className="mb-4 text-xs text-muted-foreground">By revenue</div>
          {top.data?.length ? (
            <ChartContainer config={topConfig} className="aspect-auto h-[240px] w-full">
              <BarChart data={top.data} layout="vertical" margin={{ left: 4, right: 12 }}>
                <CartesianGrid horizontal={false} />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => compact(v)}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  width={110}
                  tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
                <Bar dataKey="revenue" fill="var(--color-revenue)" radius={4} />
              </BarChart>
            </ChartContainer>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">
              No sales in the last 30 days.
            </p>
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Quick actions
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <Link to="/app/customers">
              <Plus className="mr-1 h-4 w-4" />
              Add Customer
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/app/suppliers">
              <Plus className="mr-1 h-4 w-4" />
              Add Supplier
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/app/products">
              <Plus className="mr-1 h-4 w-4" />
              Add Product
            </Link>
          </Button>
          <Button asChild>
            <Link to="/app/purchases/new">
              <Plus className="mr-1 h-4 w-4" />
              New Purchase
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/app/imei">IMEI Search</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/app/supplier-payments">Pay Supplier</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/app/expenses">Add Expense</Link>
          </Button>
          <Button asChild>
            <Link to="/app/sales/new">
              <Plus className="mr-1 h-4 w-4" />
              New Sale
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/app/due-collection">Receive Payment</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
