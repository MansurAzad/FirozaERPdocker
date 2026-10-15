import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Check, Pencil, Printer, Send, Trash2, X, Truck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { orderTypeLabel, orderStatusVariant } from "@/lib/order";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/app/orders/$id")({
  head: ({ matches }) => ({
    meta: [
      { title: `Order — ${matchedCompany(matches)}` },
      { name: "description", content: `Order/booking detail in ${matchedCompany(matches)}.` },
    ],
  }),
  component: OrderDetail,
});

const ROLES = ["owner", "manager", "salesman", "branch_manager", "accountant"];

function OrderDetail() {
  const { id } = Route.useParams();
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canEdit = ROLES.includes(role);

  const { data, error, isLoading } = useQuery({
    queryKey: ["order", id],
    queryFn: async () => {
      const [h, items, pays] = await Promise.all([
        supabase
          .from("orders")
          .select(
            "*, customers(name,business_name,mobile,address), branches(name,address,phone), sales(invoice_no)",
          )
          .eq("id", id)
          .eq("business_id", business.id)
          .single(),
        supabase
          .from("order_items")
          .select("*, product_variants(sku,ram,storage,color,products(model,brands(name)))")
          .eq("order_id", id)
          .order("sort_order"),
        supabase.from("order_payments").select("*").eq("order_id", id).order("payment_date"),
      ]);
      if (h.error) throw h.error;
      if (items.error) throw items.error;
      if (pays.error) throw pays.error;
      return { h: h.data, items: items.data, pays: pays.data };
    },
  });

  const setStatus = useMutation({
    mutationFn: async (status: string) => {
      const { error: e } = await supabase.rpc("update_order_status", {
        _biz: business.id,
        _id: id,
        _status: status,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      toast.success("Status updated");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const addPay = useMutation({
    mutationFn: async (amount: number) => {
      const { error: e } = await supabase.rpc("add_order_payment", {
        _biz: business.id,
        _id: id,
        _amount: amount,
      });
      if (e) throw e;
    },
    onSuccess: () => {
      toast.success("Payment added");
      qc.invalidateQueries();
      setAmt("");
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.from("orders").delete().eq("id", id);
      if (e) throw e;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["orders"] });
      navigate({ to: "/app/orders" });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const [amt, setAmt] = useState("");

  if (isLoading) return <p className="text-sm">Loading…</p>;
  if (error || !data) return <p className="text-sm text-destructive">{friendlyError(error)}</p>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { h, items, pays } = data as any;
  const editable =
    canEdit && h.status !== "converted" && h.status !== "delivered" && h.status !== "cancelled";
  const deletable =
    (role === "owner" || role === "manager") && (h.status === "draft" || h.status === "cancelled");
  const convertible =
    canEdit && h.status !== "converted" && h.status !== "delivered" && h.status !== "cancelled";

  const btn = (label: string, status: string, icon: ReactNode) => (
    <Button
      key={status}
      variant="outline"
      size="sm"
      disabled={setStatus.isPending}
      onClick={() => setStatus.mutate(status)}
    >
      {icon}
      {label}
    </Button>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Button asChild variant="outline" size="sm">
          <Link to="/app/orders">Back</Link>
        </Button>
        <Badge variant={orderStatusVariant(h.status)}>{h.status}</Badge>
        <Badge variant="outline">{orderTypeLabel(h.order_type)}</Badge>
        {h.converted_sale_id && (
          <Link
            to="/app/sales/$id"
            params={{ id: h.converted_sale_id }}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Sale {h.sales?.invoice_no ?? "record"} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {editable && (
            <Button asChild variant="outline" size="sm">
              <Link to="/app/orders/new" search={{ edit: h.id }}>
                <Pencil className="mr-1 h-3.5 w-3.5" />
                Edit
              </Link>
            </Button>
          )}
          {editable &&
            h.status === "draft" &&
            btn("Book", "booked", <Send className="mr-1 h-3.5 w-3.5" />)}
          {editable &&
            h.status === "booked" &&
            btn("Layaway", "layaway", <Send className="mr-1 h-3.5 w-3.5" />)}
          {editable && btn("Confirmed", "confirmed", <Check className="mr-1 h-3.5 w-3.5" />)}
          {editable &&
            btn("Ready for delivery", "ready_for_delivery", <Truck className="mr-1 h-3.5 w-3.5" />)}
          {editable &&
            btn("Out for delivery", "out_for_delivery", <Truck className="mr-1 h-3.5 w-3.5" />)}
          {editable && btn("Delivered", "delivered", <Check className="mr-1 h-3.5 w-3.5" />)}
          {editable && btn("Cancel", "cancelled", <X className="mr-1 h-3.5 w-3.5" />)}
          {convertible && (
            <Button
              size="sm"
              onClick={() => navigate({ to: "/app/sales/new", search: { order: h.id } })}
            >
              <ArrowRight className="mr-1 h-4 w-4" />
              Convert to sale
            </Button>
          )}
          {deletable && (
            <Button
              variant="outline"
              size="sm"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              <Trash2 className="mr-1 h-4 w-4 text-destructive" />
              Delete
            </Button>
          )}
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="mr-1 h-4 w-4" />
            Print
          </Button>
        </div>
      </div>
      <div className="rounded-lg border bg-card p-8 print:border-0 print:p-0">
        <div className="flex flex-wrap justify-between gap-4 border-b pb-4">
          <div>
            <div className="font-display text-xl font-bold">{business.name}</div>
            <div className="text-sm text-muted-foreground">{h.branches?.name}</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {orderTypeLabel(h.order_type)}
            </div>
            <div className="num font-display text-lg font-semibold">{h.order_no}</div>
            <div className="num text-sm">{h.order_date}</div>
            {h.delivery_date && (
              <div className="num text-xs text-muted-foreground">Delivery {h.delivery_date}</div>
            )}
          </div>
        </div>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-y text-left text-xs uppercase text-muted-foreground">
              <th className="py-2">Item</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Price</th>
              <th className="text-right">Disc</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {items.map((it: any) => (
              <tr key={it.id} className="border-b">
                <td className="py-2">
                  {it.product_variants?.products?.brands?.name}{" "}
                  {it.product_variants?.products?.model}
                </td>
                <td className="num text-right">{it.qty}</td>
                <td className="num text-right">{bdt(it.price)}</td>
                <td className="num text-right">
                  {Number(it.discount) > 0 ? bdt(it.discount) : "—"}
                </td>
                <td className="num text-right">{bdt(it.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="num ml-auto mt-4 max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{bdt(h.subtotal)}</dd>
          </div>
          {Number(h.discount) > 0 && (
            <div className="flex justify-between">
              <dt>Discount</dt>
              <dd>-{bdt(h.discount)}</dd>
            </div>
          )}
          {Number(h.tax) > 0 && (
            <div className="flex justify-between">
              <dt>Tax</dt>
              <dd>{bdt(h.tax)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt>Deposit</dt>
            <dd>{bdt(h.deposit)}</dd>
          </div>
          <div className="flex justify-between border-t pt-1 text-base font-semibold">
            <dt>Total</dt>
            <dd>{bdt(h.total)}</dd>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <dt>Balance</dt>
            <dd>{bdt(h.balance)}</dd>
          </div>
        </dl>
        {pays.length > 0 && (
          <div className="mt-6">
            <div className="text-xs uppercase text-muted-foreground mb-1">Payments</div>
            <div className="space-y-1 text-sm">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {pays.map((p: any) => (
                <div key={p.id} className="flex justify-between border-b pb-1">
                  <span className="num">
                    {p.payment_date} — {p.method} {p.reference ? `(${p.reference})` : ""}
                  </span>
                  <span className="num">{bdt(p.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {editable && (
          <div className="mt-6 flex gap-2 print:hidden">
            <Input
              placeholder="Add deposit amount"
              value={amt}
              onChange={(e) => setAmt(e.target.value)}
              className="max-w-xs"
            />
            <Button disabled={addPay.isPending || !amt} onClick={() => addPay.mutate(Number(amt))}>
              Add payment
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
