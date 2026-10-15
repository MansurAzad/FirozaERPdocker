import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer, TrendingDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { F } from "@/components/erp/ui";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/app/dead-slow-stock")({
  head: ({ matches }) => ({
    meta: [
      { title: `Dead & Slow Stock — ${matchedCompany(matches)}` },
      { name: "description", content: `Dead and slow moving stock in ${matchedCompany(matches)}.` },
      { property: "og:title", content: `Dead & Slow Stock — ${matchedCompany(matches)}` },
      { property: "og:description", content: "Stock that has not sold recently, valued at cost." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DeadSlowStock,
});

type Row = {
  variant_id: string;
  sku: string;
  product: string;
  brand: string;
  qty: number;
  avg_cost: number;
  stock_value: number;
  last_sale: string | null;
  days_since: number;
  bucket: string;
};

function DeadSlowStock() {
  const { business } = useBusiness();
  const [slow, setSlow] = useState("60");
  const [dead, setDead] = useState("120");
  const [filter, setFilter] = useState("all");

  const report = useQuery({
    queryKey: ["dead-slow-stock", business.id, slow, dead],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dead_slow_stock_report", {
        _biz: business.id,
        _slow_days: Math.max(1, Math.trunc(Number(slow) || 60)),
        _dead_days: Math.max(1, Math.trunc(Number(dead) || 120)),
      });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const rows = (report.data ?? []).filter((r) => filter === "all" || r.bucket === filter);
  const totalValue = rows.reduce((s, r) => s + Number(r.stock_value), 0);

  return (
    <div>
      <PageHeader
        title="Dead & Slow Stock"
        sub="Products still in stock that have not sold recently. Valued at average cost."
        actions={
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-1 h-4 w-4" />
            Print
          </Button>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <F label="Slow after (days)">
          <Input type="number" min={1} value={slow} onChange={(e) => setSlow(e.target.value)} />
        </F>
        <F label="Dead after (days)">
          <Input type="number" min={1} value={dead} onChange={(e) => setDead(e.target.value)} />
        </F>
        <F label="Show">
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="slow">Slow only</option>
            <option value="dead">Dead only</option>
          </select>
        </F>
        <div className="flex items-end">
          <div className="flex w-full items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
            <TrendingDown className="h-4 w-4 text-destructive" />
            <span className="num ml-auto font-semibold">{bdt(totalValue)}</span>
          </div>
        </div>
      </div>
      <div className="rounded-lg border bg-card">
        {report.error ? (
          <p className="p-4 text-sm text-destructive">{friendlyError(report.error)}</p>
        ) : !rows.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Nothing is sitting idle with these thresholds.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Avg cost</TableHead>
                  <TableHead className="text-right">Stock value</TableHead>
                  <TableHead>Last sale</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead>Bucket</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.variant_id}>
                    <TableCell className="font-medium">
                      {r.brand} {r.product}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.sku}</TableCell>
                    <TableCell className="num text-right">{r.qty}</TableCell>
                    <TableCell className="num text-right">{bdt(r.avg_cost)}</TableCell>
                    <TableCell className="num text-right font-semibold">
                      {bdt(r.stock_value)}
                    </TableCell>
                    <TableCell className="num">{r.last_sale ?? "never"}</TableCell>
                    <TableCell className="num text-right">{r.days_since}</TableCell>
                    <TableCell>
                      <Badge variant={r.bucket === "dead" ? "destructive" : "secondary"}>
                        {r.bucket}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
