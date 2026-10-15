import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, today } from "@/components/erp/ui";
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

export const Route = createFileRoute("/_authenticated/app/supplier-aging")({
  head: ({ matches }) => ({
    meta: [
      { title: `Supplier Aging — ${matchedCompany(matches)}` },
      { name: "description", content: `Supplier due aging report for ${matchedCompany(matches)}.` },
      { property: "og:title", content: `Supplier Aging — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: "See how much each supplier is owed and how old the due is.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SupplierAging,
});

type Row = {
  supplier_id: string;
  supplier_name: string;
  b0_30: number;
  b31_60: number;
  b61_90: number;
  b91_120: number;
  b_over_120: number;
  total_due: number;
};

function SupplierAging() {
  const { business } = useBusiness();
  const [asOf, setAsOf] = useState(today());

  const report = useQuery({
    queryKey: ["supplier-aging", business.id, asOf],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("supplier_aging_report", {
        _biz: business.id,
        _as_of: asOf,
      });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const rows = report.data ?? [];
  const totals = rows.reduce(
    (t, r) => ({
      b0_30: t.b0_30 + Number(r.b0_30),
      b31_60: t.b31_60 + Number(r.b31_60),
      b61_90: t.b61_90 + Number(r.b61_90),
      b91_120: t.b91_120 + Number(r.b91_120),
      b_over_120: t.b_over_120 + Number(r.b_over_120),
      total_due: t.total_due + Number(r.total_due),
    }),
    { b0_30: 0, b31_60: 0, b61_90: 0, b91_120: 0, b_over_120: 0, total_due: 0 },
  );

  return (
    <div>
      <PageHeader
        title="Supplier Aging"
        sub="Outstanding supplier balance bucketed by how old the purchase is."
        actions={
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-1 h-4 w-4" />
            Print
          </Button>
        }
      />
      <div className="mb-4 max-w-[12rem]">
        <F label="As of date">
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </F>
      </div>
      <div className="rounded-lg border bg-card">
        {report.error ? (
          <p className="p-4 text-sm text-destructive">{friendlyError(report.error)}</p>
        ) : !rows.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No supplier dues as of {asOf}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">0–30</TableHead>
                  <TableHead className="text-right">31–60</TableHead>
                  <TableHead className="text-right">61–90</TableHead>
                  <TableHead className="text-right">91–120</TableHead>
                  <TableHead className="text-right">&gt;120</TableHead>
                  <TableHead className="text-right">Total due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.supplier_id}>
                    <TableCell className="font-medium">{r.supplier_name}</TableCell>
                    <TableCell className="num text-right">{bdt(r.b0_30)}</TableCell>
                    <TableCell className="num text-right">{bdt(r.b31_60)}</TableCell>
                    <TableCell className="num text-right">{bdt(r.b61_90)}</TableCell>
                    <TableCell className="num text-right">{bdt(r.b91_120)}</TableCell>
                    <TableCell className="num text-right text-destructive">
                      {bdt(r.b_over_120)}
                    </TableCell>
                    <TableCell className="num text-right font-semibold">
                      {bdt(r.total_due)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 bg-muted/40 font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell className="num text-right">{bdt(totals.b0_30)}</TableCell>
                  <TableCell className="num text-right">{bdt(totals.b31_60)}</TableCell>
                  <TableCell className="num text-right">{bdt(totals.b61_90)}</TableCell>
                  <TableCell className="num text-right">{bdt(totals.b91_120)}</TableCell>
                  <TableCell className="num text-right">{bdt(totals.b_over_120)}</TableCell>
                  <TableCell className="num text-right">{bdt(totals.total_due)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
