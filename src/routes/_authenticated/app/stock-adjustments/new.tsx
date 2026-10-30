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
import { hasAccess } from "@/lib/access-control";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, selectCls, today } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/app/stock-adjustments/new")({
  validateSearch: z.object({ edit: z.string().optional() }),
  head: ({ matches }) => ({
    meta: [
      { title: `New Stock Adjustment — ${matchedCompany(matches)}` },
      { name: "description", content: `Count or correct stock in ${matchedCompany(matches)}.` },
      { property: "og:title", content: `New Stock Adjustment — ${matchedCompany(matches)}` },
      { property: "og:description", content: "Recount or manual stock increase / decrease." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdjustmentForm,
});

type ALine = {
  key: number;
  variant_id: string;
  current_qty: number;
  value: number;
  unit_cost: string;
};
type Variant = {
  id: string;
  sku: string;
  ram: string | null;
  storage: string | null;
  color: string | null;
  retail_price: number;
  products: { model: string; brands: { name: string } | null } | null;
};
let seq = 1;
const n = (v: string) => (v.trim() === "" ? 0 : Number(v));
const ROLES = ["owner", "manager", "accountant", "store_keeper", "branch_manager"];

function AdjustmentForm() {
  const { business, role, access } = useBusiness();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const branches = useBranches(business.id);
  const editId = Route.useSearch().edit;
  const canEdit =
    ROLES.includes(role) &&
    (hasAccess(access, "stock_adjustments", "create") ||
      hasAccess(access, "stock_adjustments", "edit"));

  const [type, setType] = useState("recount");
  const [branch, setBranch] = useState("");
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<ALine[]>([]);
  const [search, setSearch] = useState("");
  const prefilled = useRef(false);

  const br =
    branch ||
    branches.data?.find((b) => b.kind !== "warehouse")?.id ||
    branches.data?.[0]?.id ||
    "";

  const variants = useQuery({
    queryKey: ["adj-variants", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_variants")
        .select("id,sku,ram,storage,color,retail_price,products(model,brands(name))")
        .eq("business_id", business.id)
        .eq("status", "active")
        .order("sku")
        .limit(2000);
      if (error) throw error;
      return data as unknown as Variant[];
    },
  });
  const vmap = useMemo(() => new Map((variants.data ?? []).map((v) => [v.id, v])), [variants.data]);

  const stockLevels = useQuery({
    enabled: !!br,
    queryKey: ["adj-stock", business.id, br],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock")
        .select("variant_id,qty")
        .eq("business_id", business.id)
        .eq("branch_id", br);
      if (error) throw error;
      return data;
    },
  });
  const stockMap = useMemo(
    () => new Map((stockLevels.data ?? []).map((s) => [s.variant_id, s.qty])),
    [stockLevels.data],
  );

  const existing = useQuery({
    enabled: !!editId,
    queryKey: ["stock-adjustment-edit", editId],
    queryFn: async () => {
      const [h, items] = await Promise.all([
        supabase
          .from("stock_adjustments")
          .select("*")
          .eq("id", editId!)
          .eq("business_id", business.id)
          .single(),
        supabase
          .from("stock_adjustment_items")
          .select("variant_id,current_qty,new_qty,diff,unit_cost")
          .eq("adjustment_id", editId!),
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
    setType(ex.h.adj_type);
    setBranch(ex.h.branch_id);
    setDate(ex.h.adj_date);
    setReason(ex.h.reason ?? "");
    setNote(ex.h.note ?? "");
    setLines(
      ex.items.map((it) => ({
        key: seq++,
        variant_id: it.variant_id,
        current_qty: it.current_qty,
        // For recount the stored new_qty is the counted qty; for inc/dec it is the change.
        value: ex.h.adj_type === "recount" ? it.new_qty : Math.abs(it.diff),
        unit_cost: Number(it.unit_cost) ? String(it.unit_cost) : "",
      })),
    );
  }, [existing.data]);

  const addVariant = (variant_id: string) => {
    setLines((ls) =>
      ls.some((l) => l.variant_id === variant_id)
        ? ls
        : [
            ...ls,
            {
              key: seq++,
              variant_id,
              current_qty: stockMap.get(variant_id) ?? 0,
              value: type === "recount" ? (stockMap.get(variant_id) ?? 0) : 0,
              unit_cost: "",
            },
          ],
    );
    setSearch("");
  };

  const resulting = (l: ALine) =>
    type === "increase"
      ? l.current_qty + l.value
      : type === "decrease"
        ? l.current_qty - l.value
        : l.value;

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

  const totalValue = lines.reduce(
    (s, l) => s + Math.abs(resulting(l) - l.current_qty) * n(l.unit_cost),
    0,
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!lines.length) throw new Error("Add at least one product.");
      for (const l of lines) {
        if (resulting(l) < 0) throw new Error("Resulting quantity cannot be negative.");
      }
      const payload = {
        branch_id: br,
        adj_type: type,
        adj_date: date,
        reason,
        note,
        items: lines.map((l) => ({
          variant_id: l.variant_id,
          new_qty: Math.trunc(l.value),
          unit_cost: n(l.unit_cost),
        })),
      };
      const { data, error } = editId
        ? await supabase.rpc("save_stock_adjustment", {
            _biz: business.id,
            _id: editId,
            _data: payload,
          })
        : await supabase.rpc("save_stock_adjustment", { _biz: business.id, _data: payload });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success(editId ? "Adjustment updated" : "Adjustment saved");
      qc.invalidateQueries({ queryKey: ["stock-adjustments"] });
      navigate({ to: "/app/stock-adjustments/$id", params: { id } });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (!canEdit)
    return (
      <div>
        <PageHeader title="New Stock Adjustment" />
        <p className="text-sm text-destructive">You do not have permission to adjust stock.</p>
      </div>
    );

  const valueLabel =
    type === "recount" ? "Counted qty" : type === "increase" ? "Add qty" : "Remove qty";

  return (
    <div>
      <PageHeader
        title={editId ? "Edit adjustment" : "New stock adjustment"}
        sub="Nothing moves until you post the document on the next screen."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <section className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-3">
            <F label="Type">
              <select className={selectCls} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="recount">Physical count</option>
                <option value="increase">Increase</option>
                <option value="decrease">Decrease</option>
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
            <F label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </F>
            <F label="Reason" className="sm:col-span-3">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Damaged, expiry, count difference…"
              />
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
                      book {stockMap.get(v.id) ?? 0}
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
                Search a product to begin the adjustment.
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
                        <F label="Book qty">
                          <Input value={l.current_qty} readOnly />
                        </F>
                        <F label={valueLabel}>
                          <Input
                            type="number"
                            min={0}
                            value={l.value}
                            onChange={(e) =>
                              setLines((ls) =>
                                ls.map((x) =>
                                  x.key === l.key
                                    ? {
                                        ...x,
                                        value: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                                      }
                                    : x,
                                ),
                              )
                            }
                          />
                        </F>
                        <F label="Unit cost">
                          <Input
                            type="number"
                            step="0.01"
                            value={l.unit_cost}
                            onChange={(e) =>
                              setLines((ls) =>
                                ls.map((x) =>
                                  x.key === l.key ? { ...x, unit_cost: e.target.value } : x,
                                ),
                              )
                            }
                          />
                        </F>
                      </div>
                      <div className="num text-right text-sm text-muted-foreground">
                        New book qty {resulting(l)} · diff {resulting(l) - l.current_qty}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-lg border bg-card p-4 shadow-sm">
            <F label="Note">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
            </F>
          </section>
        </div>

        <aside className="h-fit space-y-4 rounded-lg border bg-card p-4 shadow-sm lg:sticky lg:top-24">
          <dl className="num space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Lines</dt>
              <dd>{lines.length}</dd>
            </div>
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>Adjustment value</dt>
              <dd>{bdt(totalValue)}</dd>
            </div>
          </dl>
          <Button
            className="w-full"
            size="lg"
            disabled={save.isPending || !lines.length}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : editId ? "Save changes" : "Save adjustment"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => navigate({ to: "/app/stock-adjustments" })}
          >
            Cancel
          </Button>
        </aside>
      </div>
    </div>
  );
}
