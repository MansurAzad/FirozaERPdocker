import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { hasAccess } from "@/lib/access-control";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, monthStart, today } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Json } from "@/integrations/supabase/types";

type SaleSummary = {
  items: { product: string; qty: number; price: number; minimum_price: number }[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  due: number;
  customer_current_due: number | null;
  customer_credit_limit: number | null;
};

function parseSaleSummary(value: Json): SaleSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rawItems = value["items"];
  if (!Array.isArray(rawItems)) return null;
  const items = rawItems.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const product = item["product"];
    const qty = item["qty"];
    const price = item["price"];
    const minimumPrice = item["minimum_price"];
    if (
      typeof product !== "string" ||
      typeof qty !== "number" ||
      typeof price !== "number" ||
      typeof minimumPrice !== "number"
    )
      return [];
    return [{ product, qty, price, minimum_price: minimumPrice }];
  });
  const subtotal = value["subtotal"];
  const discount = value["discount"];
  const tax = value["tax"];
  const total = value["total"];
  const paid = value["paid"];
  const due = value["due"];
  const customerCurrentDue = value["customer_current_due"] ?? null;
  const customerCreditLimit = value["customer_credit_limit"] ?? null;
  if (
    typeof subtotal !== "number" ||
    typeof discount !== "number" ||
    typeof tax !== "number" ||
    typeof total !== "number" ||
    typeof paid !== "number" ||
    typeof due !== "number" ||
    (customerCurrentDue !== null && typeof customerCurrentDue !== "number") ||
    (customerCreditLimit !== null && typeof customerCreditLimit !== "number")
  )
    return null;
  return {
    items,
    subtotal,
    discount,
    tax,
    total,
    paid,
    due,
    customer_current_due: customerCurrentDue,
    customer_credit_limit: customerCreditLimit,
  };
}

export const Route = createFileRoute("/_authenticated/app/sales/")({
  head: ({ matches }) => ({
    meta: [
      { title: `Sales History — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Sales History records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Sales History — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Sales History records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SalesList,
});

function SalesList() {
  const { business, role, access } = useBusiness();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [rejectId, setRejectId] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const canReview =
    role === "owner" || (role === "manager" && hasAccess(access, "sales", "approve"));
  const { data, error } = useQuery({
    queryKey: ["sales", business.id, from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select(
          "id,invoice_no,sale_date,total,paid,due,cogs,discount,tax,status,partner_financed,customers(name,mobile),branches(name)",
        )
        .eq("business_id", business.id)
        .gte("sale_date", from)
        .lte("sale_date", to)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data;
    },
  });
  const requests = useQuery({
    queryKey: ["sale-exception-requests", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sale_exception_requests")
        .select(
          "id,branch_id,customer_id,exception_types,sale_summary,sale_total,request_reason,status,requested_by,requested_at,reviewer_id,reviewed_at,rejection_reason,sale_id,branches(name),customers(name,mobile)",
        )
        .eq("business_id", business.id)
        .order("requested_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("approve_sale_exception", {
        _biz: business.id,
        _id: id,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Sale approved and posted.");
      qc.invalidateQueries({ queryKey: ["sale-exception-requests", business.id] });
      qc.invalidateQueries();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const reject = useMutation({
    mutationFn: async () => {
      if (!rejectId) throw new Error("Select an approval request to reject.");
      const { error } = await supabase.rpc("reject_sale_exception", {
        _biz: business.id,
        _id: rejectId,
        _reason: rejectReason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sale approval request rejected.");
      setRejectId("");
      setRejectReason("");
      qc.invalidateQueries({ queryKey: ["sale-exception-requests", business.id] });
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const rows = useMemo(() => {
    const s = q.toLowerCase().trim();
    return (data ?? []).filter(
      (r) =>
        !s ||
        [r.invoice_no, r.customers?.name, r.customers?.mobile].some((x) =>
          (x ?? "").toLowerCase().includes(s),
        ),
    );
  }, [data, q]);
  const showProfit = ["owner", "manager", "accountant"].includes(role);
  const t = rows.reduce(
    (a, r) => ({
      total: a.total + Number(r.total),
      due: a.due + Number(r.due),
      profit:
        a.profit + (r.partner_financed ? 0 : Number(r.total) - Number(r.tax) - Number(r.cogs)),
    }),
    { total: 0, due: 0, profit: 0 },
  );

  return (
    <div>
      <PageHeader
        title="Sales History"
        sub={`${rows.length} invoices · ${bdt(t.total)}${showProfit ? ` · gross profit excluding partner-financed sales ${bdt(t.profit)}` : ""} · due ${bdt(t.due)}`}
        actions={
          <Button asChild>
            <Link to="/app/sales/new">
              <Plus className="mr-1 h-4 w-4" />
              New Sale
            </Link>
          </Button>
        }
      />
      <section className="mb-6 rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
          <div>
            <h2 className="font-semibold">Sale exception approvals</h2>
            <p className="text-sm text-muted-foreground">
              Requests stay unposted until an independent owner or manager approves them.
            </p>
          </div>
          {requests.data?.some((request) => request.status === "pending") && (
            <Badge>
              {requests.data.filter((request) => request.status === "pending").length} pending
            </Badge>
          )}
        </div>
        {requests.error ? (
          <p className="p-4 text-sm text-destructive">{friendlyError(requests.error)}</p>
        ) : requests.isPending ? (
          <p className="p-4 text-sm text-muted-foreground">Loading approval requests…</p>
        ) : !requests.data?.length ? (
          <p className="p-4 text-sm text-muted-foreground">No sale approval requests.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Requested</TableHead>
                  <TableHead>Shop / customer</TableHead>
                  <TableHead>Exceptions</TableHead>
                  <TableHead>Proposed sale</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  {canReview && <TableHead className="text-right">Review</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.data.map((request) => {
                  const summary = parseSaleSummary(request.sale_summary);
                  return (
                    <TableRow key={request.id}>
                      <TableCell className="whitespace-nowrap">
                        {new Date(request.requested_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div>{request.branches?.name ?? "Shop"}</div>
                        <div className="text-sm text-muted-foreground">
                          {request.customers?.name ?? "Walk-in"}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-40">
                        {request.exception_types.map((type) => (
                          <Badge key={type} className="mb-1 mr-1" variant="outline">
                            {type.replaceAll("_", " ")}
                          </Badge>
                        ))}
                      </TableCell>
                      <TableCell className="min-w-64">
                        {summary ? (
                          <div className="space-y-1">
                            {summary.items.map((item, index) => (
                              <div key={`${item.product}-${index}`} className="text-sm">
                                {item.product} × {item.qty} @ {bdt(item.price)}
                                {item.price < item.minimum_price && (
                                  <span className="text-destructive">
                                    {" "}
                                    (min {bdt(item.minimum_price)})
                                  </span>
                                )}
                              </div>
                            ))}
                            <div className="border-t pt-1 text-sm">
                              Subtotal {bdt(summary.subtotal)} · Discount {bdt(summary.discount)} ·
                              Tax {bdt(summary.tax)}
                            </div>
                            <div className="text-sm">
                              Total {bdt(summary.total)} · Paid {bdt(summary.paid)} · Due{" "}
                              {bdt(summary.due)}
                            </div>
                            {summary.customer_credit_limit !== null && (
                              <div className="text-xs text-muted-foreground">
                                Customer due {bdt(summary.customer_current_due ?? 0)} / limit{" "}
                                {bdt(summary.customer_credit_limit)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-destructive">
                            Sale summary is unavailable.
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="min-w-48">{request.request_reason}</TableCell>
                      <TableCell>
                        <Badge variant={request.status === "pending" ? "default" : "outline"}>
                          {request.status}
                        </Badge>
                        {request.rejection_reason && (
                          <p className="mt-1 max-w-48 text-xs text-muted-foreground">
                            {request.rejection_reason}
                          </p>
                        )}
                        {request.sale_id && (
                          <Link
                            to="/app/sales/$id"
                            params={{ id: request.sale_id }}
                            className="mt-1 block text-xs text-primary hover:underline"
                          >
                            View posted sale
                          </Link>
                        )}
                      </TableCell>
                      {canReview && (
                        <TableCell className="text-right">
                          {request.status === "pending" ? (
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                disabled={approve.isPending || reject.isPending}
                                onClick={() => approve.mutate(request.id)}
                              >
                                Approve & post
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={approve.isPending || reject.isPending}
                                onClick={() => setRejectId(request.id)}
                              >
                                Reject
                              </Button>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              {request.reviewed_at
                                ? new Date(request.reviewed_at).toLocaleString()
                                : "—"}
                            </span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <F label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </F>
        <F label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </F>
        <Input
          placeholder="Search invoice, customer, mobile…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
      </div>
      <div className="rounded-lg border bg-card">
        {error ? (
          <p className="p-6 text-sm text-destructive">{friendlyError(error)}</p>
        ) : !rows.length ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No sales in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  {showProfit && <TableHead className="text-right">Profit</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        to="/app/sales/$id"
                        params={{ id: r.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {r.invoice_no}
                      </Link>
                      {r.partner_financed && (
                        <Badge className="ml-2" variant="outline">
                          Partner financed
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="num">{r.sale_date}</TableCell>
                    <TableCell>{r.customers?.name ?? "Walk-in"}</TableCell>
                    <TableCell>{r.branches?.name}</TableCell>
                    <TableCell className="num text-right">{bdt(r.total)}</TableCell>
                    <TableCell className="num text-right">
                      {r.partner_financed ? "—" : bdt(r.paid)}
                    </TableCell>
                    <TableCell
                      className={
                        "num text-right " +
                        (Number(r.due) > 0 && !r.partner_financed
                          ? "font-semibold text-destructive"
                          : "text-muted-foreground")
                      }
                    >
                      {r.partner_financed ? "—" : bdt(r.due)}
                    </TableCell>
                    {showProfit && (
                      <TableCell className="num text-right">
                        {r.partner_financed
                          ? "—"
                          : bdt(Number(r.total) - Number(r.tax) - Number(r.cogs))}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      <AlertDialog
        open={Boolean(rejectId)}
        onOpenChange={(open) => {
          if (!open) {
            setRejectId("");
            setRejectReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject sale request</AlertDialogTitle>
            <AlertDialogDescription>
              Give the shop manager a reason. The request will remain in the audit history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            aria-label="Rejection reason"
            maxLength={1000}
            placeholder="Reason for rejection"
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reject.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!rejectReason.trim() || reject.isPending}
              onClick={(event) => {
                event.preventDefault();
                reject.mutate();
              }}
            >
              {reject.isPending ? "Rejecting…" : "Reject request"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
