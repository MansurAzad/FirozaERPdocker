import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { Input } from "@/components/ui/input";
import { ScanButton } from "@/components/erp/ScanButton";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight, ScanLine } from "lucide-react";
import {
  ExcelDataTools,
  type ExcelColumn,
  type ExcelRecord,
} from "@/components/erp/ExcelDataTools";
import { hasAccess } from "@/lib/access-control";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/app/stock")({
  validateSearch: (search: Record<string, unknown>): { branch?: string | undefined } => ({
    branch: typeof search["branch"] === "string" ? search["branch"] : undefined,
  }),
  head: ({ matches }) => ({
    meta: [
      { title: `Inventory — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: "View branch inventory, landed cost, retail value and low-stock products.",
      },
      { property: "og:title", content: `Inventory — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: "View branch stock, product value and low-stock alerts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StockPage,
});

function StockPage() {
  const { business, access, role } = useBusiness();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [branch, setBranch] = useState(Route.useSearch().branch ?? "");
  const { data, error, isLoading } = useQuery({
    queryKey: ["stock", business.id],
    queryFn: async () => {
      const [stock, branches, variants] = await Promise.all([
        (async () => {
          const all = [];
          for (let offset = 0; ; offset += 1000) {
            const { data, error } = await supabase
              .from("stock")
              .select(
                "branch_id,variant_id,qty,avg_cost,branches(name),product_variants(sku,ram,storage,color,reorder_level,retail_price,products(model,brands(name)))",
              )
              .eq("business_id", business.id)
              .order("branch_id", { ascending: true })
              .order("variant_id", { ascending: true })
              .range(offset, offset + 999);
            if (error) throw error;
            all.push(...data);
            if (data.length < 1000) return all;
          }
        })(),
        supabase
          .from("branches")
          .select("id,name,status")
          .eq("business_id", business.id)
          .order("name"),
        (async () => {
          const all = [];
          for (let offset = 0; ; offset += 1000) {
            const { data, error } = await supabase
              .from("product_variants")
              .select("id,sku,purchase_price,ram,storage,color,products(model,brands(name))")
              .eq("business_id", business.id)
              .eq("status", "active")
              .order("sku")
              .range(offset, offset + 999);
            if (error) throw error;
            all.push(...data);
            if (data.length < 1000) return all;
          }
        })(),
      ]);
      if (branches.error) throw branches.error;
      return { stock, branches: branches.data, variants };
    },
  });
  const rows = useMemo(() => {
    const s = q.toLowerCase().trim();
    return (data?.stock ?? []).filter(
      (r) =>
        (!branch || r.branch_id === branch) &&
        (!s ||
          [
            r.product_variants?.sku,
            r.product_variants?.products?.model,
            r.product_variants?.products?.brands?.name,
          ].some((x) => (x ?? "").toLowerCase().includes(s))),
    );
  }, [data, q, branch]);
  const value = rows.reduce((a, r) => a + r.qty * Number(r.avg_cost), 0);
  const units = rows.reduce((a, r) => a + r.qty, 0);

  const excelColumns: ExcelColumn[] = [
    { key: "branch", label: "Branch", required: true },
    { key: "sku", label: "SKU", required: true },
    { key: "product", label: "Product" },
    { key: "current_qty", label: "Current quantity", type: "number" },
    { key: "counted_qty", label: "Counted quantity", required: true, type: "number" },
    { key: "unit_cost", label: "Unit cost", type: "number" },
  ];
  const exportRows: ExcelRecord[] = (data?.stock ?? []).map((row) => ({
    branch: row.branches?.name ?? "",
    sku: row.product_variants?.sku ?? "",
    product:
      `${row.product_variants?.products?.brands?.name ?? ""} ${row.product_variants?.products?.model ?? ""}`.trim(),
    current_qty: row.qty,
    counted_qty: row.qty,
    unit_cost: row.avg_cost,
  }));
  let stockImportBranch = "";
  const stockImportSkus = new Set<string>();
  const validateStockRow = (row: ExcelRecord, line: number) => {
    if (line === 2) {
      stockImportBranch = "";
      stockImportSkus.clear();
    }
    if (data?.variants.length === 0) return "There are no active products to count.";
    const branchName = String(row.branch ?? "")
      .trim()
      .toLowerCase();
    const matches = (data?.branches ?? []).filter(
      (item) => item.name.trim().toLowerCase() === branchName && item.status === "active",
    );
    if (matches.length !== 1) return "Branch must match one unique active branch name.";
    const sku = String(row.sku ?? "")
      .trim()
      .toLowerCase();
    const variant = data?.variants.find((item) => item.sku.trim().toLowerCase() === sku);
    if (!variant) return "SKU does not match an active product in this business.";
    if (stockImportBranch && stockImportBranch !== branchName)
      return "Import one branch per spreadsheet so stock posting stays atomic.";
    if (stockImportSkus.has(sku)) return "Duplicate SKU in spreadsheet.";
    const quantity = Number(row.counted_qty);
    if (!Number.isInteger(quantity) || quantity < 0)
      return "Counted quantity must be a whole number greater than or equal to zero.";
    if (row.unit_cost !== "" && Number(row.unit_cost) < 0) return "Unit cost cannot be negative.";
    stockImportBranch = branchName;
    stockImportSkus.add(sku);
    return null;
  };
  const importStock = async (records: ExcelRecord[]) => {
    if (!navigator.onLine) throw new Error("Connect to the internet before importing Excel data.");
    const selectedBranchNames = new Set(
      records.map((record) =>
        String(record.branch ?? "")
          .trim()
          .toLowerCase(),
      ),
    );
    if (selectedBranchNames.size !== 1)
      throw new Error("Import one branch per spreadsheet so stock posting stays atomic.");
    const skuNames = records.map((record) =>
      String(record.sku ?? "")
        .trim()
        .toLowerCase(),
    );
    if (new Set(skuNames).size !== skuNames.length)
      throw new Error("The file contains duplicate SKUs. Remove duplicates before importing.");
    const branchName = String(records[0]?.branch ?? "")
      .trim()
      .toLowerCase();
    const branch = data?.branches.find(
      (item) => item.name.trim().toLowerCase() === branchName && item.status === "active",
    );
    if (!branch) throw new Error("Choose one active branch for this stock-count import.");
    const items = records.map((record) => {
      const sku = String(record.sku).trim().toLowerCase();
      const variant = data?.variants.find((item) => item.sku.trim().toLowerCase() === sku);
      const current = data?.stock.find(
        (item) => item.branch_id === branch.id && item.variant_id === variant?.id,
      );
      return {
        variant_id: variant!.id,
        new_qty: Number(record.counted_qty),
        unit_cost:
          record.unit_cost === "" || record.unit_cost == null
            ? Number(current?.avg_cost ?? variant!.purchase_price)
            : Number(record.unit_cost),
      };
    });
    const { data: adjustmentId, error: saveError } = await supabase.rpc("save_stock_adjustment", {
      _biz: business.id,
      _data: {
        branch_id: branch.id,
        adj_type: "recount",
        reason: "Excel stock count import",
        note: "Imported from Excel; quantities are posted as a physical recount.",
        items,
      },
    });
    if (saveError) throw saveError;
    const { error: postError } = await supabase.rpc("post_stock_adjustment", {
      _biz: business.id,
      _id: adjustmentId,
    });
    if (postError)
      throw new Error(
        `Stock was not changed. Draft adjustment ${adjustmentId} was saved; post it from Stock Adjustments after resolving: ${friendlyError(postError)}`,
      );
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["stock", business.id] }),
      qc.invalidateQueries({ queryKey: ["stock-adjustments"] }),
    ]);
    return { imported: records.length };
  };
  const canImportStock =
    ["owner", "manager", "accountant", "store_keeper"].includes(role) &&
    hasAccess(access, "stock_adjustments", "create") &&
    hasAccess(access, "stock_adjustments", "approve");

  return (
    <div>
      <PageHeader
        title="Stock"
        sub="দোকানে কী কী আছে? — valued at landed cost."
        actions={
          <ExcelDataTools
            canExport={hasAccess(access, "inventory", "export") && !!data}
            canImport={canImportStock && !isLoading && !!data}
            exports={[
              {
                label: "Export Excel",
                fileName: "inventory-stock",
                columns: excelColumns,
                rows: exportRows,
              },
            ]}
            importConfig={{
              title: "inventory count",
              fileName: "inventory-stock-count",
              description:
                "Imports a physical count for one active branch and posts it through a stock adjustment. Leave Unit cost blank to use the current average cost.",
              columns: excelColumns.filter(
                (column) => column.key !== "product" && column.key !== "current_qty",
              ),
              validateRow: validateStockRow,
              onImport: importStock,
            }}
          />
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 overflow-hidden rounded-lg border bg-card p-3 shadow-sm sm:p-4">
          <div className="break-words text-xs font-semibold uppercase text-muted-foreground">
            Units in stock
          </div>
          <div className="num mt-1 break-words font-display text-xl font-semibold sm:text-2xl">
            {units}
          </div>
        </div>
        <div className="min-w-0 overflow-hidden rounded-lg border bg-card p-3 shadow-sm sm:p-4">
          <div className="break-words text-xs font-semibold uppercase text-muted-foreground">
            Stock value
          </div>
          <div className="num mt-1 break-all font-display text-lg font-semibold sm:text-2xl">
            {bdt(value)}
          </div>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
        <div className="grid gap-2 border-b p-3 sm:grid-cols-[minmax(0,20rem)_12rem_auto] sm:p-4">
          <div className="flex gap-2">
            <Input
              placeholder="Search product or SKU…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <ScanButton multi={false} onCodes={(c) => setQ(c[0] ?? "")} />
          </div>
          <select
            className="h-10 rounded-md border border-input bg-card px-3 text-sm"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="">All branches</option>
            {data?.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <Button asChild variant="outline">
            <Link to="/app/transfers">
              <ArrowLeftRight />
              Transfer stock
            </Link>
          </Button>
        </div>
        {error ? (
          <p className="p-6 text-sm text-destructive">{friendlyError(error)}</p>
        ) : rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            No stock yet. Post a purchase to add stock.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Avg cost</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Retail</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const v = r.product_variants;
                  const low = r.qty <= (v?.reorder_level ?? 0);
                  return (
                    <TableRow key={r.branch_id + r.variant_id}>
                      <TableCell>
                        <div className="font-medium">
                          {v?.products?.brands?.name} {v?.products?.model}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {[v?.ram, v?.storage, v?.color].filter(Boolean).join(" / ")} · {v?.sku}
                        </div>
                      </TableCell>
                      <TableCell>{r.branches?.name}</TableCell>
                      <TableCell className="num text-right">
                        {r.qty}{" "}
                        {low && (
                          <Badge variant="destructive" className="ml-1">
                            Low
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="num text-right">{bdt(r.avg_cost)}</TableCell>
                      <TableCell className="num text-right">
                        {bdt(r.qty * Number(r.avg_cost))}
                      </TableCell>
                      <TableCell className="num text-right">{bdt(v?.retail_price)}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="ghost">
                          <Link to="/app/imei">
                            <ScanLine />
                            IMEI
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
