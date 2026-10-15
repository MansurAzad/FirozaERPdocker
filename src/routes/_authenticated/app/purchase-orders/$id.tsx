import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Check, PackageCheck, Pencil, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/app/purchase-orders/$id")({
  head: ({ matches }) => ({
    meta: [
      { title: `Purchase Order — ${matchedCompany(matches)}` },
      { name: "description", content: `Purchase order detail in ${matchedCompany(matches)}.` },
      { property: "og:title", content: `Purchase Order — ${matchedCompany(matches)}` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PoDetail,
});

const ROLES = ["owner", "manager", "accountant", "purchase_officer", "store_keeper"];

function statusVariant(s: string): "default" | "secondary" | "destructive" | "outline" {
  if (s === "received") return "default";
  if (s === "partially_received") return "outline";
  if (s === "approved") return "secondary";
  if (s === "cancelled") return "destructive";
  return "secondary";
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function PoDetail() {
  const { id } = Route.useParams();
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canEdit = ROLES.includes(role as string);
  const [recv, setRecv] = useState<Record<string, number>>({});

  const doc = useQuery({
    queryKey: ["purchase-order", id],
    queryFn: async () => {
      const [h, items] = await Promise.all([
        supabase
          .from("purchase_orders")
          .select("*,branches(name),suppliers(name)")
          .eq("id", id)
          .eq("business_id", business.id)
          .single(),
        supabase
          .from("purchase_order_items")
          .select(
            "id,variant_id,qty,received_qty,price,discount,line_total,product_variants(sku,ram,storage,color,products(model,brands(name)))",
          )
          .eq("po_id", id)
          .order("sort_order"),
      ]);
      if (h.error) throw h.error;
      if (items.error) throw items.error;
      return { h: h.data, items: items.data };
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["purchase-order", id] });
    qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    qc.invalidateQueries({ queryKey: ["stock"] });
  };

  const setStatus = useMutation({
    mutationFn: async (status: string) => {
      const { error } = await supabase.rpc("update_po_status", {
        _biz: business.id,
        _id: id,
        _status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Purchase order updated");
      refresh();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const receive = useMutation({
    mutationFn: async (rows: { variant_id: string; qty: number }[]) => {
      const items = rows.filter((r) => r.qty > 0);
      if (!items.length) throw new Error("Enter a quantity to receive.");
      const { error } = await supabase.rpc("receive_po_items", {
        _biz: business.id,
        _id: id,
        _data: { items },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Stock received");
      setRecv({});
      refresh();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const d = doc.data;
  const canReceive =
    d && canEdit && ["draft", "approved", "partially_received"].includes(d.h.status);

  const remaining = (it: { qty: number; received_qty: number }) => it.qty - it.received_qty;

  return (
    <div>
      <PageHeader
        title={d ? d.h.po_no : "Purchase order"}
        sub={d ? `${d.h.suppliers?.name ?? ""} → ${d.h.branches?.name ?? ""}` : ""}
        actions={
          d && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => navigate({ to: "/app/purchase-orders" })}>
                Back
              </Button>
              {canEdit && ["draft", "approved"].includes(d.h.status) && (
                <Button asChild variant="outline">
                  <Link to="/app/purchase-orders/new" search={{ edit: d.h.id }}>
                    <Pencil className="mr-1 h-4 w-4" />
                    Edit
                  </Link>
                </Button>
              )}
              {canEdit && d.h.status === "draft" && (
                <Button disabled={setStatus.isPending} onClick={() => setStatus.mutate("approved")}>
                  <Check className="mr-1 h-4 w-4" />
                  Approve
                </Button>
              )}
              {canEdit && ["draft", "approved"].includes(d.h.status) && (
                <Button
                  variant="destructive"
                  disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate("cancelled")}
                >
                  <X className="mr-1 h-4 w-4" />
                  Cancel
                </Button>
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
                    <TableHead className="text-right">Ordered</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    {canReceive && <TableHead className="w-28 text-right">Receive</TableHead>}
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
                      <TableCell className="num text-right">{it.received_qty}</TableCell>
                      {canReceive && (
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            max={remaining(it)}
                            className="h-8 w-20 text-right"
                            value={recv[it.variant_id] ?? remaining(it)}
                            onChange={(e) =>
                              setRecv((r) => ({
                                ...r,
                                [it.variant_id]: Math.min(
                                  remaining(it),
                                  Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                                ),
                              }))
                            }
                          />
                        </TableCell>
                      )}
                      <TableCell className="num text-right">{bdt(it.line_total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {canReceive && (
              <div className="flex justify-end border-t p-3">
                <Button
                  disabled={receive.isPending}
                  onClick={() =>
                    receive.mutate(
                      d.items.map((it) => ({
                        variant_id: it.variant_id,
                        qty: recv[it.variant_id] ?? remaining(it),
                      })),
                    )
                  }
                >
                  <PackageCheck className="mr-1 h-4 w-4" />
                  {receive.isPending ? "Receiving…" : "Receive into stock"}
                </Button>
              </div>
            )}
          </div>

          <aside className="h-fit space-y-3 rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Status</span>
              <Badge variant={statusVariant(d.h.status)}>{d.h.status.replace("_", " ")}</Badge>
            </div>
            <dl className="border-t pt-2">
              <Row label="Order date">{d.h.po_date}</Row>
              <Row label="Expected">{d.h.expected_date ?? "—"}</Row>
              <Row label="Supplier">{d.h.suppliers?.name ?? "—"}</Row>
              <Row label="Branch">{d.h.branches?.name ?? "—"}</Row>
              <Row label="Subtotal">{bdt(d.h.subtotal)}</Row>
              <Row label="Discount">{bdt(d.h.discount)}</Row>
              <Row label="Tax">{bdt(d.h.tax)}</Row>
            </dl>
            <div className="num flex justify-between border-t pt-3 text-base font-semibold">
              <span>Total</span>
              <span>{bdt(d.h.total)}</span>
            </div>
            {d.h.notes && (
              <p className="border-t pt-3 text-xs text-muted-foreground">{d.h.notes}</p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
