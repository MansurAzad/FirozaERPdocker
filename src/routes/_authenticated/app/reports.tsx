import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { groupBy, useMembers, useSaleLines, type SaleLine } from "@/lib/reports";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, Stat, monthStart, today } from "@/components/erp/ui";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/reports")({
  head: ({ matches }) => ({
    meta: [
      { title: `Business Reports — ${matchedCompany(matches)}` },
      {
        name: "description",
        content:
          "Sales, profit and stock reports by product, brand, branch, customer and salesman.",
      },
      { property: "og:title", content: `Business Reports — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content:
          "Sales, profit and stock reports by product, brand, branch, customer and salesman.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Reports,
});

const TABS = [
  "daily",
  "product",
  "brand",
  "category",
  "customer",
  "branch",
  "salesman",
  "stock",
] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  daily: "Daily sales",
  product: "Product-wise",
  brand: "Brand-wise",
  category: "Category-wise",
  customer: "Customer-wise",
  branch: "Branch-wise",
  salesman: "Salesman-wise",
  stock: "Stock & low stock",
};

function shift(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function Reports() {
  const { business } = useBusiness();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [tab, setTab] = useState<Tab>("daily");
  const lines = useSaleLines(business.id, from, to);
  const members = useMembers(business.id);
  const name = (uid: string | null) =>
    members.data?.find((m) => m.user_id === uid)?.display_name ?? "—";

  const keyFn: Record<Exclude<Tab, "stock">, (l: SaleLine) => string> = {
    daily: (l) => l.date,
    product: (l) => l.product,
    brand: (l) => l.brand,
    category: (l) => l.category,
    customer: (l) => l.customer,
    branch: (l) => l.branch,
    salesman: (l) => name(l.salesman),
  };
  const all = lines.data ?? [];
  const totals = {
    revenue: all.reduce((s, l) => s + l.revenue, 0),
    cost: all.reduce((s, l) => s + l.cost, 0),
    qty: all.reduce((s, l) => s + l.qty, 0),
  };
  const rows = tab === "stock" ? [] : groupBy(all, keyFn[tab]);
  if (tab === "daily") rows.sort((a, b) => a.key.localeCompare(b.key));

  const presets: [string, string, string][] = [
    ["Today", today(), today()],
    ["Yesterday", shift(-1), shift(-1)],
    ["Last 7 days", shift(-6), today()],
    ["This month", monthStart(), today()],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business Reports"
        sub="Net sales exclude VAT and include each invoice's discount. Returns are shown in the ledger and accounts."
      />
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <F label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </F>
        <F label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </F>
        {presets.map(([l, f, t]) => (
          <Button
            key={l}
            size="sm"
            variant="outline"
            onClick={() => {
              setFrom(f);
              setTo(t);
            }}
          >
            {l}
          </Button>
        ))}
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => window.print()}>
          Print
        </Button>
      </div>
      <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        <Stat label="Net sales" value={totals.revenue} />
        <Stat label="Cost of goods" value={totals.cost} />
        <Stat
          label="Gross profit"
          value={totals.revenue - totals.cost}
          tone={totals.revenue - totals.cost < 0 ? "neg" : "pos"}
          note={
            totals.revenue
              ? `Margin ${(((totals.revenue - totals.cost) / totals.revenue) * 100).toFixed(1)}%`
              : undefined
          }
        />
        <div className="bg-card p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Units sold
          </div>
          <div className="num mt-2 font-display text-2xl font-semibold">{totals.qty}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 border-b print:hidden">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              tab === t
                ? "border-primary font-semibold text-foreground"
                : "border-transparent text-muted-foreground",
            )}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      {lines.error && <p className="text-sm text-destructive">{friendlyError(lines.error)}</p>}
      {tab === "stock" ? (
        <StockReport />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {TAB_LABEL[tab].replace("-wise", "").replace("Daily sales", "Date")}
                </TableHead>
                <TableHead className="text-right">Invoices</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Net sales</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="font-medium">{r.key}</TableCell>
                  <TableCell className="num text-right">{r.count}</TableCell>
                  <TableCell className="num text-right">{r.qty}</TableCell>
                  <TableCell className="num text-right">{bdt(r.revenue)}</TableCell>
                  <TableCell className="num text-right">{bdt(r.cost)}</TableCell>
                  <TableCell
                    className={cn(
                      "num text-right font-semibold",
                      r.profit < 0 && "text-destructive",
                    )}
                  >
                    {bdt(r.profit)}
                  </TableCell>
                  <TableCell className="num text-right">
                    {r.revenue ? ((r.profit / r.revenue) * 100).toFixed(1) + "%" : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {!lines.isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    No sales in this period.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function StockReport() {
  const { business } = useBusiness();
  const q = useQuery({
    queryKey: ["stock-report", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock")
        .select(
          "qty, avg_cost, branches(name), product_variants(sku, retail_price, reorder_level, products(model, brands(name)))",
        )
        .eq("business_id", business.id);
      if (error) throw error;
      return data;
    },
  });
  const rows = (q.data ?? [])
    .map((s) => ({
      ...s,
      value: s.qty * Number(s.avg_cost),
      retail: s.qty * Number(s.product_variants?.retail_price ?? 0),
      low: s.qty <= (s.product_variants?.reorder_level ?? 0),
    }))
    .sort((a, b) => Number(b.low) - Number(a.low) || b.value - a.value);
  const value = rows.reduce((s, r) => s + r.value, 0);
  const retail = rows.reduce((s, r) => s + r.retail, 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
        <Stat label="Stock value (cost)" value={value} />
        <Stat
          label="Stock value (retail)"
          value={retail}
          note={`Potential profit ${bdt(retail - value)}`}
        />
        <div className="bg-card p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Low stock items
          </div>
          <div className="num mt-2 font-display text-2xl font-semibold text-destructive">
            {rows.filter((r) => r.low).length}
          </div>
        </div>
      </div>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Reorder at</TableHead>
              <TableHead className="text-right">Avg cost</TableHead>
              <TableHead className="text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i} className={r.low ? "bg-destructive/5" : ""}>
                <TableCell>
                  <div className="font-medium">
                    {r.product_variants?.products?.brands?.name}{" "}
                    {r.product_variants?.products?.model}
                  </div>
                  <div className="text-xs text-muted-foreground">{r.product_variants?.sku}</div>
                </TableCell>
                <TableCell>{r.branches?.name}</TableCell>
                <TableCell
                  className={cn("num text-right", r.low && "font-semibold text-destructive")}
                >
                  {r.qty}
                </TableCell>
                <TableCell className="num text-right">
                  {r.product_variants?.reorder_level}
                </TableCell>
                <TableCell className="num text-right">{bdt(r.avg_cost)}</TableCell>
                <TableCell className="num text-right">{bdt(r.value)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
