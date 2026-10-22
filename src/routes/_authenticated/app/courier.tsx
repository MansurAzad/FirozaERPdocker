import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Printer, Save, Send, Truck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { orderStatusVariant } from "@/lib/order";
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

export const Route = createFileRoute("/_authenticated/app/courier")({
  head: ({ matches }) => ({
    meta: [
      { title: `Courier & Delivery — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Dispatch orders, assign couriers and record tracking numbers in ${matchedCompany(matches)}.`,
      },
    ],
  }),
  component: CourierBoard,
});

type DeliveryStatus = "confirmed" | "ready_for_delivery" | "out_for_delivery" | "delivered";

type OrderRow = {
  id: string;
  order_no: string;
  status: string;
  order_date: string;
  delivery_date: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_note: string | null;
  courier_name: string | null;
  tracking_no: string | null;
  total: number;
  balance: number;
  customers: { name: string | null; mobile: string | null } | null;
  branches: { name: string | null } | null;
};

const DELIVERY_STATUSES = ["confirmed", "ready_for_delivery", "out_for_delivery", "delivered"];

const STATUS_OPTIONS: { value: DeliveryStatus; label: string }[] = [
  { value: "confirmed", label: "Confirmed" },
  { value: "ready_for_delivery", label: "Ready for delivery" },
  { value: "out_for_delivery", label: "Out for delivery" },
  { value: "delivered", label: "Delivered" },
];

const TABS: { key: string; label: string; statuses: string[] }[] = [
  { key: "queue", label: "Dispatch queue", statuses: ["confirmed", "ready_for_delivery"] },
  { key: "transit", label: "In transit", statuses: ["out_for_delivery"] },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] },
  { key: "all", label: "All", statuses: [] },
];

const ESC_MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ESC_MAP[c] ?? c);
}

function printSlip(row: OrderRow, company: string) {
  const w = window.open("", "_blank", "width=420,height=680");
  if (!w) {
    toast.error("Allow pop-ups to print the delivery slip.");
    return;
  }
  const line = (label: string, value: unknown) =>
    `<div class="row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8" />
<title>${esc(row.order_no)}</title>
<style>
  *{box-sizing:border-box} body{font-family:system-ui,Segoe UI,sans-serif;margin:0;padding:16px;color:#111}
  h1{font-size:15px;margin:0 0 2px} .muted{color:#555;font-size:11px;margin:0 0 10px}
  .hr{border-top:1px dashed #999;margin:10px 0}
  .row{display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:2px 0}
  .row span{color:#555}
  .addr{font-size:12px;white-space:pre-wrap;margin-top:4px}
  .big{font-size:13px;font-weight:700}
  .tag{display:inline-block;border:1px solid #111;border-radius:4px;padding:1px 6px;font-size:11px}
</style></head><body>
<h1>${esc(company)}</h1>
<p class="muted">Delivery slip · ${esc(row.branches?.name ?? "")}</p>
<div class="hr"></div>
${line("Order", row.order_no)}
${line("Order date", row.order_date)}
${line("Delivery date", row.delivery_date ?? "—")}
<div class="hr"></div>
${line("Customer", row.customers?.name ?? "Walk-in")}
${line("Mobile", row.customers?.mobile ?? "—")}
<div class="addr"><b>Deliver to:</b><br />${esc(row.delivery_address ?? "—")}${
    row.delivery_city ? `, ${esc(row.delivery_city)}` : ""
  }</div>
<div class="hr"></div>
${line("Courier", row.courier_name ?? "—")}
${line("Tracking", row.tracking_no ?? "—")}
<div class="hr"></div>
${line("Total", bdt(row.total))}
${line("Balance due", bdt(row.balance))}
${row.delivery_note ? `<div class="hr"></div><div class="addr"><b>Note:</b> ${esc(row.delivery_note)}</div>` : ""}
<div class="hr"></div>
<p class="tag">${esc(row.status.replace(/_/g, " "))}</p>
<script>window.onload=function(){window.print()}</script>
</body></html>`);
  w.document.close();
}

function CourierBoard() {
  const { business } = useBusiness();
  const qc = useQueryClient();
  const [tab, setTab] = useState("queue");
  const [courierFilter, setCourierFilter] = useState("all");
  const [q, setQ] = useState("");

  const list = useQuery({
    queryKey: ["courier-board", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id,order_no,status,order_date,delivery_date,delivery_address,delivery_city,delivery_note,courier_name,tracking_no,total,balance,customers(name,mobile),branches(name)",
        )
        .eq("business_id", business.id)
        .in("status", DELIVERY_STATUSES)
        .order("order_date", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as OrderRow[];
    },
  });

  const all = useMemo(() => list.data ?? [], [list.data]);

  const courierOptions = useMemo(
    () => Array.from(new Set(all.map((r) => (r.courier_name ?? "").trim()).filter(Boolean))).sort(),
    [all],
  );

  const tabStatuses = useMemo(() => TABS.find((t) => t.key === tab)?.statuses ?? [], [tab]);

  const rows = useMemo(() => {
    const s = q.toLowerCase().trim();
    return all.filter((r) => {
      if (tabStatuses.length && !tabStatuses.includes(r.status)) return false;
      if (courierFilter !== "all" && (r.courier_name ?? "") !== courierFilter) return false;
      if (
        s &&
        ![r.order_no, r.customers?.name, r.customers?.mobile, r.tracking_no, r.courier_name].some(
          (x) => (x ?? "").toLowerCase().includes(s),
        )
      )
        return false;
      return true;
    });
  }, [all, tabStatuses, courierFilter, q]);

  const count = (statuses: string[]) => all.filter((r) => statuses.includes(r.status)).length;
  const inFlight = all.filter((r) => r.status === "confirmed" || r.status === "ready_for_delivery");
  const inTransit = count(["out_for_delivery"]);
  const delivered = count(["delivered"]);
  const pendingValue = all
    .filter((r) => r.status !== "delivered")
    .reduce((s, r) => s + Number(r.balance ?? 0), 0);

  const refresh = () => qc.invalidateQueries({ queryKey: ["courier-board"] });

  return (
    <div>
      <PageHeader
        title="Courier & Delivery"
        sub="Assign couriers, record tracking numbers and move orders through to delivery."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Dispatch queue" value={String(inFlight.length)} tone="text-amber-600" />
        <StatCard label="In transit" value={String(inTransit)} tone="text-blue-600" />
        <StatCard label="Delivered" value={String(delivered)} tone="text-emerald-600" />
        <StatCard label="Balance to collect" value={bdt(pendingValue)} tone="text-foreground" />
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="inline-flex flex-wrap rounded-md border bg-card p-0.5">
          {TABS.map((t) => {
            const active = tab === t.key;
            const n = t.statuses.length ? count(t.statuses) : all.length;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={
                  "rounded px-3 py-1.5 text-sm transition-colors " +
                  (active ? "bg-primary text-primary-foreground" : "text-muted-foreground")
                }
              >
                {t.label}
                <span className="num ml-1 opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        <select
          className={selectCls + " max-w-[12rem]"}
          value={courierFilter}
          onChange={(e) => setCourierFilter(e.target.value)}
        >
          <option value="all">Any courier</option>
          {courierOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <Input
          placeholder="Search order, customer, mobile, tracking…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          <Truck className="h-4 w-4" />
          <span className="num">{rows.length} shown</span>
        </div>
      </div>

      <datalist id="courier-options">
        {courierOptions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="rounded-lg border bg-card">
        {list.error ? (
          <p className="p-6 text-sm text-destructive">{friendlyError(list.error)}</p>
        ) : !rows.length ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            Nothing here. Orders moved to Confirmed or Ready for delivery appear on this board.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer &amp; address</TableHead>
                  <TableHead>Courier</TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead>Delivery date</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <DeliveryRow
                    key={r.id}
                    row={r}
                    businessId={business.id}
                    company={business.name}
                    onDone={refresh}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-card p-3">
      <p className="break-words text-xs text-muted-foreground">{label}</p>
      <p className={"num break-words text-base font-semibold sm:text-lg " + tone}>{value}</p>
    </div>
  );
}

function DeliveryRow({
  row,
  businessId,
  company,
  onDone,
}: {
  row: OrderRow;
  businessId: string;
  company: string;
  onDone: () => void;
}) {
  const [courier, setCourier] = useState(row.courier_name ?? "");
  const [tracking, setTracking] = useState(row.tracking_no ?? "");
  const [date, setDate] = useState(row.delivery_date ?? "");
  const [status, setStatus] = useState<string>(row.status);

  const save = useMutation({
    mutationFn: async (override?: Partial<{ status: DeliveryStatus }>) => {
      const { error } = await supabase.rpc("set_order_delivery", {
        _biz: businessId,
        _id: row.id,
        _data: {
          courier_name: courier.trim(),
          tracking_no: tracking.trim(),
          delivery_date: date || null,
          status: override?.status ?? status,
        },
      });
      if (error) throw error;
    },
    onSuccess: (_d, override) => {
      toast.success(override?.status === "delivered" ? "Marked delivered" : "Delivery updated");
      onDone();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const busy = save.isPending;
  const dirty =
    courier.trim() !== (row.courier_name ?? "") ||
    tracking.trim() !== (row.tracking_no ?? "") ||
    date !== (row.delivery_date ?? "") ||
    status !== row.status;

  const address = [row.delivery_address, row.delivery_city].filter(Boolean).join(", ");

  return (
    <TableRow>
      <TableCell className="align-top">
        <Link
          to="/app/orders/$id"
          params={{ id: row.id }}
          className="font-medium text-primary hover:underline"
        >
          {row.order_no}
        </Link>
        <div className="num text-xs text-muted-foreground">{row.order_date}</div>
        <div className="num text-xs">{bdt(row.total)}</div>
      </TableCell>
      <TableCell className="max-w-[16rem] align-top">
        <div>{row.customers?.name ?? "Walk-in"}</div>
        {row.customers?.mobile ? (
          <div className="num text-xs text-muted-foreground">{row.customers.mobile}</div>
        ) : null}
        {address ? <div className="text-xs text-muted-foreground">{address}</div> : null}
      </TableCell>
      <TableCell className="align-top">
        <Input
          list="courier-options"
          value={courier}
          onChange={(e) => setCourier(e.target.value)}
          placeholder="Courier name"
          className="h-8 w-36"
        />
      </TableCell>
      <TableCell className="align-top">
        <Input
          value={tracking}
          onChange={(e) => setTracking(e.target.value)}
          placeholder="Tracking no"
          className="h-8 w-36"
        />
      </TableCell>
      <TableCell className="align-top">
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-8 w-36"
        />
      </TableCell>
      <TableCell className="num align-top text-right">{bdt(row.balance)}</TableCell>
      <TableCell className="align-top">
        <select
          className={selectCls + " h-8 max-w-[10rem]"}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="mt-1">
          <Badge variant={orderStatusVariant(row.status)}>{row.status.replace(/_/g, " ")}</Badge>
        </div>
      </TableCell>
      <TableCell className="align-top text-right">
        <div className="flex flex-wrap justify-end gap-1">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !dirty}
            onClick={() => save.mutate({})}
          >
            <Save className="mr-1 h-4 w-4" />
            Save
          </Button>
          {row.status !== "out_for_delivery" && row.status !== "delivered" ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => save.mutate({ status: "out_for_delivery" })}
            >
              <Send className="mr-1 h-4 w-4" />
              Dispatch
            </Button>
          ) : null}
          {row.status !== "delivered" ? (
            <Button size="sm" disabled={busy} onClick={() => save.mutate({ status: "delivered" })}>
              <PackageCheck className="mr-1 h-4 w-4" />
              Delivered
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => printSlip(row, company)}>
            <Printer className="mr-1 h-4 w-4" />
            Slip
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
