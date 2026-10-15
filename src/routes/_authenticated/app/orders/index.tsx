import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { orderTypeLabel, orderStatusVariant } from "@/lib/order";
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

export const Route = createFileRoute("/_authenticated/app/orders/")({
  head: ({ matches }) => ({
    meta: [
      { title: `Orders & Bookings — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Bookings, layaways, orders and delivery tracking in ${matchedCompany(matches)}.`,
      },
    ],
  }),
  component: OrdersList,
});

function OrdersList() {
  const { business } = useBusiness();
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");

  const list = useQuery({
    queryKey: ["orders", business.id, type, status],
    queryFn: async () => {
      let query = supabase
        .from("orders")
        .select(
          "id,order_no,order_type,status,order_date,delivery_date,total,deposit,balance,customers(name,mobile),branches(name)",
        )
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })
        .limit(500);
      if (type !== "all") query = query.eq("order_type", type);
      if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const rows = useMemo(() => {
    const s = q.toLowerCase().trim();
    return (list.data ?? []).filter(
      (r) =>
        !s ||
        [r.order_no, r.customers?.name, r.customers?.mobile, r.branches?.name].some((x) =>
          (x ?? "").toLowerCase().includes(s),
        ),
    );
  }, [list.data, q]);

  const open = rows.filter(
    (r) => r.status !== "converted" && r.status !== "delivered" && r.status !== "cancelled",
  ).length;
  const delivered = rows.filter((r) => r.status === "delivered" || r.status === "converted").length;
  const bal = rows.reduce((a, r) => a + Number(r.balance), 0);

  return (
    <div>
      <PageHeader
        title="Orders & Bookings"
        sub={`${rows.length} records · ${bdt(bal)} balance · ${open} open · ${delivered} closed/delivered`}
        actions={
          <Button asChild>
            <Link to="/app/orders/new">
              <Plus className="mr-1 h-4 w-4" />
              New order/booking
            </Link>
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <select
          className={selectCls + " max-w-[10rem]"}
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="all">All types</option>
          <option value="booking">Booking</option>
          <option value="layaway">Layaway</option>
          <option value="order">Order</option>
        </select>
        <select
          className={selectCls + " max-w-[13rem]"}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">Any status</option>
          <option value="draft">Draft</option>
          <option value="booked">Booked</option>
          <option value="layaway">Layaway</option>
          <option value="confirmed">Confirmed</option>
          <option value="ready_for_delivery">Ready for delivery</option>
          <option value="out_for_delivery">Out for delivery</option>
          <option value="delivered">Delivered</option>
          <option value="converted">Converted</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <Input
          placeholder="Search number, customer, mobile, branch…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <div className="rounded-lg border bg-card">
        {list.error ? (
          <p className="p-6 text-sm text-destructive">{friendlyError(list.error)}</p>
        ) : !rows.length ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            No bookings/orders yet. Create one to track deposits and delivery.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Deposit</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        to="/app/orders/$id"
                        params={{ id: r.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.order_no}
                      </Link>
                    </TableCell>
                    <TableCell>{orderTypeLabel(r.order_type)}</TableCell>
                    <TableCell className="num">{r.order_date}</TableCell>
                    <TableCell className="num">{r.delivery_date ?? "—"}</TableCell>
                    <TableCell>{r.customers?.name ?? "Walk-in"}</TableCell>
                    <TableCell>{r.branches?.name}</TableCell>
                    <TableCell className="num text-right">{bdt(r.total)}</TableCell>
                    <TableCell className="num text-right">{bdt(r.deposit)}</TableCell>
                    <TableCell className="num text-right">{bdt(r.balance)}</TableCell>
                    <TableCell>
                      <Badge variant={orderStatusVariant(r.status)}>{r.status}</Badge>
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
