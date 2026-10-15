import { matchedCompany } from "@/lib/branding";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { useBranches } from "@/lib/finance";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, selectCls, today } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/app/orders/new")({
  validateSearch: z.object({ edit: z.string().optional() }),
  head: ({ matches }) => ({
    meta: [
      { title: `New Order/Booking — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Create booking, layaway or order in ${matchedCompany(matches)}.`,
      },
    ],
  }),
  component: OrderForm,
});

type OLine = { key: number; variant_id: string; qty: number; price: string; discount: string };
type Variant = {
  id: string;
  sku: string;
  ram: string | null;
  storage: string | null;
  color: string | null;
  retail_price: number;
  wholesale_price: number;
  dealer_price: number;
  products: { model: string; brands: { name: string } | null } | null;
};
let seq = 1;
const n = (v: string) => (v.trim() === "" ? 0 : Number(v));
const ROLES = ["owner", "manager", "salesman", "branch_manager", "accountant"];

function OrderForm() {
  const { business, role } = useBusiness();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const branches = useBranches(business.id);
  const editId = Route.useSearch().edit;
  const canEdit = ROLES.includes(role);

  const [orderType, setOrderType] = useState("booking");
  const [branch, setBranch] = useState("");
  const [customer, setCustomer] = useState("");
  const [date, setDate] = useState(today());
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryAddr, setDeliveryAddr] = useState("");
  const [deliveryCity, setDeliveryCity] = useState("");
  const [courier, setCourier] = useState("");
  const [tracking, setTracking] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [discount, setDiscount] = useState("");
  const [tax, setTax] = useState("");
  const [deposit, setDeposit] = useState("");
  const [lines, setLines] = useState<OLine[]>([]);
  const [search, setSearch] = useState("");
  const prefilled = useRef(false);

  const br =
    branch ||
    branches.data?.find((b) => b.kind !== "warehouse")?.id ||
    branches.data?.[0]?.id ||
    "";

  const custs = useQuery({
    queryKey: ["order-cust", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id,name,business_name,mobile,price_level")
        .eq("business_id", business.id)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const variants = useQuery({
    queryKey: ["order-vars", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_variants")
        .select(
          "id,sku,ram,storage,color,retail_price,wholesale_price,dealer_price,products(model,brands(name))",
        )
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
    queryKey: ["order-edit", editId],
    queryFn: async () => {
      const [h, items] = await Promise.all([
        supabase
          .from("orders")
          .select("*")
          .eq("id", editId!)
          .eq("business_id", business.id)
          .single(),
        supabase
          .from("order_items")
          .select("variant_id,qty,price,discount")
          .eq("order_id", editId!)
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
    setOrderType(ex.h.order_type);
    setBranch(ex.h.branch_id);
    setCustomer(ex.h.customer_id ?? "");
    setDate(ex.h.order_date);
    setDeliveryDate(ex.h.delivery_date ?? "");
    setDeliveryAddr(ex.h.delivery_address ?? "");
    setDeliveryCity(ex.h.delivery_city ?? "");
    setCourier(ex.h.courier_name ?? "");
    setTracking(ex.h.tracking_no ?? "");
    setDeliveryNote(ex.h.delivery_note ?? "");
    setNotes(ex.h.notes ?? "");
    setTerms(ex.h.terms ?? "");
    setDiscount(Number(ex.h.discount) ? String(ex.h.discount) : "");
    setTax(Number(ex.h.tax) ? String(ex.h.tax) : "");
    setDeposit(Number(ex.h.deposit) ? String(ex.h.deposit) : "");
    setLines(
      ex.items.map((it: { variant_id: string; qty: number; price: number; discount: number }) => ({
        key: seq++,
        variant_id: it.variant_id,
        qty: it.qty,
        price: String(it.price),
        discount: Number(it.discount) ? String(it.discount) : "",
      })),
    );
  }, [existing.data]);

  const cust = custs.data?.find((c) => c.id === customer);
  const level = cust?.price_level ?? "retail";
  const priceFor = (v: Variant) =>
    level === "wholesale"
      ? Number(v.wholesale_price || v.retail_price)
      : level === "dealer" || level === "special"
        ? Number(v.dealer_price || v.retail_price)
        : Number(v.retail_price);

  const addVariant = (variant_id: string) => {
    const v = vmap.get(variant_id);
    if (!v) return;
    setLines((ls) =>
      ls.some((l) => l.variant_id === variant_id)
        ? ls
        : [...ls, { key: seq++, variant_id, qty: 1, price: String(priceFor(v)), discount: "" }],
    );
    setSearch("");
  };

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
  const lineGross = lines.reduce((s, l) => s + l.qty * n(l.price), 0);
  const lineDisc = lines.reduce((s, l) => s + n(l.discount), 0);
  const payable = Math.round((lineGross - lineDisc - n(discount) + n(tax)) * 100) / 100;
  const bal = Math.round((payable - n(deposit)) * 100) / 100;

  const save = useMutation({
    mutationFn: async () => {
      if (!lines.length) throw new Error("Add at least one product.");
      for (const l of lines) {
        if (l.qty <= 0) throw new Error("Quantity must be at least 1.");
        if (n(l.discount) > l.qty * n(l.price))
          throw new Error("Line discount cannot exceed line amount.");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload: any = {
        order_type: orderType,
        branch_id: br,
        customer_id: customer,
        order_date: date,
        delivery_date: deliveryDate,
        delivery_address: deliveryAddr,
        delivery_city: deliveryCity,
        courier_name: courier,
        tracking_no: tracking,
        delivery_note: deliveryNote,
        notes,
        terms,
        discount: n(discount),
        tax: n(tax),
        deposit: n(deposit),
        items: lines.map((l) => ({
          variant_id: l.variant_id,
          qty: l.qty,
          price: n(l.price),
          discount: n(l.discount),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        })) as any,
      };
      const { data, error } = editId
        ? await supabase.rpc("save_order", { _biz: business.id, _id: editId, _data: payload })
        : await supabase.rpc("save_order", { _biz: business.id, _data: payload });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success(editId ? "Order updated" : "Saved");
      qc.invalidateQueries({ queryKey: ["orders"] });
      navigate({ to: "/app/orders/$id", params: { id } });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (!canEdit)
    return (
      <div>
        <PageHeader title="New order/booking" />
        <p className="text-sm text-destructive">No permission.</p>
      </div>
    );

  return (
    <div>
      <PageHeader
        title={editId ? "Edit order/booking" : "New order / booking / layaway"}
        sub="Track deposits and delivery."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <section className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-3">
            <F label="Type">
              <select
                className={selectCls}
                value={orderType}
                onChange={(e) => setOrderType(e.target.value)}
              >
                <option value="booking">Booking</option>
                <option value="layaway">Layaway</option>
                <option value="order">Order</option>
              </select>
            </F>
            <F label="Branch">
              <select className={selectCls} value={br} onChange={(e) => setBranch(e.target.value)}>
                {branches.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </F>
            <F label="Customer (optional)">
              <select
                className={selectCls}
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
              >
                <option value="">Walk-in</option>
                {custs.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.business_name ? ` — ${c.business_name}` : ""}
                  </option>
                ))}
              </select>
            </F>
            <F label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </F>
            <F label="Delivery date">
              <Input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
              />
            </F>
            <F label="Price level">
              <Input value={level} readOnly className="capitalize" />
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
                    onClick={() => addVariant(v.id)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted"
                  >
                    <span className="min-w-0 truncate">
                      {v.products?.brands?.name} {v.products?.model}
                    </span>
                    <span className="num text-xs text-muted-foreground">{bdt(priceFor(v))}</span>
                  </button>
                ))}
              </div>
            )}
            {!lines.length ? (
              <p className="p-10 text-center text-sm text-muted-foreground">Add products.</p>
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
                            {[v?.sku].filter(Boolean).join(" / ")}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
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
                        <F label="Price">
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
                        <F label="Discount">
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
                        Line total {bdt(l.qty * n(l.price) - n(l.discount))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          <section className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <F label="Delivery city">
                <Input value={deliveryCity} onChange={(e) => setDeliveryCity(e.target.value)} />
              </F>
              <F label="Courier">
                <Input value={courier} onChange={(e) => setCourier(e.target.value)} />
              </F>
            </div>
            <F label="Delivery address">
              <Input value={deliveryAddr} onChange={(e) => setDeliveryAddr(e.target.value)} />
            </F>
            <F label="Tracking no">
              <Input value={tracking} onChange={(e) => setTracking(e.target.value)} />
            </F>
            <F label="Delivery note">
              <Textarea value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} />
            </F>
            <F label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </F>
            <F label="Terms">
              <Textarea value={terms} onChange={(e) => setTerms(e.target.value)} />
            </F>
          </section>
        </div>
        <aside className="h-fit space-y-4 rounded-lg border bg-card p-4 shadow-sm lg:sticky lg:top-24">
          <dl className="num space-y-2 text-sm">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd>{bdt(lineGross)}</dd>
            </div>
            {lineDisc > 0 && (
              <div className="flex justify-between">
                <dt>Line discount</dt>
                <dd>-{bdt(lineDisc)}</dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <dt>Extra discount</dt>
              <dd>
                <Input
                  type="number"
                  step="0.01"
                  className="h-8 w-28 text-right"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt>VAT/Tax</dt>
              <dd>
                <Input
                  type="number"
                  step="0.01"
                  className="h-8 w-28 text-right"
                  value={tax}
                  onChange={(e) => setTax(e.target.value)}
                />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2 border-t pt-2">
              <dt>Deposit</dt>
              <dd>
                <Input
                  type="number"
                  step="0.01"
                  className="h-8 w-28 text-right"
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                />
              </dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>Total</dt>
              <dd>{bdt(payable)}</dd>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <dt>Balance</dt>
              <dd>{bdt(bal)}</dd>
            </div>
          </dl>
          <Button
            className="w-full"
            disabled={save.isPending || !lines.length}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : editId ? "Save" : "Save"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => navigate({ to: "/app/orders" })}
          >
            Cancel
          </Button>
        </aside>
      </div>
    </div>
  );
}
