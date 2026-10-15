import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { toast } from "sonner";
import { PackageMinus, Pencil } from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/app/purchase-returns/$id")({
  head: ({ matches }) => ({
    meta: [
      { title: `Purchase Return — ${matchedCompany(matches)}` },
      { name: "description", content: `Purchase return detail in ${matchedCompany(matches)}.` },
      { property: "og:title", content: `Purchase Return — ${matchedCompany(matches)}` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrDetail,
});

const ROLES = ["owner", "manager", "accountant", "store_keeper"];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function PrDetail() {
  const { id } = Route.useParams();
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canPost = ROLES.includes(role as string);

  const doc = useQuery({
    queryKey: ["purchase-return", id],
    queryFn: async () => {
      const [h, items, moves] = await Promise.all([
        supabase
          .from("purchase_returns")
          .select("*,branches(name),suppliers(name),purchases(invoice_no)")
          .eq("id", id)
          .eq("business_id", business.id)
          .single(),
        supabase
          .from("purchase_return_items")
          .select(
            "id,qty,unit_cost,product_variants(sku,ram,storage,color,products(model,brands(name)))",
          )
          .eq("return_id", id),
        supabase
          .from("stock_movements")
          .select("ref_id")
          .eq("business_id", business.id)
          .eq("ref_type", "purchase_return")
          .eq("ref_id", id)
          .limit(1),
      ]);
      if (h.error) throw h.error;
      if (items.error) throw items.error;
      return { h: h.data, items: items.data, posted: !!moves.data?.length };
    },
  });

  const post = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("post_purchase_return", { _biz: business.id, _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Return posted — stock decreased");
      qc.invalidateQueries({ queryKey: ["purchase-return", id] });
      qc.invalidateQueries({ queryKey: ["purchase-returns"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const d = doc.data;

  return (
    <div>
      <PageHeader
        title={d ? d.h.return_no : "Purchase return"}
        sub={d ? `${d.h.suppliers?.name ?? ""} · ${d.h.branches?.name ?? ""}` : ""}
        actions={
          d && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => navigate({ to: "/app/purchase-returns" })}>
                Back
              </Button>
              {!d.posted && canPost && (
                <>
                  <Button asChild variant="outline">
                    <Link to="/app/purchase-returns/new" search={{ edit: d.h.id }}>
                      <Pencil className="mr-1 h-4 w-4" />
                      Edit
                    </Link>
                  </Button>
                  <Button disabled={post.isPending} onClick={() => post.mutate()}>
                    <PackageMinus className="mr-1 h-4 w-4" />
                    {post.isPending ? "Posting…" : "Post return"}
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
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit cost</TableHead>
                    <TableHead className="text-right">Line total</TableHead>
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
                      <TableCell className="num text-right">{it.qty}</TableCell>
                      <TableCell className="num text-right">{bdt(it.unit_cost)}</TableCell>
                      <TableCell className="num text-right">
                        {bdt(it.qty * Number(it.unit_cost))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <aside className="h-fit space-y-3 rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Status</span>
              <Badge variant={d.posted ? "default" : "secondary"}>
                {d.posted ? "posted" : "draft"}
              </Badge>
            </div>
            <dl className="border-t pt-2">
              <Row label="Return date">{d.h.return_date}</Row>
              <Row label="Purchase">{d.h.purchases?.invoice_no ?? "—"}</Row>
              <Row label="Supplier">{d.h.suppliers?.name ?? "—"}</Row>
              <Row label="Branch">{d.h.branches?.name ?? "—"}</Row>
              <Row label="Refund">{bdt(d.h.refund)}</Row>
            </dl>
            <div className="num flex justify-between border-t pt-3 text-base font-semibold">
              <span>Return value</span>
              <span>{bdt(d.h.total)}</span>
            </div>
            {d.h.reason && (
              <p className="border-t pt-3 text-xs text-muted-foreground">{d.h.reason}</p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
