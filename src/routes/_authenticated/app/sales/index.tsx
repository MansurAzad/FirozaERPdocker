import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, monthStart, today } from "@/components/erp/ui";
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

export const Route = createFileRoute("/_authenticated/app/sales/")({
  head: ({ matches }) => ({
    meta: [
      { title: `Sales History — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Sales History records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Sales History — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Sales History records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SalesList,
});

function SalesList() {
  const { business, role } = useBusiness();
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const { data, error } = useQuery({
    queryKey: ["sales", business.id, from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select(
          "id,invoice_no,sale_date,total,paid,due,cogs,discount,tax,status,customers(name,mobile),branches(name)",
        )
        .eq("business_id", business.id)
        .gte("sale_date", from)
        .lte("sale_date", to)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data;
    },
  });
  const rows = useMemo(() => {
    const s = q.toLowerCase().trim();
    return (data ?? []).filter(
      (r) =>
        !s ||
        [r.invoice_no, r.customers?.name, r.customers?.mobile].some((x) =>
          (x ?? "").toLowerCase().includes(s),
        ),
    );
  }, [data, q]);
  const showProfit = ["owner", "manager", "accountant"].includes(role);
  const t = rows.reduce(
    (a, r) => ({
      total: a.total + Number(r.total),
      due: a.due + Number(r.due),
      profit: a.profit + Number(r.total) - Number(r.tax) - Number(r.cogs),
    }),
    { total: 0, due: 0, profit: 0 },
  );

  return (
    <div>
      <PageHeader
        title="Sales History"
        sub={`${rows.length} invoices · ${bdt(t.total)}${showProfit ? ` · gross profit ${bdt(t.profit)}` : ""} · due ${bdt(t.due)}`}
        actions={
          <Button asChild>
            <Link to="/app/sales/new">
              <Plus className="mr-1 h-4 w-4" />
              New Sale
            </Link>
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <F label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </F>
        <F label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </F>
        <Input
          placeholder="Search invoice, customer, mobile…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
      </div>
      <div className="rounded-lg border bg-card">
        {error ? (
          <p className="p-6 text-sm text-destructive">{friendlyError(error)}</p>
        ) : !rows.length ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No sales in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  {showProfit && <TableHead className="text-right">Profit</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        to="/app/sales/$id"
                        params={{ id: r.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.invoice_no}
                      </Link>
                    </TableCell>
                    <TableCell className="num">{r.sale_date}</TableCell>
                    <TableCell>{r.customers?.name ?? "Walk-in"}</TableCell>
                    <TableCell>{r.branches?.name}</TableCell>
                    <TableCell className="num text-right">{bdt(r.total)}</TableCell>
                    <TableCell className="num text-right">{bdt(r.paid)}</TableCell>
                    <TableCell
                      className={
                        "num text-right " +
                        (Number(r.due) > 0
                          ? "font-semibold text-destructive"
                          : "text-muted-foreground")
                      }
                    >
                      {bdt(r.due)}
                    </TableCell>
                    {showProfit && (
                      <TableCell className="num text-right">
                        {bdt(Number(r.total) - Number(r.tax) - Number(r.cogs))}
                      </TableCell>
                    )}
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
