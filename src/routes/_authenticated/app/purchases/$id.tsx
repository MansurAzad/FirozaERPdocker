import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { ReturnDialog, type ReturnLine } from "@/components/erp/ReturnDialog";
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

export const Route = createFileRoute("/_authenticated/app/purchases/$id")({
  head: ({ matches }) => ({
    meta: [
      { title: `Purchase — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Purchase records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Purchase — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Purchase records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PurchaseDetail,
});

function PurchaseDetail() {
  const { id } = Route.useParams();
  const { business, role } = useBusiness();
  const { data, error, isLoading } = useQuery({
    queryKey: ["purchase", id],
    queryFn: async () => {
      const [p, items, pays, rets] = await Promise.all([
        supabase
          .from("purchases")
          .select("*, suppliers(name,company,mobile), branches(name)")
          .eq("id", id)
          .eq("business_id", business.id)
          .single(),
        supabase
          .from("purchase_items")
          .select(
            "*, product_variants(sku,ram,storage,color,products(model,brands(name),categories(is_serialized))), product_imeis(id,imei1,imei2,serial_no,status)",
          )
          .eq("purchase_id", id),
        supabase.from("supplier_payments").select("*").eq("purchase_id", id),
        supabase
          .from("purchase_returns")
          .select(
            "id,return_no,return_date,total,refund,purchase_return_items(purchase_item_id,qty)",
          )
          .eq("purchase_id", id)
          .order("created_at"),
      ]);
      for (const x of [p, items, pays, rets]) if (x.error) throw x.error;
      return { p: p.data!, items: items.data!, pays: pays.data!, rets: rets.data! };
    },
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="text-sm text-destructive">{friendlyError(error)}</p>;
  const { p, items, pays, rets } = data;
  const extras: [string, number][] = [
    ["Discount", -Number(p.discount)],
    ["VAT / Tax", Number(p.tax)],
    ["Transport", Number(p.transport_cost)],
    ["Loading", Number(p.loading_cost)],
    ["Courier", Number(p.courier_cost)],
    ["Insurance", Number(p.insurance_cost)],
    ["Other", Number(p.other_cost)],
  ];
  const returned: Record<string, number> = {};
  rets.forEach((r) =>
    r.purchase_return_items.forEach((x) => {
      returned[x.purchase_item_id] = (returned[x.purchase_item_id] ?? 0) + x.qty;
    }),
  );
  const retLines: ReturnLine[] = items.map((it) => {
    const serial = it.product_variants?.products?.categories?.is_serialized ?? false;
    return {
      id: it.id,
      label: `${it.product_variants?.products?.brands?.name ?? ""} ${it.product_variants?.products?.model ?? ""} · ${it.product_variants?.sku ?? ""}`,
      remaining: it.qty - (returned[it.id] ?? 0),
      unitValue: Number(it.landed_unit_cost),
      ...(serial
        ? {
            imeis: it.product_imeis
              .filter((im) => im.status === "IN_STOCK")
              .map((im) => ({ id: im.id, imei1: im.imei1 })),
          }
        : {}),
    };
  });
  const canReturn =
    ["owner", "manager", "purchase_officer", "accountant"].includes(role) && p.status === "posted";

  return (
    <div className="space-y-6">
      <PageHeader
        title={p.invoice_no}
        sub={`${p.purchase_date} · ${p.suppliers?.name} · received at ${p.branches?.name}`}
        actions={
          <>
            {canReturn && (
              <ReturnDialog
                kind="purchase"
                docId={p.id}
                lines={retLines}
                partyLabel={`${p.invoice_no} · ${p.suppliers?.name ?? ""}`}
              />
            )}
            <Button variant="outline" onClick={() => window.print()}>
              Print
            </Button>
            <Button asChild variant="outline">
              <Link to="/app/purchases">Back</Link>
            </Button>
          </>
        }
      />
      {rets.length > 0 && (
        <div className="rounded-lg border border-dashed bg-card p-4 text-sm">
          <h2 className="mb-2 font-semibold">Returns to supplier</h2>
          {rets.map((r) => (
            <div key={r.id} className="num flex justify-between">
              <span>
                {r.return_no} · {r.return_date}
              </span>
              <span>
                −{bdt(r.total)}
                {Number(r.refund) > 0 ? ` (refund ${bdt(r.refund)})` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
        {[
          ["Actual cost", p.total],
          ["Paid", p.paid],
          ["Supplier due", p.due],
        ].map(([l, v]) => (
          <div key={l as string} className="bg-card p-4">
            <div className="text-xs uppercase text-muted-foreground">{l}</div>
            <div className="num mt-1 font-display text-2xl font-semibold">{bdt(v as number)}</div>
          </div>
        ))}
      </div>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Line</TableHead>
              <TableHead className="text-right">Landed / unit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it) => (
              <TableRow key={it.id} className="align-top">
                <TableCell>
                  <div className="font-medium">
                    {it.product_variants?.products?.brands?.name}{" "}
                    {it.product_variants?.products?.model}
                  </div>
                  <div className="text-xs text-muted-foreground">{it.product_variants?.sku}</div>
                  {it.product_imeis.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {it.product_imeis.map((im) => (
                        <Link key={im.imei1} to="/app/imei" search={{ q: im.imei1 }}>
                          <Badge variant="outline" className="num font-mono text-[11px]">
                            {im.imei1}
                            {im.imei2 ? ` / ${im.imei2}` : ""}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="num text-right">{it.qty}</TableCell>
                <TableCell className="num text-right">{bdt(it.rate)}</TableCell>
                <TableCell className="num text-right">{bdt(it.line_total)}</TableCell>
                <TableCell className="num text-right font-semibold">
                  {bdt(it.landed_unit_cost)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <dl className="num ml-auto max-w-xs space-y-1 border-t p-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Product purchase</dt>
            <dd>{bdt(p.subtotal)}</dd>
          </div>
          {extras
            .filter(([, v]) => v !== 0)
            .map(([l, v]) => (
              <div key={l} className="flex justify-between">
                <dt className="text-muted-foreground">{l}</dt>
                <dd>{bdt(v)}</dd>
              </div>
            ))}
          <div className="flex justify-between border-t pt-1 font-semibold">
            <dt>Actual cost</dt>
            <dd>{bdt(p.total)}</dd>
          </div>
        </dl>
      </div>
      {pays.length > 0 && (
        <div className="rounded-lg border bg-card p-4 text-sm">
          <h2 className="mb-2 font-semibold">Payments</h2>
          {pays.map((x) => (
            <div key={x.id} className="num flex justify-between">
              <span>
                {x.paid_on} · {x.method}
                {x.txn_ref ? ` · ${x.txn_ref}` : ""}
              </span>
              <span>{bdt(x.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
