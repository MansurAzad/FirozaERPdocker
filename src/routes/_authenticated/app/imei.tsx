import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Search, ShoppingCart, Wrench, ArrowLeftRight, Copy, Undo2, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { Input } from "@/components/ui/input";
import { ScanButton } from "@/components/erp/ScanButton";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/app/imei")({
  validateSearch: z.object({
    q: z
      .union([z.string(), z.number()])
      .optional()
      .transform((v) => (v == null ? undefined : String(v))),
  }),
  head: ({ matches }) => ({
    meta: [
      { title: `IMEI Search — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `IMEI Search records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `IMEI Search — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `IMEI Search records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ImeiPage,
});

function ImeiPage() {
  const { business } = useBusiness();
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [text, setText] = useState(q ?? "");
  const raw = (q ?? "").trim();
  const code = raw.replace(/\D/g, "");

  const { data, isFetching, error } = useQuery({
    enabled: code.length >= 4 || raw.length >= 3,
    queryKey: ["imei", business.id, raw],
    queryFn: async () => {
      const col =
        "id,imei1,imei2,serial_no,status,cost,created_at,branches(name),product_variants(sku,ram,storage,color,retail_price,products(model,brands(name),categories(name))),purchase_items(rate,purchases(id,invoice_no,purchase_date,suppliers(name,mobile))),sale_items!product_imeis_sale_item_id_fkey(price,warranty_months,sales(id,invoice_no,sale_date,customer_id,customers(id,name,mobile)))";
      const base = () => supabase.from("product_imeis").select(col).eq("business_id", business.id);
      const exact =
        code.length === 15
          ? await base().or(`imei1.eq.${code},imei2.eq.${code}`).limit(5)
          : code.length >= 4
            ? await base()
                .or(`imei1.like.%${code}%,imei2.like.%${code}%,serial_no.ilike.%${raw}%`)
                .limit(20)
            : await base().ilike("serial_no", `%${raw}%`).limit(20);
      if (exact.error) throw exact.error;
      const ids = exact.data.map((d) => d.id);
      const [mv, wc, sr, pr, tr] = ids.length
        ? await Promise.all([
            supabase
              .from("stock_movements")
              .select("*, branches(name)")
              .in("imei_id", ids)
              .order("created_at"),
            supabase
              .from("warranty_claims")
              .select("id,imei_id,claim_no,claim_date,issue,status,resolution")
              .in("imei_id", ids)
              .order("claim_date"),
            supabase
              .from("sales_return_items")
              .select("id,imei_id,price,sales_returns(id,return_no,return_date,reason,sale_id)")
              .in("imei_id", ids),
            supabase
              .from("purchase_return_items")
              .select(
                "id,imei_id,unit_cost,purchase_returns(id,return_no,return_date,reason,purchase_id)",
              )
              .in("imei_id", ids),
            supabase
              .from("stock_transfer_items")
              .select(
                "id,imei_id,stock_transfers(id,transfer_no,transfer_date,status,from:branches!stock_transfers_from_branch_id_fkey(name),to:branches!stock_transfers_to_branch_id_fkey(name))",
              )
              .in("imei_id", ids),
          ])
        : [
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
          ];
      for (const x of [mv, wc, sr, pr, tr]) if (x.error) throw x.error;
      return {
        devices: exact.data,
        moves: mv.data ?? [],
        claims: wc.data ?? [],
        sret: sr.data ?? [],
        pret: pr.data ?? [],
        trf: tr.data ?? [],
      };
    },
  });

  return (
    <div>
      <PageHeader title="IMEI Search" sub="এই ফোনটি কোথা থেকে এসেছে এবং কার কাছে বিক্রি হয়েছে?" />
      <form
        className="mb-6 flex max-w-lg gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ search: { q: text.trim() } });
        }}
      >
        <Input
          autoFocus
          placeholder="IMEI (15 digits or last 4+), or serial number"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="num font-mono"
        />
        <ScanButton
          multi={false}
          onCodes={(c) => {
            setText(c[0] ?? "");
            navigate({ search: { q: c[0] ?? "" } });
          }}
        />
        <Button>
          <Search className="mr-1 h-4 w-4" />
          Search
        </Button>
      </form>
      {error && <p className="text-sm text-destructive">{friendlyError(error)}</p>}
      {isFetching && <p className="text-sm text-muted-foreground">Searching…</p>}
      {data && data.devices.length === 0 && (
        <p className="text-sm text-muted-foreground">No device found with this IMEI.</p>
      )}
      <div className="space-y-4">
        {data?.devices.map((d) => {
          const pur = d.purchase_items?.purchases;
          const si = d.sale_items;
          const sale = si?.sales;
          let wEnd: string | null = null;
          if (sale && si && si.warranty_months > 0) {
            const e = new Date(sale.sale_date);
            e.setMonth(e.getMonth() + si.warranty_months);
            wEnd = e.toISOString().slice(0, 10);
          }
          const wActive = wEnd ? wEnd >= new Date().toISOString().slice(0, 10) : false;
          const claims = data.claims.filter((c) => c.imei_id === d.id);
          const sret = data.sret.filter((x) => x.imei_id === d.id);
          const pret = data.pret.filter((x) => x.imei_id === d.id);
          const trf = data.trf.filter((x) => x.imei_id === d.id);
          const days = Math.floor((Date.now() - new Date(d.created_at).getTime()) / 86400000);
          return (
            <div key={d.id} className="rounded-lg border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-display text-lg font-semibold">
                    {d.product_variants?.products?.brands?.name}{" "}
                    {d.product_variants?.products?.model}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {d.product_variants?.products?.categories?.name} ·{" "}
                    {[
                      d.product_variants?.ram,
                      d.product_variants?.storage,
                      d.product_variants?.color,
                    ]
                      .filter(Boolean)
                      .join(" / ")}{" "}
                    · {d.product_variants?.sku}
                  </div>
                  <div className="num mt-2 font-mono text-sm">
                    IMEI 1: {d.imei1}
                    {d.imei2 && <> · IMEI 2: {d.imei2}</>}
                    {d.serial_no && <> · S/N: {d.serial_no}</>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge className="text-sm">{d.status.replace("_", " ")}</Badge>
                  {d.status === "IN_STOCK" && (
                    <span className="text-xs text-muted-foreground">{days} days in stock</span>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(d.imei1);
                    toast.success("IMEI copied");
                  }}
                >
                  <Copy className="mr-1 h-3.5 w-3.5" />
                  Copy IMEI
                </Button>
                {d.status === "IN_STOCK" && (
                  <Button size="sm" asChild>
                    <Link to="/app/sales/new" search={{ imei: d.imei1 }}>
                      <ShoppingCart className="mr-1 h-3.5 w-3.5" />
                      Sell this device
                    </Link>
                  </Button>
                )}
                {d.status === "IN_STOCK" && (
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/app/transfers">
                      <ArrowLeftRight className="mr-1 h-3.5 w-3.5" />
                      Transfer
                    </Link>
                  </Button>
                )}
                {d.status === "IN_STOCK" && pur && (
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/app/purchases/$id" params={{ id: pur.id }}>
                      <Undo2 className="mr-1 h-3.5 w-3.5" />
                      Return to supplier
                    </Link>
                  </Button>
                )}
                {d.status === "SOLD" && sale && (
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/app/sales/$id" params={{ id: sale.id }}>
                      <Undo2 className="mr-1 h-3.5 w-3.5" />
                      Customer return
                    </Link>
                  </Button>
                )}
                {d.status === "SOLD" && (
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/app/warranty" search={{ imei: d.imei1 }}>
                      <Wrench className="mr-1 h-3.5 w-3.5" />
                      Warranty claim
                    </Link>
                  </Button>
                )}
                {sale?.customer_id && (
                  <Button size="sm" variant="ghost" asChild>
                    <Link to="/app/ledger" search={{ kind: "customer", party: sale.customer_id }}>
                      <BookOpen className="mr-1 h-3.5 w-3.5" />
                      Customer ledger
                    </Link>
                  </Button>
                )}
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <dl className="grid grid-cols-2 gap-3 rounded-md border p-3 text-sm">
                  <div className="col-span-2 text-xs font-semibold uppercase text-muted-foreground">
                    Purchase (কোথা থেকে এসেছে)
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Supplier</dt>
                    <dd>
                      {pur?.suppliers?.name ?? "—"}
                      {pur?.suppliers?.mobile && (
                        <div className="num text-xs text-muted-foreground">
                          {pur.suppliers.mobile}
                        </div>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Invoice / date</dt>
                    <dd>
                      {pur ? (
                        <Link
                          className="text-primary hover:underline"
                          to="/app/purchases/$id"
                          params={{ id: pur.id }}
                        >
                          {pur.invoice_no}
                        </Link>
                      ) : (
                        "—"
                      )}{" "}
                      <span className="num">{pur?.purchase_date}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Purchase rate</dt>
                    <dd className="num">{d.purchase_items ? bdt(d.purchase_items.rate) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Landed cost</dt>
                    <dd className="num">{bdt(d.cost)}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">Current location</dt>
                    <dd>{d.branches?.name}</dd>
                  </div>
                </dl>
                <dl className="grid grid-cols-2 gap-3 rounded-md border p-3 text-sm">
                  <div className="col-span-2 text-xs font-semibold uppercase text-muted-foreground">
                    Sale (কার কাছে বিক্রি হয়েছে)
                  </div>
                  {sale ? (
                    <>
                      <div>
                        <dt className="text-xs text-muted-foreground">Customer</dt>
                        <dd>
                          {sale.customers?.name ?? "Walk-in"}
                          {sale.customers?.mobile && (
                            <div className="num text-xs text-muted-foreground">
                              {sale.customers.mobile}
                            </div>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Invoice / date</dt>
                        <dd>
                          <Link
                            className="text-primary hover:underline"
                            to="/app/sales/$id"
                            params={{ id: sale.id }}
                          >
                            {sale.invoice_no}
                          </Link>{" "}
                          <span className="num">{sale.sale_date}</span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Sale price</dt>
                        <dd className="num">{bdt(si!.price)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Profit</dt>
                        <dd className="num">{bdt(Number(si!.price) - Number(d.cost))}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-xs text-muted-foreground">Warranty</dt>
                        <dd>
                          {wEnd ? (
                            <>
                              {si!.warranty_months} mo · until <span className="num">{wEnd}</span>{" "}
                              <Badge variant={wActive ? "default" : "secondary"} className="ml-1">
                                {wActive ? "Active" : "Expired"}
                              </Badge>
                            </>
                          ) : (
                            "No warranty"
                          )}
                        </dd>
                      </div>
                    </>
                  ) : (
                    <div className="col-span-2 text-muted-foreground">Not sold yet.</div>
                  )}
                </dl>
              </div>
              {(sret.length > 0 || pret.length > 0 || trf.length > 0) && (
                <div className="mt-4 grid gap-4 border-t pt-3 md:grid-cols-3 text-sm">
                  {sret.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                        Customer returns
                      </div>
                      {sret.map((x) => (
                        <div key={x.id} className="num">
                          {x.sales_returns?.return_no} · {x.sales_returns?.return_date} ·{" "}
                          {bdt(x.price)}
                          {x.sales_returns?.reason && (
                            <span className="text-muted-foreground">
                              {" "}
                              · {x.sales_returns.reason}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {pret.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                        Returned to supplier
                      </div>
                      {pret.map((x) => (
                        <div key={x.id} className="num">
                          {x.purchase_returns?.return_no} · {x.purchase_returns?.return_date} ·{" "}
                          {bdt(x.unit_cost)}
                        </div>
                      ))}
                    </div>
                  )}
                  {trf.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                        Branch transfers
                      </div>
                      {trf.map((x) => (
                        <div key={x.id} className="num">
                          {x.stock_transfers?.transfer_no} · {x.stock_transfers?.transfer_date} ·{" "}
                          {x.stock_transfers?.from?.name} → {x.stock_transfers?.to?.name}{" "}
                          <Badge variant="outline">{x.stock_transfers?.status}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {claims.length > 0 && (
                <div className="mt-4 border-t pt-3">
                  <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                    Warranty claims
                  </div>
                  <ul className="space-y-1 text-sm">
                    {claims.map((c) => (
                      <li key={c.id} className="num">
                        {c.claim_no} · {c.claim_date} · {c.issue} ·{" "}
                        <Badge variant="outline">{c.status}</Badge>
                        {c.resolution && <> · {c.resolution}</>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-4 border-t pt-3">
                <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  History
                </div>
                <ol className="space-y-1 text-sm">
                  {data.moves
                    .filter((m) => m.imei_id === d.id)
                    .map((m) => (
                      <li key={m.id} className="num flex gap-3">
                        <span className="text-muted-foreground">
                          {new Date(m.created_at).toLocaleString("en-GB")}
                        </span>
                        <span className="capitalize">{m.ref_type}</span>
                        <span>
                          {m.qty_change > 0 ? "in to" : "out of"} {m.branches?.name}
                        </span>
                      </li>
                    ))}
                </ol>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
