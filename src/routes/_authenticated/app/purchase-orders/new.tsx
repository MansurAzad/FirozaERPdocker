import { matchedCompany } from "@/lib/branding";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { useBranches } from "@/lib/finance";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, selectCls, today } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/app/purchase-orders/new")({
  validateSearch: z.object({ edit: z.string().optional() }),
  head: ({ matches }) => ({
    meta: [
      { title: `New Purchase Order — ${matchedCompany(matches)}` },
      { name: "description", content: `Create a purchase order in ${matchedCompany(matches)}.` },
      { property: "og:title", content: `New Purchase Order — ${matchedCompany(matches)}` },
      { property: "og:description", content: "Order stock from a supplier." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PoForm,
});

type Line = {
  key: number;
  variant_id: string;
  qty: number;
  price: string;
  discount: string;
};
type Variant = {
  id: string;
  sku: string;
  ram: string | null;
  storage: string | null;
  color: string | null;
  purchase_price: number;
  products: { model: string; brands: { name: string } | null } | null;
};
let seq = 1;
const n = (v: string | number) => (v === "" ? 0 : Number(v));
const ROLES = ["owner", "manager", "accountant", "purchase_officer", "store_keeper"];

function PoForm() {
  const { business, role } = useBusiness();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const branches = useBranches(business.id);
  const editId = Route.useSearch().edit;
  const canEdit = ROLES.includes(role as string);

  const [branch, setBranch] = useState("");
  const [supplier, setSupplier] = useState("");
  const [date, setDate] = useState(today());
  const [expected, setExpected] = useState("");
  const [discount, setDiscount] = useState("");
  const [tax, setTax] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const prefilled = useRef(false);

  const br =
    branch ||
    branches.data?.find((b) => b.kind !== "warehouse")?.id ||
    branches.data?.[0]?.id ||
    "";

  const suppliers = useQuery({
    queryKey: ["po-suppliers", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id,name")
        .eq("business_id", business.id)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const variants = useQuery({
    queryKey: ["po-variants", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_variants")
        .select("id,sku,ram,storage,color,purchase_price,products(model,brands(name))")
        .eq("business_id", business.id)
        .eq("status", "active")
        .order("sku")
        .limit(2000);
      if (error) throw error;
      return data as unknown as Variant[];
    },
  });
  const vmap = useMemo(() => new Map((variants.data ?? []).map((v) => [v.id, v])), [variants.data]);

  const existing = useQuery({
    enabled: !!editId,
    queryKey: ["purchase-order-edit", editId],
    queryFn: async () => {
      const [h, items] = await Promise.all([
        supabase
          .from("purchase_orders")
          .select("*")
          .eq("id", editId!)
          .eq("business_id", business.id)
          .single(),
        supabase
          .from("purchase_order_items")
          .select("variant_id,qty,price,discount")
          .eq("po_id", editId!)
          .order("sort_order"),
      ]);
      if (h.error) throw h.error;
      if (items.error) throw items.error;
      return { h: h.data, items: items.data };
    },
  });

  useEffect(() => {
    const ex = existing.data;
    if (!ex || prefilled.current) return;
    prefilled.current = true;
    setBranch(ex.h.branch_id);
    setSupplier(ex.h.supplier_id);
    setDate(ex.h.po_date);
    setExpected(ex.h.expected_date ?? "");
    setDiscount(Number(ex.h.discount) ? String(ex.h.discount) : "");
    setTax(Number(ex.h.tax) ? String(ex.h.tax) : "");
    setNotes(ex.h.notes ?? "");
    setTerms(ex.h.terms ?? "");
    setLines(
      ex.items.map((it) => ({
        key: seq++,
        variant_id: it.variant_id,
        qty: it.qty,
        price: String(it.price),
        discount: Number(it.discount) ? String(it.discount) : "",
      })),
    );
  }, [existing.data]);

  const addVariant = (v: Variant) => {
    setLines((ls) =>
      ls.some((l) => l.variant_id === v.id)
        ? ls
        : [
            ...ls,
            {
              key: seq++,
              variant_id: v.id,
              qty: 1,
              price: String(v.purchase_price ?? 0),
              discount: "",
            },
          ],
    );
    setSearch("");
  };

  const lineTotal = (l: Line) => n(l.qty) * n(l.price) - n(l.discount);
  const subtotal = lines.reduce((s, l) => s + n(l.qty) * n(l.price), 0);
  const lineDiscount = lines.reduce((s, l) => s + n(l.discount), 0);
  const total = subtotal - lineDiscount - n(discount) + n(tax);

  const q = search.toLowerCase().trim();
  const results = q
    ? (variants.data ?? [])
        .filter((v) =>
          [v.sku, v.products?.model, v.products?.brands?.name].some((x) =>
            (x ?? "").toLowerCase().includes(q),
          ),
        )
        .slice(0, 30)
    : [];

  const save = useMutation({
    mutationFn: async () => {
      if (!supplier) throw new Error("Choose a supplier.");
      if (!lines.length) throw new Error("Add at least one product.");
      for (const l of lines) {
        if (n(l.qty) <= 0) throw new Error("Quantity must be at least 1.");
        if (n(l.price) < 0) throw new Error("Price cannot be negative.");
        if (n(l.discount) > n(l.qty) * n(l.price))
          throw new Error("Line discount cannot exceed the line amount.");
      }
      const payload = {
        branch_id: br,
        supplier_id: supplier,
        po_date: date,
        expected_date: expected || null,
        discount: n(discount),
        tax: n(tax),
        notes,
        terms,
        items: lines.map((l) => ({
          variant_id: l.variant_id,
          qty: Math.trunc(n(l.qty)),
          price: n(l.price),
          discount: n(l.discount),
        })),
      };
      const { data, error } = editId
        ? await supabase.rpc("save_purchase_order", {
            _biz: business.id,
            _id: editId,
            _data: payload,
          })
        : await supabase.rpc("save_purchase_order", { _biz: business.id, _data: payload });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success(editId ? "Purchase order updated" : "Purchase order saved");
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      navigate({ to: "/app/purchase-orders/$id", params: { id } });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (!canEdit)
    return (
      <div>
        <PageHeader title="New Purchase Order" />
        <p className="text-sm text-destructive">
          You do not have permission to create purchase orders.
        </p>
      </div>
    );

  return (
    <div>
      <PageHeader
        title={editId ? "Edit purchase order" : "New purchase order"}
        sub="Receiving this order updates stock. The supplier invoice is still posted through Purchases."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <section className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-3">
            <F label="Supplier">
              <select
                className={selectCls}
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
              >
                <option value="">Select supplier…</option>
                {suppliers.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </F>
            <F label="Deliver to branch">
              <select className={selectCls} value={br} onChange={(e) => setBranch(e.target.value)}>
                {branches.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </F>
            <F label="Order date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </F>
            <F label="Expected date">
              <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
            </F>
          </section>

          <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="border-b p-3">
              <Input
                placeholder="Search product to add…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {q && (
              <div className="max-h-56 divide-y overflow-y-auto border-b">
                {results.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => addVariant(v)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left text-sm hover:bg-muted"
                  >
                    <span className="min-w-0 truncate">
                      {v.products?.brands?.name} {v.products?.model}{" "}
                      <span className="text-muted-foreground">
                        {[v.ram, v.storage, v.color].filter(Boolean).join("/")}
                      </span>
                    </span>
                    <span className="num shrink-0 text-xs text-muted-foreground">
                      cost {bdt(v.purchase_price)}
                    </span>
                  </button>
                ))}
                {!results.length && (
                  <p className="p-3 text-sm text-muted-foreground">No matching product.</p>
                )}
              </div>
            )}
            {!lines.length ? (
              <p className="p-10 text-center text-sm text-muted-foreground">
                Search a product to start the purchase order.
              </p>
            ) : (
              <div className="divide-y">
                {lines.map((l) => {
                  const v = vmap.get(l.variant_id);
                  return (
                    <div key={l.key} className="space-y-2 p-3">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">
                            {v?.products?.brands?.name} {v?.products?.model}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {[v?.ram, v?.storage, v?.color].filter(Boolean).join(" / ")} ·{" "}
                            {v?.sku ?? "—"}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remove line"
                          onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <F label="Qty">
                          <Input
                            type="number"
                            min={1}
                            value={l.qty}
                            onChange={(e) =>
                              setLines((ls) =>
                                ls.map((x) =>
                                  x.key === l.key
                                    ? {
                                        ...x,
                                        qty: Math.max(1, Math.trunc(Number(e.target.value) || 1)),
                                      }
                                    : x,
                                ),
                              )
                            }
                          />
                        </F>
                        <F label="Unit price">
                          <Input
                            type="number"
                            step="0.01"
                            value={l.price}
                            onChange={(e) =>
                              setLines((ls) =>
                                ls.map((x) =>
                                  x.key === l.key ? { ...x, price: e.target.value } : x,
                                ),
                              )
                            }
                          />
                        </F>
                        <F label="Line discount">
                          <Input
                            type="number"
                            step="0.01"
                            value={l.discount}
                            onChange={(e) =>
                              setLines((ls) =>
                                ls.map((x) =>
                                  x.key === l.key ? { ...x, discount: e.target.value } : x,
                                ),
                              )
                            }
                          />
                        </F>
                      </div>
                      <div className="num text-right text-sm text-muted-foreground">
                        Line {bdt(lineTotal(l))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-2">
            <F label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </F>
            <F label="Terms">
              <Textarea value={terms} onChange={(e) => setTerms(e.target.value)} />
            </F>
          </section>
        </div>

        <aside className="h-fit space-y-3 rounded-lg border bg-card p-4 shadow-sm lg:sticky lg:top-24">
          <div className="grid grid-cols-2 gap-2">
            <F label="Header discount">
              <Input
                type="number"
                step="0.01"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </F>
            <F label="Tax">
              <Input
                type="number"
                step="0.01"
                value={tax}
                onChange={(e) => setTax(e.target.value)}
              />
            </F>
          </div>
          <dl className="num space-y-2 border-t pt-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd>{bdt(subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Line discount</dt>
              <dd>{bdt(lineDiscount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Header discount</dt>
              <dd>{bdt(n(discount))}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Tax</dt>
              <dd>{bdt(n(tax))}</dd>
            </div>
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd>{bdt(total)}</dd>
            </div>
          </dl>
          <Button
            className="w-full"
            size="lg"
            disabled={save.isPending || !lines.length || !supplier}
            onClick={() => save.mutate()}
          >
            <Plus className="mr-1 h-4 w-4" />
            {save.isPending ? "Saving…" : editId ? "Save changes" : "Save purchase order"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => navigate({ to: "/app/purchase-orders" })}
          >
            Cancel
          </Button>
        </aside>
      </div>
    </div>
  );
}
