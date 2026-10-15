import { matchedCompany } from "@/lib/branding";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { useBranches } from "@/lib/finance";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, selectCls, today } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/app/reorder")({
  head: ({ matches }) => ({
    meta: [
      { title: `Reorder Suggestions — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Turn low-stock products into a draft purchase order in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Reorder Suggestions — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: "See what needs restocking and create a purchase order in one step.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Reorder,
});

const ROLES = ["owner", "manager", "accountant", "purchase_officer", "store_keeper"];

type Variant = {
  id: string;
  sku: string;
  ram: string | null;
  storage: string | null;
  color: string | null;
  purchase_price: number;
  reorder_level: number;
  products: { model: string; brands: { name: string } | null } | null;
};
type Row = {
  variant_id: string;
  sku: string;
  name: string;
  variant: string;
  available: number;
  reorder_level: number;
  suggested: number;
  cost: number;
};
type Pick = { on: boolean; qty: number; cost: number };

function Reorder() {
  const { business, role } = useBusiness();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const branches = useBranches(business.id);
  const canEdit = ROLES.includes(role as string);

  const [branch, setBranch] = useState("");
  const [supplier, setSupplier] = useState("");
  const [onlyLow, setOnlyLow] = useState(true);
  const [sel, setSel] = useState<Record<string, Pick>>({});

  const br =
    branch ||
    branches.data?.find((b) => b.kind !== "warehouse")?.id ||
    branches.data?.at(0)?.id ||
    "";

  const suppliers = useQuery({
    queryKey: ["reorder-suppliers", business.id],
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
    queryKey: ["reorder-variants", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_variants")
        .select(
          "id,sku,ram,storage,color,purchase_price,reorder_level,products(model,brands(name))",
        )
        .eq("business_id", business.id)
        .eq("status", "active")
        .order("sku")
        .limit(2000);
      if (error) throw error;
      return data as unknown as Variant[];
    },
  });

  const stock = useQuery({
    enabled: !!br,
    queryKey: ["reorder-stock", business.id, br],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock")
        .select("variant_id,qty,avg_cost")
        .eq("business_id", business.id)
        .eq("branch_id", br);
      if (error) throw error;
      return data;
    },
  });

  const rows = useMemo<Row[]>(() => {
    const qty = new Map((stock.data ?? []).map((s) => [s.variant_id, Number(s.qty)]));
    const cost = new Map((stock.data ?? []).map((s) => [s.variant_id, Number(s.avg_cost)]));
    const out: Row[] = [];
    for (const v of variants.data ?? []) {
      const available = qty.get(v.id) ?? 0;
      const level = v.reorder_level ?? 0;
      const suggested = Math.max(level - available, 1);
      const unit = cost.get(v.id) ?? 0;
      out.push({
        variant_id: v.id,
        sku: v.sku,
        name: `${v.products?.brands?.name ?? ""} ${v.products?.model ?? ""}`.trim(),
        variant: [v.ram, v.storage, v.color].filter(Boolean).join(" / "),
        available,
        reorder_level: level,
        suggested,
        cost: unit > 0 ? unit : Number(v.purchase_price ?? 0),
      });
    }
    // Low stock first, then the largest shortfall.
    return out
      .filter((r) => (onlyLow ? r.reorder_level > 0 && r.available <= r.reorder_level : true))
      .sort((a, b) => {
        const aLow = a.reorder_level > 0 && a.available <= a.reorder_level ? 0 : 1;
        const bLow = b.reorder_level > 0 && b.available <= b.reorder_level ? 0 : 1;
        if (aLow !== bLow) return aLow - bLow;
        return b.suggested - a.suggested;
      });
  }, [variants.data, stock.data, onlyLow]);

  // Reset selections whenever the chosen branch changes.
  useEffect(() => {
    setSel({});
  }, [br]);

  // Default every visible row to selected with its suggested quantity.
  useEffect(() => {
    setSel((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const r of rows) {
        if (!next[r.variant_id]) {
          next[r.variant_id] = { on: true, qty: r.suggested, cost: r.cost };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [rows]);

  const chosen = rows
    .map((r) => ({ r, s: sel[r.variant_id] }))
    .filter((x): x is { r: Row; s: Pick } => !!x.s && x.s.on);
  const estimated = chosen.reduce(
    (sum, { s }) => sum + (Number(s.qty) || 0) * (Number(s.cost) || 0),
    0,
  );

  const create = useMutation({
    mutationFn: async () => {
      if (!supplier) throw new Error("Choose a supplier.");
      const items = chosen
        .map(({ r, s }) => ({
          variant_id: r.variant_id,
          qty: Math.max(1, Math.trunc(Number(s.qty) || 0)),
          price: Number(s.cost) || 0,
          discount: 0,
        }))
        .filter((i) => i.qty > 0);
      if (!items.length) throw new Error("Select at least one product.");
      const { data, error } = await supabase.rpc("save_purchase_order", {
        _biz: business.id,
        _data: {
          branch_id: br,
          supplier_id: supplier,
          po_date: today(),
          expected_date: null,
          discount: 0,
          tax: 0,
          notes: "Generated from reorder suggestions",
          terms: "",
          items,
        },
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success("Draft purchase order created");
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      navigate({ to: "/app/purchase-orders/$id", params: { id } });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const loading = variants.isLoading || stock.isLoading;
  const lowCount = rows.filter((r) => r.reorder_level > 0 && r.available <= r.reorder_level).length;

  return (
    <div>
      <PageHeader
        title="Reorder suggestions"
        sub="Low-stock products for the chosen branch. Review quantities, pick a supplier and create a draft purchase order."
        actions={
          <Button
            disabled={!canEdit || create.isPending || !supplier || !chosen.length}
            onClick={() => create.mutate()}
          >
            <ClipboardList className="mr-1 h-4 w-4" />
            {create.isPending ? "Creating…" : `Create draft PO (${chosen.length})`}
          </Button>
        }
      />

      {!canEdit ? (
        <p className="text-sm text-destructive">
          You do not have permission to create purchase orders.
        </p>
      ) : (
        <div className="space-y-4">
          <section className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-3">
            <F label="Branch">
              <select className={selectCls} value={br} onChange={(e) => setBranch(e.target.value)}>
                {branches.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </F>
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
            <div className="flex items-end">
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={onlyLow}
                  onChange={(e) => setOnlyLow(e.target.checked)}
                />
                Only show low stock
              </label>
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              {lowCount} product{lowCount === 1 ? "" : "s"} at or below reorder level
            </span>
            <span className="num font-medium">Estimated {bdt(estimated)}</span>
            {stock.isFetching && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <RefreshCw className="h-3 w-3 animate-spin" /> refreshing
              </span>
            )}
          </div>

          <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
            {loading ? (
              <p className="p-8 text-center text-sm text-muted-foreground">Loading…</p>
            ) : !rows.length ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Nothing to reorder for this branch.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead className="text-right">Reorder at</TableHead>
                    <TableHead className="text-right">Order qty</TableHead>
                    <TableHead className="text-right">Unit cost</TableHead>
                    <TableHead className="text-right">Line total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const s = sel[r.variant_id];
                    const low = r.reorder_level > 0 && r.available <= r.reorder_level;
                    return (
                      <TableRow key={r.variant_id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={s?.on ?? false}
                            onChange={(e) =>
                              setSel((prev) => ({
                                ...prev,
                                [r.variant_id]: {
                                  on: e.target.checked,
                                  qty: prev[r.variant_id]?.qty ?? r.suggested,
                                  cost: prev[r.variant_id]?.cost ?? r.cost,
                                },
                              }))
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{r.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.variant ? `${r.variant} · ` : ""}
                            {r.sku}
                          </div>
                        </TableCell>
                        <TableCell className="num text-right">
                          <span className={low ? "font-semibold text-destructive" : ""}>
                            {r.available}
                          </span>
                        </TableCell>
                        <TableCell className="num text-right">{r.reorder_level}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={1}
                            className="ml-auto h-8 w-20"
                            value={s?.qty ?? r.suggested}
                            onChange={(e) =>
                              setSel((prev) => ({
                                ...prev,
                                [r.variant_id]: {
                                  on: prev[r.variant_id]?.on ?? true,
                                  qty: Math.max(1, Math.trunc(Number(e.target.value) || 1)),
                                  cost: prev[r.variant_id]?.cost ?? r.cost,
                                },
                              }))
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            step="0.01"
                            className="ml-auto h-8 w-24"
                            value={s?.cost ?? r.cost}
                            onChange={(e) =>
                              setSel((prev) => ({
                                ...prev,
                                [r.variant_id]: {
                                  on: prev[r.variant_id]?.on ?? true,
                                  qty: prev[r.variant_id]?.qty ?? r.suggested,
                                  cost: Number(e.target.value) || 0,
                                },
                              }))
                            }
                          />
                        </TableCell>
                        <TableCell className="num text-right">
                          {bdt((s?.qty ?? r.suggested) * (s?.cost ?? r.cost))}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
