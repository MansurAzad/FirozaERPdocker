import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, ClipboardList } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { selectCls } from "@/components/erp/ui";
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

export const Route = createFileRoute("/_authenticated/app/purchase-orders/")({
  head: ({ matches }) => ({
    meta: [
      { title: `Purchase Orders — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Purchase orders and supplier requisitions in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Purchase Orders — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: "Order stock from suppliers and receive it into inventory.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PoIndex,
});

function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "received") return "default";
  if (s === "partially_received") return "outline";
  if (s === "approved") return "secondary";
  if (s === "cancelled") return "destructive";
  return "secondary";
}

function PoIndex() {
  const { business } = useBusiness();
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");

  const list = useQuery({
    queryKey: ["purchase-orders", business.id, status],
    queryFn: async () => {
      let query = supabase
        .from("purchase_orders")
        .select("id,po_no,po_date,expected_date,status,total,branches(name),suppliers(name)")
        .eq("business_id", business.id)
        .order("po_date", { ascending: false })
        .limit(500);
      if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const rows = (list.data ?? []).filter(
    (r) =>
      !q ||
      [r.po_no, r.suppliers?.name, r.branches?.name].some((x) =>
        (x ?? "").toLowerCase().includes(q.toLowerCase()),
      ),
  );

  const openValue = rows
    .filter((r) => r.status !== "received" && r.status !== "cancelled")
    .reduce((s, r) => s + Number(r.total ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        sub="Order stock from a supplier, then receive it line by line into inventory."
        actions={
          <Button asChild>
            <Link to="/app/purchase-orders/new">
              <Plus className="mr-1 h-4 w-4" />
              New purchase order
            </Link>
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <select
          className={selectCls + " max-w-[12rem]"}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All status</option>
          <option value="draft">Draft</option>
          <option value="approved">Approved</option>
          <option value="partially_received">Partially received</option>
          <option value="received">Received</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search PO no / supplier…"
          className="max-w-xs"
        />
        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <ClipboardList className="h-4 w-4" />
          <span className="num">
            {rows.length} orders · open {bdt(openValue)}
          </span>
        </div>
      </div>
      <div className="rounded-lg border bg-card">
        {list.error ? (
          <p className="p-4 text-sm text-destructive">{friendlyError(list.error)}</p>
        ) : !rows.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No purchase orders.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        to="/app/purchase-orders/$id"
                        params={{ id: r.id }}
                        className="text-primary hover:underline"
                      >
                        {r.po_no}
                      </Link>
                    </TableCell>
                    <TableCell className="num">{r.po_date}</TableCell>
                    <TableCell>{r.suppliers?.name ?? "—"}</TableCell>
                    <TableCell>{r.branches?.name ?? "—"}</TableCell>
                    <TableCell className="num">{r.expected_date ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(r.status)}>{r.status.replace("_", " ")}</Badge>
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
