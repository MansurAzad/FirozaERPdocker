import { matchedCompany } from "@/lib/branding";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { useMoneyAccounts } from "@/lib/finance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScanButton } from "@/components/erp/ScanButton";

import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/app/purchases/new")({
  validateSearch: z.object({
    supplier: z.string().optional(),
    variant: z.string().optional(),
    branch: z.string().optional(),
  }),
  head: ({ matches }) => ({
    meta: [
      { title: `New Purchase — ${matchedCompany(matches)}` },
      {
        name: "description",
        content:
          "Receive products and IMEIs while updating inventory, supplier due and accounts together.",
      },
      { property: "og:title", content: `New Purchase — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: "Receive products and IMEIs with complete stock and supplier accounting.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewPurchase,
});

type Line = { key: number; variant_id: string; qty: string; rate: string; imeiText: string };
const COSTS = [
  ["transport_cost", "Transport"],
  ["loading_cost", "Loading"],
  ["courier_cost", "Courier"],
  ["insurance_cost", "Insurance"],
  ["other_cost", "Other cost"],
] as const;
const METHODS = ["cash", "bank", "bkash", "nagad", "rocket", "card", "cheque", "other"] as const;
const n = (v: string) => (v.trim() === "" ? 0 : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;

function parseImeis(text: string) {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [imei1 = "", imei2 = "", serial_no = ""] = l.split(/[,\s;]+/);
      return { imei1, imei2, serial_no };
    });
}

let keySeq = 1;
function NewPurchase() {
  const { business } = useBusiness();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [head, setHead] = useState({
    supplier_id: search.supplier ?? "",
    branch_id: search.branch ?? "",
    purchase_date: today,
    supplier_invoice_no: "",
    notes: "",
  });
  const [costs, setCosts] = useState<Record<string, string>>({
    discount: "",
    tax: "",
    transport_cost: "",
    loading_cost: "",
    courier_cost: "",
    insurance_cost: "",
    other_cost: "",
  });
  const moneyAccts = useMoneyAccounts(business.id);
  const [pay, setPay] = useState({
    account_id: "",
    paid: "",
    payment_method: "cash" as (typeof METHODS)[number],
    txn_ref: "",
  });
  const [lines, setLines] = useState<Line[]>([
    { key: 0, variant_id: "", qty: "1", rate: "", imeiText: "" },
  ]);

  const lk = useQuery({
    queryKey: ["purchase-lookups", business.id],
    queryFn: async () => {
      const [s, b, v, a] = await Promise.all([
        supabase
          .from("suppliers")
          .select("id,name,company,status")
          .eq("business_id", business.id)
          .eq("status", "active")
          .order("name"),
        supabase
          .from("branches")
          .select("id,name,kind")
          .eq("business_id", business.id)
          .eq("status", "active")
          .order("name"),
        supabase
          .from("product_variants")
          .select(
            "id,sku,ram,storage,color,purchase_price,products!inner(model,brands(name),categories(is_serialized))",
          )
          .eq("business_id", business.id)
          .eq("status", "active"),
        supabase
          .from("supplier_branch_assignments")
          .select("branch_id,supplier_id,is_default")
          .eq("business_id", business.id),
      ]);
      for (const x of [s, b, v, a]) if (x.error) throw x.error;
      return {
        suppliers: s.data!,
        branches: b.data!,
        variants: v.data!,
        supplierAssignments: a.data!,
      };
    },
  });
  const vmap = useMemo(() => new Map((lk.data?.variants ?? []).map((v) => [v.id, v])), [lk.data]);
  const selectedBranch = useMemo(
    () => lk.data?.branches.find((branch) => branch.id === head.branch_id),
    [head.branch_id, lk.data],
  );
  const branchSupplierAssignments = useMemo(
    () =>
      (lk.data?.supplierAssignments ?? []).filter(
        (assignment) => assignment.branch_id === head.branch_id,
      ),
    [head.branch_id, lk.data],
  );
  const allowedSuppliers = useMemo(
    () =>
      selectedBranch?.kind === "branch"
        ? (lk.data?.suppliers.filter((supplier) =>
            branchSupplierAssignments.some(
              (assignment) =>
                assignment.supplier_id === supplier.id && supplier.status === "active",
            ),
          ) ?? [])
        : (lk.data?.suppliers ?? []),
    [branchSupplierAssignments, lk.data, selectedBranch],
  );
  useEffect(() => {
    if (!head.branch_id || !selectedBranch) return;
    if (head.supplier_id && allowedSuppliers.some((supplier) => supplier.id === head.supplier_id))
      return;
    const defaultSupplier =
      branchSupplierAssignments.find((assignment) => assignment.is_default)?.supplier_id ?? "";
    setHead((current) => ({ ...current, supplier_id: defaultSupplier }));
  }, [
    head.branch_id,
    head.supplier_id,
    selectedBranch,
    allowedSuppliers,
    branchSupplierAssignments,
  ]);
  useEffect(() => {
    if (!search.variant) return;
    const variant = vmap.get(search.variant);
    if (!variant) return;
    setLines((current) =>
      current[0]?.variant_id
        ? current
        : [
            {
              key: 0,
              variant_id: variant.id,
              qty: "1",
              rate: String(variant.purchase_price),
              imeiText: "",
            },
          ],
    );
  }, [search.variant, vmap]);

  const calc = useMemo(() => {
    const sub = r2(lines.reduce((s, l) => s + n(l.qty) * n(l.rate), 0));
    const extra =
      n(costs["tax"] ?? "") -
      n(costs["discount"] ?? "") +
      COSTS.reduce((s, [k]) => s + n(costs[k] ?? ""), 0);
    const total = r2(sub + extra);
    return {
      sub,
      extra: r2(extra),
      total,
      factor: sub > 0 ? extra / sub : 0,
      due: r2(total - n(pay.paid)),
    };
  }, [lines, costs, pay.paid]);

  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = useMutation({
    networkMode: "always",
    mutationFn: async () => {
      if (!head.supplier_id) throw new Error("Select a supplier.");
      if (!head.branch_id) throw new Error("Select a branch.");
      const seen = new Set<string>();
      const items = lines.map((l, i) => {
        const v = vmap.get(l.variant_id);
        if (!v) throw new Error(`Row ${i + 1}: select a product.`);
        const qty = n(l.qty);
        if (!Number.isInteger(qty) || qty <= 0)
          throw new Error(`Row ${i + 1}: quantity must be a whole number ≥ 1.`);
        if (Number.isNaN(n(l.rate)) || n(l.rate) < 0)
          throw new Error(`Row ${i + 1}: invalid rate.`);
        const serial = v.products.categories?.is_serialized;
        const imeis = serial ? parseImeis(l.imeiText) : [];
        if (serial) {
          if (imeis.length !== qty)
            throw new Error(`Row ${i + 1}: enter ${qty} IMEI(s), found ${imeis.length}.`);
          for (const im of imeis) {
            for (const code of [im.imei1, im.imei2].filter(Boolean)) {
              if (!/^\d{15}$/.test(code))
                throw new Error(`Invalid IMEI (must be 15 digits): ${code}`);
              if (seen.has(code)) throw new Error(`IMEI entered twice: ${code}`);
              seen.add(code);
            }
          }
        }
        return { variant_id: l.variant_id, qty, rate: n(l.rate), imeis };
      });
      if (calc.total < 0) throw new Error("Discount is larger than the purchase amount.");
      if (n(pay.paid) < 0 || n(pay.paid) > calc.total) throw new Error("Invalid payment amount.");
      const payload = {
        ...head,
        ...Object.fromEntries(Object.entries(costs).map(([k, v]) => [k, n(v)])),
        paid: n(pay.paid),
        account_id: n(pay.paid) > 0 ? pay.account_id || moneyAccts.data?.[0]?.id || "" : "",
        payment_method: pay.payment_method,
        txn_ref: pay.txn_ref,
        items,
      };
      const { data, error } = await supabase.rpc("create_purchase", {
        _biz: business.id,
        _data: payload,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success("Purchase posted — stock updated");
      qc.invalidateQueries();
      navigate({ to: "/app/purchases/$id", params: { id } });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const sel = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
  const vLabel = (v: NonNullable<ReturnType<typeof vmap.get>>) =>
    `${v.products.brands?.name ?? ""} ${v.products.model} ${[v.ram, v.storage, v.color].filter(Boolean).join("/")} · ${v.sku}`;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <PageHeader
        title="New Purchase"
        sub="Posting updates stock, IMEIs and supplier due in one step."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="grid gap-4 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Supplier *</Label>
              <select
                className={sel}
                value={head.supplier_id}
                onChange={(e) => setHead({ ...head, supplier_id: e.target.value })}
              >
                <option value="">Select…</option>
                {allowedSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.company ? ` — ${s.company}` : ""}
                  </option>
                ))}
              </select>
              {selectedBranch?.kind === "branch" && allowedSuppliers.length === 0 && (
                <p className="text-xs text-destructive">
                  No active supplier is assigned to this shop. Ask an administrator to configure
                  FIROZA ENTERPRISE or assign another supplier.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Receive at *</Label>
              <select
                className={sel}
                value={head.branch_id}
                onChange={(e) => setHead({ ...head, branch_id: e.target.value })}
              >
                <option value="">Select…</option>
                {lk.data?.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={head.purchase_date}
                onChange={(e) => setHead({ ...head, purchase_date: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Supplier invoice #</Label>
              <Input
                value={head.supplier_invoice_no}
                onChange={(e) => setHead({ ...head, supplier_invoice_no: e.target.value })}
              />
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b p-3">
              <h2 className="text-sm font-semibold">Items</h2>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setLines([
                    ...lines,
                    { key: keySeq++, variant_id: "", qty: "1", rate: "", imeiText: "" },
                  ])
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                Add row
              </Button>
            </div>
            <div className="divide-y">
              {lines.map((l, i) => {
                const v = vmap.get(l.variant_id);
                const serial = v?.products.categories?.is_serialized;
                const count = serial ? parseImeis(l.imeiText).length : 0;
                const landed = r2(n(l.rate) * (1 + calc.factor));
                return (
                  <div
                    key={l.key}
                    className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_5rem_7rem_auto]"
                  >
                    <div className="space-y-1.5">
                      <Label className="text-xs">Product #{i + 1}</Label>
                      <select
                        className={sel}
                        value={l.variant_id}
                        onChange={(e) => {
                          const nv = vmap.get(e.target.value);
                          setLine(l.key, {
                            variant_id: e.target.value,
                            rate: nv ? String(nv.purchase_price) : l.rate,
                          });
                        }}
                      >
                        <option value="">Select product…</option>
                        {lk.data?.variants.map((x) => (
                          <option key={x.id} value={x.id}>
                            {vLabel(x)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Qty</Label>
                      <Input
                        type="number"
                        min={1}
                        value={l.qty}
                        onChange={(e) => setLine(l.key, { qty: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Rate (৳)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={l.rate}
                        onChange={(e) => setLine(l.key, { rate: e.target.value })}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Remove row"
                        disabled={lines.length === 1}
                        onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    {serial && (
                      <div className="space-y-2 rounded-md border border-primary/20 bg-accent p-3 sm:col-span-4">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 text-xs">
                          <div>
                            <Label className="text-xs font-semibold">IMEI details *</Label>
                            <p className="mt-1 text-muted-foreground">
                              One unit per line: IMEI 1, IMEI 2 (optional), Serial (optional)
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <ScanButton
                              size="sm"
                              label="Scan"
                              onCodes={(c) => {
                                const text = [l.imeiText.trim(), ...c].filter(Boolean).join("\n");
                                setLine(l.key, {
                                  imeiText: text,
                                  qty: String(Math.max(n(l.qty), parseImeis(text).length)),
                                });
                              }}
                            />
                            <Badge
                              variant={count === n(l.qty) ? "default" : "destructive"}
                              className="num"
                            >
                              {count}/{n(l.qty) || 0}
                            </Badge>
                          </div>
                        </div>
                        <Textarea
                          rows={Math.min(8, Math.max(2, n(l.qty)))}
                          className="font-mono text-xs"
                          value={l.imeiText}
                          placeholder={"356789012345671, 356789012345689\n356789012345697"}
                          onChange={(e) => setLine(l.key, { imeiText: e.target.value })}
                        />
                      </div>
                    )}
                    {v && (
                      <div className="num text-xs text-muted-foreground sm:col-span-4">
                        Line {bdt(r2(n(l.qty) * n(l.rate)))} · Landed cost per unit{" "}
                        <span className="font-semibold text-foreground">{bdt(landed)}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="grid gap-4 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-4">
            <h2 className="text-sm font-semibold sm:col-span-3 lg:col-span-4">
              Landed cost & adjustments
            </h2>
            {COSTS.map(([k, label]) => (
              <div key={k} className="space-y-1.5">
                <Label className="text-xs">{label} (৳)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={costs[k]}
                  onChange={(e) => setCosts({ ...costs, [k]: e.target.value })}
                />
              </div>
            ))}
            <div className="space-y-1.5">
              <Label className="text-xs">VAT / Tax (৳)</Label>
              <Input
                type="number"
                step="0.01"
                value={costs["tax"]}
                onChange={(e) => setCosts({ ...costs, tax: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Discount (৳)</Label>
              <Input
                type="number"
                step="0.01"
                value={costs["discount"]}
                onChange={(e) => setCosts({ ...costs, discount: e.target.value })}
              />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-3 lg:col-span-4">
              Extra costs, tax and discount are spread across items in proportion to their value.
            </p>
          </section>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              value={head.notes}
              onChange={(e) => setHead({ ...head, notes: e.target.value })}
            />
          </div>
        </div>

        <aside className="h-fit space-y-4 rounded-lg border bg-card p-4 shadow-sm lg:sticky lg:top-24">
          <h2 className="text-sm font-semibold">Summary</h2>
          <dl className="num space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Product purchase</dt>
              <dd>{bdt(calc.sub)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Costs + tax − discount</dt>
              <dd>{bdt(calc.extra)}</dd>
            </div>
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>Actual cost</dt>
              <dd>{bdt(calc.total)}</dd>
            </div>
          </dl>
          <div className="space-y-3 border-t pt-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Paid now (৳)</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="0.01"
                  value={pay.paid}
                  onChange={(e) => setPay({ ...pay, paid: e.target.value })}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => setPay({ ...pay, paid: String(calc.total) })}
                >
                  Full
                </Button>
              </div>
            </div>
            {n(pay.paid) > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Pay from</Label>
                <select
                  className={sel}
                  value={pay.account_id || moneyAccts.data?.[0]?.id || ""}
                  onChange={(e) => setPay({ ...pay, account_id: e.target.value })}
                >
                  {moneyAccts.data
                    ?.filter((a) => a.status === "active")
                    .map((a) => (
                      <option key={a.id!} value={a.id!}>
                        {a.name} ({bdt(a.balance)})
                      </option>
                    ))}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Method</Label>
              <select
                className={sel}
                value={pay.payment_method}
                onChange={(e) =>
                  setPay({ ...pay, payment_method: e.target.value as typeof pay.payment_method })
                }
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m === "bkash" ? "bKash" : m[0]!.toUpperCase() + m.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            {pay.payment_method !== "cash" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Transaction ID / Reference</Label>
                <Input
                  value={pay.txn_ref}
                  onChange={(e) => setPay({ ...pay, txn_ref: e.target.value })}
                />
              </div>
            )}
            <div className="num flex justify-between text-sm font-semibold">
              <span>{calc.due > 0 ? "Supplier due" : "Fully paid"}</span>
              <span className={calc.due > 0 ? "text-destructive" : "text-success"}>
                {bdt(calc.due)}
              </span>
            </div>
          </div>
          <Button className="w-full" size="lg" disabled={save.isPending}>
            {save.isPending ? "Posting…" : "Post purchase"}
          </Button>
        </aside>
      </div>
    </form>
  );
}
