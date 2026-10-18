import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { methodLabel } from "@/components/erp/ui";
import { ReturnDialog, type ReturnLine } from "@/components/erp/ReturnDialog";
import { Attachments } from "@/components/erp/Attachments";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/app/sales/$id")({
  head: ({ matches }) => ({
    meta: [
      { title: `Invoice — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Invoice records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Invoice — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Invoice records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Invoice,
});

function Invoice() {
  const { id } = Route.useParams();
  const { business, role } = useBusiness();
  const { data, error, isLoading } = useQuery({
    queryKey: ["sale", business.id, id],
    queryFn: async () => {
      const [s, items, pays, rets] = await Promise.all([
        supabase
          .from("sales")
          .select("*, customers(name,business_name,mobile,address), branches(name,address,phone)")
          .eq("id", id)
          .eq("business_id", business.id)
          .single(),
        supabase
          .from("sale_items")
          .select(
            "*, product_variants(sku,ram,storage,color,products(model,brands(name))), product_imeis!sale_items_imei_id_fkey(imei1,imei2)",
          )
          .eq("business_id", business.id)
          .eq("sale_id", id),
        supabase
          .from("customer_payments")
          .select("amount,method,txn_ref")
          .eq("business_id", business.id)
          .eq("sale_id", id),
        supabase
          .from("sales_returns")
          .select("id,return_no,return_date,total,refund,sales_return_items(sale_item_id,qty)")
          .eq("business_id", business.id)
          .eq("sale_id", id)
          .order("created_at"),
      ]);
      for (const x of [s, items, pays, rets]) if (x.error) throw x.error;
      return { s: s.data!, items: items.data!, pays: pays.data!, rets: rets.data! };
    },
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="text-sm text-destructive">{friendlyError(error)}</p>;
  const { s, items, pays, rets } = data;
  const returned: Record<string, number> = {};
  rets.forEach((r) =>
    r.sales_return_items.forEach((x) => {
      returned[x.sale_item_id] = (returned[x.sale_item_id] ?? 0) + x.qty;
    }),
  );
  const retLines: ReturnLine[] = items.map((it) => ({
    id: it.id,
    label: `${it.product_variants?.products?.brands?.name ?? ""} ${it.product_variants?.products?.model ?? ""} ${[it.product_variants?.ram, it.product_variants?.storage, it.product_variants?.color].filter(Boolean).join(" / ")}`,
    remaining: it.qty - (returned[it.id] ?? 0),
    unitValue: Number(it.price),
    imeiLabel: it.product_imeis?.imei1 ?? null,
  }));
  const canReturn =
    !s.partner_financed &&
    ["owner", "manager", "branch_manager", "accountant"].includes(role) &&
    s.status === "posted";
  const profit = Number(s.total) - Number(s.tax) - Number(s.cogs);
  const showProfit = !s.partner_financed && ["owner", "manager", "accountant"].includes(role);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex justify-between print:hidden">
        <Button asChild variant="outline">
          <Link to="/app/sales">Back</Link>
        </Button>
        <div className="flex gap-2">
          {showProfit && (
            <span className="num self-center text-sm text-muted-foreground">
              Gross profit {bdt(profit)}
            </span>
          )}
          {canReturn && (
            <ReturnDialog
              kind="sale"
              docId={s.id}
              lines={retLines}
              partyLabel={`${s.invoice_no} · ${s.customers?.name ?? "Walk-in"}`}
            />
          )}
          <Button onClick={() => window.print()}>
            <Printer className="mr-1 h-4 w-4" />
            Print / PDF
          </Button>
        </div>
      </div>
      <div className="rounded-lg border bg-card p-8 print:border-0 print:p-0">
        {s.partner_financed && (
          <div className="mb-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
            Partner-financed sale. Customer down payment and provider settlement are tracked in{" "}
            <Link to="/app/partner-finance" className="font-medium text-primary underline">
              Partner Finance
            </Link>
            ; no customer payment or due is posted here.
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-4 border-b pb-4">
          <div>
            <div className="font-display text-xl font-bold">{business.name}</div>
            <div className="text-sm text-muted-foreground">
              {s.branches?.name}
              {business.address ? ` · ${business.address}` : ""}
            </div>
            {business.phone && (
              <div className="text-sm text-muted-foreground">{business.phone}</div>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Invoice / চালান
            </div>
            <div className="num font-display text-lg font-semibold">{s.invoice_no}</div>
            <div className="num text-sm">{s.sale_date}</div>
          </div>
        </div>
        <div className="py-4 text-sm">
          <div className="text-xs uppercase text-muted-foreground">Bill to</div>
          <div className="font-medium">
            {s.customers?.name ?? "Walk-in customer"}
            {s.customers?.business_name ? ` — ${s.customers.business_name}` : ""}
          </div>
          {s.customers?.mobile && <div className="num">{s.customers.mobile}</div>}
          {s.customers?.address && (
            <div className="text-muted-foreground">{s.customers.address}</div>
          )}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y text-left text-xs uppercase text-muted-foreground">
              <th className="py-2">Item</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Price</th>
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
                  {it.product_imeis && (
                    <div className="num font-mono text-xs text-muted-foreground">
                      IMEI: {it.product_imeis.imei1}
                      {it.product_imeis.imei2 ? ` / ${it.product_imeis.imei2}` : ""}
                    </div>
                  )}
                  {it.warranty_months > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Warranty: {it.warranty_months} months
                    </div>
                  )}
                </td>
                <td className="num text-right">{it.qty}</td>
                <td className="num text-right">{bdt(it.price)}</td>
                <td className="num text-right">{bdt(it.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="num ml-auto mt-4 max-w-xs space-y-1 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{bdt(s.subtotal)}</dd>
          </div>
          {Number(s.discount) > 0 && (
            <div className="flex justify-between">
              <dt>Discount</dt>
              <dd>−{bdt(s.discount)}</dd>
            </div>
          )}
          {Number(s.tax) > 0 && (
            <div className="flex justify-between">
              <dt>VAT / Tax</dt>
              <dd>{bdt(s.tax)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t pt-1 text-base font-semibold">
            <dt>Total</dt>
            <dd>{bdt(s.total)}</dd>
          </div>
          {!s.partner_financed && (
            <>
              <div className="flex justify-between">
                <dt>Paid</dt>
                <dd>{bdt(s.paid)}</dd>
              </div>
              <div className="flex justify-between font-semibold">
                <dt>Due</dt>
                <dd>{bdt(s.due)}</dd>
              </div>
            </>
          )}
        </dl>
        {pays.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Payment:{" "}
            {pays
              .map(
                (p) =>
                  `${methodLabel(p.method)} ${bdt(p.amount)}${p.txn_ref ? ` (${p.txn_ref})` : ""}`,
              )
              .join(", ")}
          </p>
        )}
        {rets.length > 0 && (
          <div className="mt-3 rounded-md border border-dashed p-3 text-xs">
            <div className="mb-1 font-semibold uppercase text-muted-foreground">Returns</div>
            {rets.map((r) => (
              <div key={r.id} className="num flex justify-between">
                <span>
                  {r.return_no} · {r.return_date}
                </span>
                <span>
                  −{bdt(r.total)}
                  {Number(r.refund) > 0 ? ` (refunded ${bdt(r.refund)})` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-8 border-t pt-3 text-xs text-muted-foreground">
          {s.partner_financed
            ? "Returns for partner-financed sales must be handled outside the standard sales-return workflow."
            : "Goods once sold are subject to the shop's return policy."}{" "}
          Warranty is valid against IMEI with this invoice. ধন্যবাদ!
        </div>
      </div>
    </div>
  );
}
