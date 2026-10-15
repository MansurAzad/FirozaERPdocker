import { matchedCompany } from "@/lib/branding";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, today } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/app/purchase-returns/new")({
  validateSearch: z.object({ edit: z.string().optional() }),
  head: ({ matches }) => ({
    meta: [
      { title: `New Purchase Return — ${matchedCompany(matches)}` },
      { name: "description", content: `Return purchased goods in ${matchedCompany(matches)}.` },
      { property: "og:title", content: `New Purchase Return — ${matchedCompany(matches)}` },
      { property: "og:description", content: "Send goods back to a supplier and reduce due." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrForm,
});

type Item = {
  id: string;
  variant_id: string;
  qty: number;
  rate: number;
  product_variants: {
    sku: string;
    ram: string | null;
    storage: string | null;
    color: string | null;
    products: { model: string; brands: { name: string } | null } | null;
  } | null;
};
const n = (v: string | number) => (v === "" ? 0 : Number(v));
const ROLES = ["owner", "manager", "accountant", "store_keeper"];

function PrForm() {
  const { business, role } = useBusiness();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const editId = Route.useSearch().edit;
  const canEdit = ROLES.includes(role as string);

  const [purchase, setPurchase] = useState("");
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState("");
  const [refund, setRefund] = useState("");
  const [pick, setPick] = useState("");
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
  const prefilled = useRef(false);

  const purchases = useQuery({
    queryKey: ["pr-purchases", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchases")
        .select("id,invoice_no,purchase_date,total,due,suppliers(name),branches(name)")
        .eq("business_id", business.id)
        .order("purchase_date", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data;
    },
  });

  const pool = useMemo(() => {
    const q = pick.toLowerCase().trim();
    const all = purchases.data ?? [];
    return (
      q
        ? all.filter((p) =>
            [p.invoice_no, p.suppliers?.name].some((x) => (x ?? "").toLowerCase().includes(q)),
          )
        : all
    ).slice(0, 40);
  }, [purchases.data, pick]);

  const items = useQuery({
    enabled: !!purchase,
    queryKey: ["pr-items", purchase],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_items")
        .select(
          "id,variant_id,qty,rate,product_variants(sku,ram,storage,color,products(model,brands(name)))",
        )
        .eq("purchase_id", purchase)
        .eq("business_id", business.id);
      if (error) throw error;
      return data as unknown as Item[];
    },
  });

  const existing = useQuery({
    enabled: !!editId,
    queryKey: ["purchase-return-edit", editId],
    queryFn: async () => {
      const [h, its] = await Promise.all([
        supabase
          .from("purchase_returns")
          .select("*")
          .eq("id", editId!)
          .eq("business_id", business.id)
          .single(),
        supabase
          .from("purchase_return_items")
          .select("purchase_item_id,qty,unit_cost")
          .eq("return_id", editId!),
      ]);
      if (h.error) throw h.error;
      if (its.error) throw its.error;
      return { h: h.data, items: its.data };
    },
  });

  useEffect(() => {
    const ex = existing.data;
    if (!ex || prefilled.current) return;
    prefilled.current = true;
    setPurchase(ex.h.purchase_id);
    setDate(ex.h.return_date);
    setReason(ex.h.reason ?? "");
    setRefund(Number(ex.h.refund) ? String(ex.h.refund) : "");
    setQtyMap(Object.fromEntries(ex.items.map((it) => [it.purchase_item_id, it.qty])));
  }, [existing.data]);

  const returnTotal = (items.data ?? []).reduce(
    (s, it) => s + (qtyMap[it.id] ?? 0) * Number(it.rate ?? 0),
    0,
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!purchase) throw new Error("Choose a purchase.");
      const lines = (items.data ?? [])
        .map((it) => ({
          purchase_item_id: it.id,
          variant_id: it.variant_id,
          qty: Math.trunc(qtyMap[it.id] ?? 0),
          unit_cost: Number(it.rate ?? 0),
        }))
        .filter((l) => l.qty > 0);
      if (!lines.length) throw new Error("Enter a return quantity for at least one line.");
      const payload = {
        purchase_id: purchase,
        return_date: date,
        reason,
        refund: n(refund),
        items: lines,
      };
      const { data, error } = editId
        ? await supabase.rpc("save_purchase_return", {
            _biz: business.id,
            _id: editId,
            _data: payload,
          })
        : await supabase.rpc("save_purchase_return", { _biz: business.id, _data: payload });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success(editId ? "Return updated" : "Return saved");
      qc.invalidateQueries({ queryKey: ["purchase-returns"] });
      navigate({ to: "/app/purchase-returns/$id", params: { id } });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (!canEdit)
    return (
      <div>
        <PageHeader title="New Purchase Return" />
        <p className="text-sm text-destructive">You do not have permission to create returns.</p>
      </div>
    );

  return (
    <div>
      <PageHeader
        title={editId ? "Edit purchase return" : "New purchase return"}
        sub="Choose the original purchase, then set how many units go back per line."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <section className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
            <F label="Purchase invoice">
              <Input
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                placeholder="Search invoice no or supplier…"
              />
            </F>
            {!purchase ? (
              <div className="max-h-56 divide-y overflow-y-auto rounded-md border">
                {pool.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPurchase(p.id);
                      setQtyMap({});
                      setPick(p.invoice_no);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{p.invoice_no}</span>{" "}
                      <span className="text-muted-foreground">{p.suppliers?.name}</span>
                    </span>
                    <span className="num shrink-0 text-xs text-muted-foreground">
                      {p.purchase_date} · {bdt(p.total)}
                    </span>
                  </button>
                ))}
                {!pool.length && (
                  <p className="p-3 text-sm text-muted-foreground">No matching purchase.</p>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span>
                  Selected: <span className="font-medium">{pick}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPurchase("");
                    setQtyMap({});
                  }}
                >
                  Change
                </Button>
              </div>
            )}
          </section>

          {purchase && (
            <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
              {items.error ? (
                <p className="p-4 text-sm text-destructive">{friendlyError(items.error)}</p>
              ) : !items.data?.length ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  This purchase has no lines.
                </p>
              ) : (
                <div className="divide-y">
                  {items.data.map((it) => {
                    const qty = qtyMap[it.id] ?? 0;
                    return (
                      <div key={it.id} className="flex items-center gap-3 p-3">
                        <div className="min-w-0 flex-1">
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
                            · {it.product_variants?.sku} · bought {it.qty}
                          </div>
                        </div>
                        <div className="w-24">
                          <Input
                            type="number"
                            min={0}
                            max={it.qty}
                            value={qty}
                            onChange={(e) =>
                              setQtyMap((m) => ({
                                ...m,
                                [it.id]: Math.min(
                                  it.qty,
                                  Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                                ),
                              }))
                            }
                          />
                        </div>
                        <div className="num w-24 text-right text-sm text-muted-foreground">
                          {bdt(qty * Number(it.rate ?? 0))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          <section className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-3">
            <F label="Return date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </F>
            <F label="Refund received">
              <Input
                type="number"
                step="0.01"
                value={refund}
                onChange={(e) => setRefund(e.target.value)}
              />
            </F>
            <F label="Reason" className="sm:col-span-3">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
            </F>
          </section>
        </div>

        <aside className="h-fit space-y-3 rounded-lg border bg-card p-4 shadow-sm lg:sticky lg:top-24">
          <div className="num flex justify-between border-b pb-3 text-base font-semibold">
            <span>Return value</span>
            <span>{bdt(returnTotal)}</span>
          </div>
          <Button
            className="w-full"
            size="lg"
            disabled={save.isPending || !purchase}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : editId ? "Save changes" : "Save return"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => navigate({ to: "/app/purchase-returns" })}
          >
            Cancel
          </Button>
          <p className="text-xs text-muted-foreground">
            Stock decreases when you post the return on the next screen.
          </p>
        </aside>
      </div>
    </div>
  );
}
