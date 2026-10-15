import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Percent } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, selectCls } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/app/bulk-price")({
  head: ({ matches }) => ({
    meta: [
      { title: `Bulk Price Update — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Update many product prices at once in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Bulk Price Update — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: "Apply a percent or amount change to matching products.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BulkPrice,
});

const ROLES = ["owner", "manager", "accountant"];
const num = (v: string | number) => (v === "" ? 0 : Number(v));

function BulkPrice() {
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const canApply = ROLES.includes(role as string);

  const [name, setName] = useState("");
  const [applyType, setApplyType] = useState("percent");
  const [target, setTarget] = useState("retail");
  const [value, setValue] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [note, setNote] = useState("");

  const categories = useQuery({
    queryKey: ["bp-categories", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id,name")
        .eq("business_id", business.id)
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const brands = useQuery({
    queryKey: ["bp-brands", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brands")
        .select("id,name")
        .eq("business_id", business.id)
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const history = useQuery({
    queryKey: ["bulk-price-updates", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bulk_price_updates")
        .select("*")
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const apply = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("apply_bulk_price_update", {
        _biz: business.id,
        _data: {
          name: name || "Bulk price update",
          apply_type: applyType,
          target,
          value: num(value),
          category_id: category || null,
          brand_id: brand || null,
          note,
        },
      });
      if (error) throw error;
      return data as number;
    },
    onSuccess: (count) => {
      toast.success(`Updated ${count} product${count === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["bulk-price-updates"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      setValue("");
      setNote("");
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (!canApply)
    return (
      <div>
        <PageHeader title="Bulk Price Update" />
        <p className="text-sm text-destructive">You do not have permission to change prices.</p>
      </div>
    );

  const valueLabel =
    applyType === "percent"
      ? "Change (%)"
      : applyType === "amount"
        ? "Change (৳)"
        : "New price (৳)";

  return (
    <div>
      <PageHeader
        title="Bulk Price Update"
        sub="Change the retail, wholesale and/or dealer price of every matching active product in one step."
      />
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <section className="h-fit space-y-3 rounded-lg border bg-card p-4 shadow-sm">
          <F label="Update name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Eid price rise"
            />
          </F>
          <div className="grid grid-cols-2 gap-2">
            <F label="Apply">
              <select
                className={selectCls}
                value={applyType}
                onChange={(e) => setApplyType(e.target.value)}
              >
                <option value="percent">Percent change</option>
                <option value="amount">Amount change</option>
                <option value="set">Set to value</option>
              </select>
            </F>
            <F label="Price type">
              <select
                className={selectCls}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="retail">Retail</option>
                <option value="wholesale">Wholesale</option>
                <option value="dealer">Dealer</option>
                <option value="all">All prices</option>
              </select>
            </F>
          </div>
          <F label={valueLabel}>
            <Input
              type="number"
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </F>
          <div className="grid grid-cols-2 gap-2">
            <F label="Category">
              <select
                className={selectCls}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All categories</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </F>
            <F label="Brand">
              <select
                className={selectCls}
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
              >
                <option value="">All brands</option>
                {brands.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </F>
          </div>
          <F label="Note">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
          </F>
          <Button className="w-full" disabled={apply.isPending} onClick={() => apply.mutate()}>
            <Percent className="mr-1 h-4 w-4" />
            {apply.isPending ? "Applying…" : "Apply to matching products"}
          </Button>
          <p className="text-xs text-muted-foreground">
            A negative percent or amount will lower prices. Prices never go below zero.
          </p>
        </section>

        <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <div className="border-b p-3 text-sm font-medium">Recent updates</div>
          {history.error ? (
            <p className="p-4 text-sm text-destructive">{friendlyError(history.error)}</p>
          ) : !history.data?.length ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No price updates yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Change</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Affected</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.data.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="font-medium">{h.name}</TableCell>
                      <TableCell className="capitalize">{h.apply_type}</TableCell>
                      <TableCell className="capitalize">{h.target}</TableCell>
                      <TableCell className="num text-right">
                        {h.apply_type === "percent" ? `${h.value}%` : bdt(h.value)}
                      </TableCell>
                      <TableCell className="num text-right">{h.affected}</TableCell>
                      <TableCell className="num text-xs text-muted-foreground">
                        {new Date(h.created_at).toLocaleString("en-GB")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
