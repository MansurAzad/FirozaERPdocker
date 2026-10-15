import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, SlidersHorizontal } from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/app/stock-adjustments/")({
  head: ({ matches }) => ({
    meta: [
      { title: `Stock Adjustments — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Stock adjustments and physical counts in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Stock Adjustments — ${matchedCompany(matches)}` },
      { property: "og:description", content: "Correct book stock against the physical count." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdjustmentsIndex,
});

function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "posted") return "default";
  if (s === "draft") return "secondary";
  if (s === "cancelled") return "destructive";
  return "outline";
}

function AdjustmentsIndex() {
  const { business } = useBusiness();
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");

  const list = useQuery({
    queryKey: ["stock-adjustments", business.id, status, type],
    queryFn: async () => {
      let query = supabase
        .from("stock_adjustments")
        .select("id,adj_no,adj_type,adj_date,reason,status,total_value,branches(name)")
        .eq("business_id", business.id)
        .order("adj_date", { ascending: false })
        .limit(500);
      if (status !== "all") query = query.eq("status", status);
      if (type !== "all") query = query.eq("adj_type", type);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const rows = (list.data ?? []).filter(
    (r) =>
      !q ||
      [r.adj_no, r.reason, r.branches?.name].some((x) =>
        (x ?? "").toLowerCase().includes(q.toLowerCase()),
      ),
  );

  const total = rows.reduce((s, r) => s + Number(r.total_value ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Stock Adjustments"
        sub="Correct book stock against a physical count, or make a manual increase/decrease. Stock moves only when posted."
        actions={
          <Button asChild>
            <Link to="/app/stock-adjustments/new">
              <Plus className="mr-1 h-4 w-4" />
              New adjustment
            </Link>
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <select
          className={selectCls + " max-w-[10rem]"}
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="all">All types</option>
          <option value="recount">Recount</option>
          <option value="increase">Increase</option>
          <option value="decrease">Decrease</option>
        </select>
        <select
          className={selectCls + " max-w-[10rem]"}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All status</option>
          <option value="draft">Draft</option>
          <option value="posted">Posted</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search no / reason / branch…"
          className="max-w-xs"
        />
        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <SlidersHorizontal className="h-4 w-4" />
          <span className="num">
            {rows.length} documents · {bdt(total)}
          </span>
        </div>
      </div>
      <div className="rounded-lg border bg-card">
        {list.error ? (
          <p className="p-4 text-sm text-destructive">{friendlyError(list.error)}</p>
        ) : !rows.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No stock adjustments.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        to="/app/stock-adjustments/$id"
                        params={{ id: r.id }}
                        className="text-primary hover:underline"
                      >
                        {r.adj_no}
                      </Link>
                    </TableCell>
                    <TableCell className="num">{r.adj_date}</TableCell>
                    <TableCell className="capitalize">{r.adj_type}</TableCell>
                    <TableCell>{r.branches?.name ?? "—"}</TableCell>
                    <TableCell className="max-w-[16rem] truncate">{r.reason ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="num text-right">{bdt(r.total_value)}</TableCell>
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
