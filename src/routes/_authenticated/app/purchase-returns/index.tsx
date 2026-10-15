import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/app/purchase-returns/")({
  head: ({ matches }) => ({
    meta: [
      { title: `Purchase Returns — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Goods sent back to suppliers in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Purchase Returns — ${matchedCompany(matches)}` },
      { property: "og:description", content: "Return purchased goods and reduce supplier due." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrIndex,
});

function PrIndex() {
  const { business } = useBusiness();
  const [q, setQ] = useState("");

  const list = useQuery({
    queryKey: ["purchase-returns", business.id],
    queryFn: async () => {
      const [returns, moves] = await Promise.all([
        supabase
          .from("purchase_returns")
          .select(
            "id,return_no,return_date,reason,refund,total,branches(name),suppliers(name),purchases(invoice_no)",
          )
          .eq("business_id", business.id)
          .order("return_date", { ascending: false })
          .limit(500),
        supabase
          .from("stock_movements")
          .select("ref_id")
          .eq("business_id", business.id)
          .eq("ref_type", "purchase_return")
          .limit(5000),
      ]);
      if (returns.error) throw returns.error;
      if (moves.error) throw moves.error;
      const posted = new Set((moves.data ?? []).map((m) => m.ref_id));
      return (returns.data ?? []).map((r) => ({ ...r, posted: posted.has(r.id) }));
    },
  });

  const rows = useMemo(
    () =>
      (list.data ?? []).filter(
        (r) =>
          !q ||
          [r.return_no, r.suppliers?.name, r.branches?.name, r.purchases?.invoice_no].some((x) =>
            (x ?? "").toLowerCase().includes(q.toLowerCase()),
          ),
      ),
    [list.data, q],
  );

  const total = rows.reduce((s, r) => s + Number(r.total ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Purchase Returns"
        sub="Send goods back to a supplier. Stock decreases only when the return is posted."
        actions={
          <Button asChild>
            <Link to="/app/purchase-returns/new">
              <Plus className="mr-1 h-4 w-4" />
              New return
            </Link>
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search return no / supplier / invoice…"
          className="max-w-xs"
        />
        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <Undo2 className="h-4 w-4" />
          <span className="num">
            {rows.length} returns · {bdt(total)}
          </span>
        </div>
      </div>
      <div className="rounded-lg border bg-card">
        {list.error ? (
          <p className="p-4 text-sm text-destructive">{friendlyError(list.error)}</p>
        ) : !rows.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No purchase returns.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Purchase</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        to="/app/purchase-returns/$id"
                        params={{ id: r.id }}
                        className="text-primary hover:underline"
                      >
                        {r.return_no}
                      </Link>
                    </TableCell>
                    <TableCell className="num">{r.return_date}</TableCell>
                    <TableCell>{r.suppliers?.name ?? "—"}</TableCell>
                    <TableCell>{r.purchases?.invoice_no ?? "—"}</TableCell>
                    <TableCell className="max-w-[16rem] truncate">{r.reason ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={r.posted ? "default" : "secondary"}>
                        {r.posted ? "posted" : "draft"}
                      </Badge>
                    </TableCell>
                    <TableCell className="num text-right">{bdt(r.total)}</TableCell>
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
