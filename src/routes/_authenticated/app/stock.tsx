import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { Input } from "@/components/ui/input";
import { ScanButton } from "@/components/erp/ScanButton";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight, ScanLine } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/app/stock")({
  validateSearch: (search: Record<string, unknown>): { branch?: string | undefined } => ({
    branch: typeof search["branch"] === "string" ? search["branch"] : undefined,
  }),
  head: ({ matches }) => ({
    meta: [
      { title: `Inventory — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: "View branch inventory, landed cost, retail value and low-stock products.",
      },
      { property: "og:title", content: `Inventory — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: "View branch stock, product value and low-stock alerts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StockPage,
});

function StockPage() {
  const { business } = useBusiness();
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState(Route.useSearch().branch ?? "");
  const { data, error } = useQuery({
    queryKey: ["stock", business.id],
    queryFn: async () => {
      const [s, b] = await Promise.all([
        supabase
          .from("stock")
          .select(
            "branch_id,variant_id,qty,avg_cost,branches(name),product_variants(sku,ram,storage,color,reorder_level,retail_price,products(model,brands(name)))",
          )
          .eq("business_id", business.id),
        supabase.from("branches").select("id,name").eq("business_id", business.id).order("name"),
      ]);
      if (s.error) throw s.error;
      if (b.error) throw b.error;
      return { stock: s.data, branches: b.data };
    },
  });
  const rows = useMemo(() => {
    const s = q.toLowerCase().trim();
    return (data?.stock ?? []).filter(
      (r) =>
        (!branch || r.branch_id === branch) &&
        (!s ||
          [
            r.product_variants?.sku,
            r.product_variants?.products?.model,
            r.product_variants?.products?.brands?.name,
          ].some((x) => (x ?? "").toLowerCase().includes(s))),
    );
  }, [data, q, branch]);
  const value = rows.reduce((a, r) => a + r.qty * Number(r.avg_cost), 0);
  const units = rows.reduce((a, r) => a + r.qty, 0);

  return (
    <div>
      <PageHeader title="Stock" sub="দোকানে কী কী আছে? — valued at landed cost." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            Units in stock
          </div>
          <div className="num mt-1 font-display text-2xl font-semibold">{units}</div>
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Stock value</div>
          <div className="num mt-1 font-display text-2xl font-semibold">{bdt(value)}</div>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
        <div className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,20rem)_12rem_auto] sm:p-4">
          <div className="flex gap-2">
            <Input
              placeholder="Search product or SKU…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <ScanButton multi={false} onCodes={(c) => setQ(c[0] ?? "")} />
          </div>
          <select
            className="h-10 rounded-md border border-input bg-card px-3 text-sm"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="">All branches</option>
            {data?.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <Button asChild variant="outline">
            <Link to="/app/transfers">
              <ArrowLeftRight />
              Transfer stock
            </Link>
          </Button>
        </div>
        {error ? (
          <p className="p-6 text-sm text-destructive">{friendlyError(error)}</p>
        ) : rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            No stock yet. Post a purchase to add stock.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Avg cost</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Retail</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const v = r.product_variants;
                  const low = r.qty <= (v?.reorder_level ?? 0);
                  return (
                    <TableRow key={r.branch_id + r.variant_id}>
                      <TableCell>
                        <div className="font-medium">
                          {v?.products?.brands?.name} {v?.products?.model}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {[v?.ram, v?.storage, v?.color].filter(Boolean).join(" / ")} · {v?.sku}
                        </div>
                      </TableCell>
                      <TableCell>{r.branches?.name}</TableCell>
                      <TableCell className="num text-right">
                        {r.qty}{" "}
                        {low && (
                          <Badge variant="destructive" className="ml-1">
                            Low
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="num text-right">{bdt(r.avg_cost)}</TableCell>
                      <TableCell className="num text-right">
                        {bdt(r.qty * Number(r.avg_cost))}
                      </TableCell>
                      <TableCell className="num text-right">{bdt(v?.retail_price)}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="ghost">
                          <Link to="/app/imei">
                            <ScanLine />
                            IMEI
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
