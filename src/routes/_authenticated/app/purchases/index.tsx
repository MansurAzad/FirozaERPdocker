import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/app/purchases/")({
  head: ({ matches }) => ({
    meta: [
      { title: `Purchase History — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Purchase History records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Purchase History — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Purchase History records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PurchaseList,
});

function PurchaseList() {
  const { business, role } = useBusiness();
  const [q, setQ] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["purchases", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchases")
        .select(
          "id,invoice_no,supplier_invoice_no,purchase_date,total,paid,due,status,suppliers(name),branches(name)",
        )
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
  });
  const rows = useMemo(() => {
    const s = q.toLowerCase().trim();
    return (data ?? []).filter(
      (r) =>
        !s ||
        [r.invoice_no, r.supplier_invoice_no, r.suppliers?.name].some((x) =>
          (x ?? "").toLowerCase().includes(s),
        ),
    );
  }, [data, q]);
  const totals = rows.reduce(
    (a, r) => ({ total: a.total + Number(r.total), due: a.due + Number(r.due) }),
    { total: 0, due: 0 },
  );
  const canCreate = ["owner", "manager", "purchase_officer", "store_keeper"].includes(role);

  return (
    <div>
      <PageHeader
        title="Purchase History"
        sub={`${rows.length} purchases · ${bdt(totals.total)} · Due ${bdt(totals.due)}`}
        actions={
          canCreate && (
            <Button asChild>
              <Link to="/app/purchases/new">
                <Plus className="mr-1 h-4 w-4" />
                New Purchase
              </Link>
            </Button>
          )
        }
      />
      <div className="rounded-lg border bg-card">
        <div className="border-b p-3">
          <Input
            placeholder="Search invoice or supplier…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-xs"
          />
        </div>
        {isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : error ? (
          <p className="p-6 text-sm text-destructive">{friendlyError(error)}</p>
        ) : rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No purchases yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        to="/app/purchases/$id"
                        params={{ id: r.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.invoice_no}
                      </Link>
                      {r.status === "cancelled" && (
                        <Badge variant="destructive" className="ml-2">
                          Cancelled
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="num">{r.purchase_date}</TableCell>
                    <TableCell>{r.suppliers?.name}</TableCell>
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
