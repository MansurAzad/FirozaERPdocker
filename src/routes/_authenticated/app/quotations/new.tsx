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

export const Route = createFileRoute("/_authenticated/app/quotations/new")({
  validateSearch: z.object({ edit: z.string().optional() }),
  head: ({ matches }) => ({
    meta: [
      { title: `New Quotation — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Build a quotation, estimate or proforma invoice in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `New Quotation — ${matchedCompany(matches)}` },
      { property: "og:description", content: "Send a priced offer before the sale." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QuotationForm,
});

type QLine = { key: number; variant_id: string; qty: number; price: string; discount: string };
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
const EDIT_ROLES = ["owner", "manager", "salesman", "branch_manager", "accountant"];

function QuotationForm() {
  const { business, role } = useBusiness();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const branches = useBranches(business.id);
  const editId = Route.useSearch().edit;
  const canEdit = EDIT_ROLES.includes(role);

  const [docType, setDocType] = useState("quotation");
  const [branch, setBranch] = useState("");
  const [customer, setCustomer] = useState("");
  const [date, setDate] = useState(today());
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");
  const [discount, setDiscount] = useState("");
  const [tax, setTax] = useState("");
  const [lines, setLines] = useState<QLine[]>([]);
  const [search, setSearch] = useState("");
  const prefilled = useRef(false);

  const br =
    branch ||
    branches.data?.find((b) => b.kind !== "warehouse")?.id ||
    branches.data?.[0]?.id ||
    "";

  const custs = useQuery({
    queryKey: ["quote-customers", business.id, br],
    enabled: Boolean(br),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_branch_balances")
        .select("customer_id,name,business_name,mobile,price_level")
        .eq("business_id", business.id)
        .eq("branch_id", br)
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data.flatMap((customer) =>
        customer.customer_id ? [{ ...customer, id: customer.customer_id }] : [],
      );
    },
  });

  const variants = useQuery({
    queryKey: ["quote-variants", business.id],
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
    queryKey: ["quotation-edit", editId],
    queryFn: async () => {
      const [h, items] = await Promise.all([
        supabase
          .from("quotations")
          .select("*")
          .eq("id", editId!)
          .eq("business_id", business.id)
          .single(),
        supabase
          .from("quotation_items")
          .select("variant_id,qty,price,discount")
          .eq("quotation_id", editId!)
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
    setDocType(ex.h.doc_type);
    setBranch(ex.h.branch_id);
    setCustomer(ex.h.customer_id ?? "");
    setDate(ex.h.quote_date);
    setValidUntil(ex.h.valid_until ?? "");
    setNotes(ex.h.notes ?? "");
    setTerms(ex.h.terms ?? "");
    setDiscount(Number(ex.h.doc_discount) ? String(ex.h.doc_discount) : "");
    setTax(Number(ex.h.tax) ? String(ex.h.tax) : "");
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
  const lineDiscount = lines.reduce((s, l) => s + n(l.discount), 0);
  const payable = Math.round((lineGross - lineDiscount - n(discount) + n(tax)) * 100) / 100;

  const save = useMutation({
    mutationFn: async () => {
      if (!lines.length) throw new Error("Add at least one product.");
      for (const l of lines) {
        if (l.qty <= 0) throw new Error("Quantity must be at least 1.");
        if (n(l.discount) > l.qty * n(l.price))
          throw new Error("A line discount cannot exceed its line amount.");
      }
      const payload = {
        branch_id: br,
        customer_id: customer,
        doc_type: docType,
        quote_date: date,
        valid_until: validUntil,
        notes,
        terms,
        discount: n(discount),
        tax: n(tax),
        items: lines.map((l) => ({
          variant_id: l.variant_id,
          qty: l.qty,
          price: n(l.price),
          discount: n(l.discount),
        })),
      };
      const { data, error } = editId
        ? await supabase.rpc("save_quotation", { _biz: business.id, _id: editId, _data: payload })
        : await supabase.rpc("save_quotation", { _biz: business.id, _data: payload });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success(editId ? "Quotation updated" : "Document saved");
      qc.invalidateQueries({ queryKey: ["quotations"] });
      navigate({ to: "/app/quotations/$id", params: { id } });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (!canEdit)
    return (
      <div>
        <PageHeader title="New Quotation" />
        <p className="text-sm text-destructive">You do not have permission to create quotations.</p>
      </div>
    );

  return (
    <div>
      <PageHeader
        title={editId ? "Edit quotation" : "New quotation / estimate / proforma"}
        sub="A priced offer. It does not move stock or change customer due until you convert it into a sale."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <section className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-3">
            <F label="Document type">
              <select
                className={selectCls}
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
              >
                <option value="quotation">Quotation</option>
                <option value="estimate">Estimate</option>
                <option value="proforma">Proforma invoice</option>
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
                <option value="">Walk-in / no customer</option>
                {custs.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.business_name ? ` — ${c.business_name}` : ""} · {c.mobile}
                  </option>
                ))}
              </select>
            </F>
            <F label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </F>
            <F label="Valid until">
              <Input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
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
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-left text-sm hover:bg-muted"
                  >
                    <span className="min-w-0 truncate">
                      {v.products?.brands?.name} {v.products?.model}{" "}
                      <span className="text-muted-foreground">
                        {[v.ram, v.storage, v.color].filter(Boolean).join("/")}
                      </span>
                    </span>
                    <span className="num shrink-0 text-xs text-muted-foreground">
                      {bdt(priceFor(v))}
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
                Search a product to begin the offer.
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
            <F label="Notes">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Visible on the printed document."
              />
            </F>
            <F label="Terms & conditions">
              <Textarea
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder="Delivery, validity, payment terms…"
              />
            </F>
          </section>
        </div>

        <aside className="h-fit space-y-4 rounded-lg border bg-card p-4 shadow-sm lg:sticky lg:top-24">
          <dl className="num space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd>{bdt(lineGross)}</dd>
            </div>
            {lineDiscount > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Line discount</dt>
                <dd>−{bdt(lineDiscount)}</dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Extra discount</dt>
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
              <dt className="text-muted-foreground">VAT / Tax</dt>
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
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd>{bdt(payable)}</dd>
            </div>
          </dl>
          <Button
            className="w-full"
            size="lg"
            disabled={save.isPending || !lines.length}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : editId ? "Save changes" : "Save document"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => navigate({ to: "/app/quotations" })}
          >
            Cancel
          </Button>
        </aside>
      </div>
    </div>
  );
}
