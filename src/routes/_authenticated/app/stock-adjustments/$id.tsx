import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { toast } from "sonner";
import { Check, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
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

export const Route = createFileRoute("/_authenticated/app/stock-adjustments/$id")({
  head: ({ matches }) => ({
    meta: [
      { title: `Stock Adjustment — ${matchedCompany(matches)}` },
      { name: "description", content: `Stock adjustment detail in ${matchedCompany(matches)}.` },
      { property: "og:title", content: `Stock Adjustment — ${matchedCompany(matches)}` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdjustmentDetail,
});

const ROLES = ["owner", "manager", "accountant", "store_keeper"];

function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "posted") return "default";
  if (s === "draft") return "secondary";
  if (s === "cancelled") return "destructive";
  return "outline";
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function AdjustmentDetail() {
  const { id } = Route.useParams();
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canPost = ROLES.includes(role as string);

  const doc = useQuery({
    queryKey: ["stock-adjustment", id],
    queryFn: async () => {
      const [h, items] = await Promise.all([
        supabase
          .from("stock_adjustments")
          .select("*,branches(name)")
          .eq("id", id)
          .eq("business_id", business.id)
          .single(),
        supabase
          .from("stock_adjustment_items")
          .select(
            "id,current_qty,new_qty,diff,unit_cost,note,product_variants(sku,ram,storage,color,products(model,brands(name)))",
          )
          .eq("adjustment_id", id),
      ]);
      if (h.error) throw h.error;
      if (items.error) throw items.error;
      return { h: h.data, items: items.data };
    },
  });

  const post = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("post_stock_adjustment", {
        _biz: business.id,
        _id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Adjustment posted — stock updated");
      qc.invalidateQueries({ queryKey: ["stock-adjustment", id] });
      qc.invalidateQueries({ queryKey: ["stock-adjustments"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const d = doc.data;

  return (
    <div>
      <PageHeader
        title={d ? d.h.adj_no : "Stock adjustment"}
        sub={d ? `${d.h.adj_type} · ${d.h.branches?.name ?? ""}` : ""}
        actions={
          d && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => navigate({ to: "/app/stock-adjustments" })}>
                Back
              </Button>
              {d.h.status === "draft" && canPost && (
                <>
                  <Button asChild variant="outline">
                    <Link to="/app/stock-adjustments/new" search={{ edit: d.h.id }}>
                      <Pencil className="mr-1 h-4 w-4" />
                      Edit
                    </Link>
                  </Button>
                  <Button disabled={post.isPending} onClick={() => post.mutate()}>
                    <Check className="mr-1 h-4 w-4" />
                    {post.isPending ? "Posting…" : "Post to stock"}
                  </Button>
                </>
              )}
            </div>
          )
        }
      />

      {doc.error ? (
        <p className="text-sm text-destructive">{friendlyError(doc.error)}</p>
      ) : !d ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Book</TableHead>
                    <TableHead className="text-right">New</TableHead>
                    <TableHead className="text-right">Diff</TableHead>
                    <TableHead className="text-right">Unit cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell>
                        <div className="font-medium">
                          {it.product_variants?.products?.brands?.name}{" "}
                          {it.product_variants?.products?.model}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {[
                            it.product_variants?.ram,
                            it.product_variants?.storage,
                            it.product_variants?.color,
                          ]
                            .filter(Boolean)
                            .join(" / ")}{" "}
                          · {it.product_variants?.sku}
                        </div>
                      </TableCell>
                      <TableCell className="num text-right">{it.current_qty}</TableCell>
                      <TableCell className="num text-right">{it.new_qty}</TableCell>
                      <TableCell
                        className={
                          "num text-right " + (it.diff < 0 ? "text-destructive" : "text-success")
                        }
                      >
                        {it.diff > 0 ? `+${it.diff}` : it.diff}
                      </TableCell>
                      <TableCell className="num text-right">{bdt(it.unit_cost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <aside className="h-fit space-y-3 rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Status</span>
              <Badge variant={statusVariant(d.h.status)}>{d.h.status}</Badge>
            </div>
            <dl className="border-t pt-2">
              <Row label="Date">{d.h.adj_date}</Row>
              <Row label="Type">{d.h.adj_type}</Row>
              <Row label="Branch">{d.h.branches?.name ?? "—"}</Row>
              {d.h.reason && <Row label="Reason">{d.h.reason}</Row>}
              {d.h.posted_at && (
                <Row label="Posted">{new Date(d.h.posted_at).toLocaleString("en-GB")}</Row>
              )}
            </dl>
            <div className="num flex justify-between border-t pt-3 text-base font-semibold">
              <span>Adjustment value</span>
              <span>{bdt(d.h.total_value)}</span>
            </div>
            {d.h.note && <p className="border-t pt-3 text-xs text-muted-foreground">{d.h.note}</p>}
          </aside>
        </div>
      )}
    </div>
  );
}
