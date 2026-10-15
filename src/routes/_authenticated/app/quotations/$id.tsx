import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { toast } from "sonner";
import { ArrowRight, Check, Pencil, Printer, Send, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { docTypeLabel, statusVariant } from "@/lib/quote";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/app/quotations/$id")({
  head: ({ matches }) => ({
    meta: [
      { title: `Quotation — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Quotation, estimate and proforma documents in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Quotation — ${matchedCompany(matches)}` },
      { property: "og:description", content: "Priced offer ready to convert into a sale." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QuotationDetail,
});

const EDIT_ROLES = ["owner", "manager", "salesman", "branch_manager", "accountant"];

function QuotationDetail() {
  const { id } = Route.useParams();
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const { data, error, isLoading } = useQuery({
    queryKey: ["quotation", id],
    queryFn: async () => {
      const [h, items] = await Promise.all([
        supabase
          .from("quotations")
          .select(
            "*, customers(name,business_name,mobile,address), branches(name,address,phone), sales(invoice_no)",
          )
          .eq("id", id)
          .eq("business_id", business.id)
          .single(),
        supabase
          .from("quotation_items")
          .select("*, product_variants(sku,ram,storage,color,products(model,brands(name)))")
          .eq("quotation_id", id)
          .order("sort_order"),
      ]);
      if (h.error) throw h.error;
      if (items.error) throw items.error;
      return { h: h.data, items: items.data };
    },
  });

  const setStatus = useMutation({
    mutationFn: async (status: string) => {
      const { error: e } = await supabase.rpc("update_quotation_status", {
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

  const remove = useMutation({
    mutationFn: async () => {
      const { error: e } = await supabase.from("quotations").delete().eq("id", id);
      if (e) throw e;
    },
    onSuccess: () => {
      toast.success("Quotation deleted");
      qc.invalidateQueries({ queryKey: ["quotations"] });
      navigate({ to: "/app/quotations" });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="text-sm text-destructive">{friendlyError(error)}</p>;

  const { h, items } = data;
  const canEdit = EDIT_ROLES.includes(role);
  const isManager = role === "owner" || role === "manager";
  const editable = canEdit && h.status !== "converted";
  const convertible = editable && !["rejected", "cancelled", "expired"].includes(h.status);
  const deletable = isManager && ["draft", "cancelled"].includes(h.status);

  const statusButton = (label: string, status: string, icon: ReactNode) => (
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
          <Link to="/app/quotations">Back</Link>
        </Button>
        <Badge variant={statusVariant(h.status)}>{h.status}</Badge>
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
              <Link to="/app/quotations/new" search={{ edit: h.id }}>
                <Pencil className="mr-1 h-3.5 w-3.5" />
                Edit
              </Link>
            </Button>
          )}
          {editable &&
            h.status === "draft" &&
            statusButton("Mark sent", "sent", <Send className="mr-1 h-3.5 w-3.5" />)}
          {editable &&
            h.status !== "accepted" &&
            statusButton("Accepted", "accepted", <Check className="mr-1 h-3.5 w-3.5" />)}
          {editable && statusButton("Rejected", "rejected", <X className="mr-1 h-3.5 w-3.5" />)}
          {convertible && (
            <Button
              size="sm"
              onClick={() => navigate({ to: "/app/sales/new", search: { quote: h.id } })}
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
            Print / PDF
          </Button>
        </div>
      </div>

      {h.status === "converted" && h.sales?.invoice_no && (
        <p className="mb-4 rounded-md border border-success/40 bg-success/10 p-3 text-sm print:hidden">
          <Check className="mr-1 inline h-4 w-4 text-success" />
          Converted into invoice{" "}
          <Link
            to="/app/sales/$id"
            params={{ id: h.converted_sale_id! }}
            className="font-medium text-primary hover:underline"
          >
            {h.sales.invoice_no}
          </Link>
          .
        </p>
      )}

      <div className="rounded-lg border bg-card p-8 print:border-0 print:p-0">
        <div className="flex flex-wrap justify-between gap-4 border-b pb-4">
          <div>
            <div className="font-display text-xl font-bold">{business.name}</div>
            <div className="text-sm text-muted-foreground">
              {h.branches?.name}
              {business.address ? ` · ${business.address}` : ""}
            </div>
            {business.phone && (
              <div className="text-sm text-muted-foreground">{business.phone}</div>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {h.doc_type === "proforma"
                ? "Proforma invoice / প্রফর্মা"
                : h.doc_type === "estimate"
                  ? "Estimate / এস্টিমেট"
                  : "Quotation / কোটেশন"}
            </div>
            <div className="num font-display text-lg font-semibold">{h.quote_no}</div>
            <div className="num text-sm">{h.quote_date}</div>
            {h.valid_until && (
              <div className="num text-xs text-muted-foreground">Valid until {h.valid_until}</div>
            )}
          </div>
        </div>

        <div className="py-4 text-sm">
          <div className="text-xs uppercase text-muted-foreground">
            {h.doc_type === "proforma" ? "Proforma for" : "Prepared for"}
          </div>
          <div className="font-medium">
            {h.customers?.name ?? "Walk-in customer"}
            {h.customers?.business_name ? ` — ${h.customers.business_name}` : ""}
          </div>
          {h.customers?.mobile && <div className="num">{h.customers.mobile}</div>}
          {h.customers?.address && (
            <div className="text-muted-foreground">{h.customers.address}</div>
          )}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-y text-left text-xs uppercase text-muted-foreground">
              <th className="py-2">Item</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Price</th>
              <th className="text-right">Discount</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b align-top">
                <td className="py-2">
                  <div className="font-medium">
                    {it.product_variants?.products?.brands?.name}{" "}
                    {it.product_variants?.products?.model}{" "}
                    {[
                      it.product_variants?.ram,
                      it.product_variants?.storage,
                      it.product_variants?.color,
                    ]
                      .filter(Boolean)
                      .join(" / ")}
                  </div>
                  {it.description && (
                    <div className="text-xs text-muted-foreground">{it.description}</div>
                  )}
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
              <dd>−{bdt(h.discount)}</dd>
            </div>
          )}
          {Number(h.tax) > 0 && (
            <div className="flex justify-between">
              <dt>VAT / Tax</dt>
              <dd>{bdt(h.tax)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t pt-1 text-base font-semibold">
            <dt>Total</dt>
            <dd>{bdt(h.total)}</dd>
          </div>
        </dl>

        {h.notes && (
          <div className="mt-6 border-t pt-3 text-sm">
            <div className="text-xs uppercase text-muted-foreground">Notes</div>
            <p className="whitespace-pre-wrap">{h.notes}</p>
          </div>
        )}
        {h.terms && (
          <div className="mt-3 border-t pt-3 text-sm">
            <div className="text-xs uppercase text-muted-foreground">Terms & conditions</div>
            <p className="whitespace-pre-wrap text-muted-foreground">{h.terms}</p>
          </div>
        )}
        <div className="mt-8 border-t pt-3 text-xs text-muted-foreground">
          This {docTypeLabel(h.doc_type).toLowerCase()} is an offer and not a tax invoice. Prices
          are valid until the date shown. ধন্যবাদ!
        </div>
      </div>
    </div>
  );
}
