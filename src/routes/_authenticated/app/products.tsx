import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Barcode, Boxes, Pencil, Plus, ScanLine, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness, useCan } from "@/lib/business";
import { useI18n } from "@/lib/i18n";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ExcelDataTools,
  type ExcelColumn,
  type ExcelRecord,
} from "@/components/erp/ExcelDataTools";
import { hasAccess } from "@/lib/access-control";

export const Route = createFileRoute("/_authenticated/app/products")({
  head: ({ matches }) => ({
    meta: [
      { title: `Products — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: "Manage mobile products, variants, pricing, SKUs and IMEI-tracked inventory.",
      },
      { property: "og:title", content: `Products — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: "Manage products, pricing, SKUs and IMEI-tracked inventory.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProductsPage,
});

const PRICE_FIELDS = [
  ["purchase_price", "Purchase"],
  ["wholesale_price", "Wholesale"],
  ["dealer_price", "Dealer"],
  ["retail_price", "Retail"],
  ["min_price", "Minimum selling"],
] as const;

const blank = {
  brand_id: "",
  category_id: "",
  model: "",
  sku: "",
  ram: "",
  storage: "",
  color: "",
  purchase_price: "",
  wholesale_price: "",
  dealer_price: "",
  retail_price: "",
  min_price: "",
  reorder_level: "0",
  warranty_months: "0",
};

function ProductsPage() {
  const { business, access } = useBusiness();
  const { t } = useI18n();
  const can = useCan("catalog");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<typeof blank>(blank);
  const [editId, setEditId] = useState<string | null>(null);
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [saveAndStock, setSaveAndStock] = useState(false);

  const lookups = useQuery({
    queryKey: ["lookups", business.id],
    queryFn: async () => {
      const [b, c] = await Promise.all([
        supabase.from("brands").select("id,name").eq("business_id", business.id).order("name"),
        supabase
          .from("categories")
          .select("id,name,is_serialized")
          .eq("business_id", business.id)
          .order("name"),
      ]);
      if (b.error) throw b.error;
      if (c.error) throw c.error;
      return { brands: b.data, categories: c.data };
    },
  });

  const list = useQuery({
    queryKey: ["product_variants", business.id],
    queryFn: async () => {
      const all = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase
          .from("product_variants")
          .select(
            "*, products!inner(model, brand_id, category_id, brands(name), categories(name, is_serialized))",
          )
          .eq("business_id", business.id)
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(offset, offset + 999);
        if (error) throw error;
        all.push(...data);
        if (data.length < 1000) return all;
      }
    },
  });

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (list.data ?? []).filter(
      (r) =>
        !s ||
        [r.sku, r.products.model, r.products.brands?.name, r.color].some((x) =>
          String(x ?? "")
            .toLowerCase()
            .includes(s),
        ),
    );
  }, [list.data, q]);

  const save = useMutation({
    mutationFn: async () => {
      if (!f.brand_id || !f.category_id) throw new Error("Select a brand and category.");
      if (!f.model.trim()) throw new Error("Model is required.");
      const num = (k: keyof typeof blank) => Number(f[k] || 0);
      for (const [k, l] of PRICE_FIELDS)
        if (num(k) < 0 || Number.isNaN(num(k))) throw new Error(`Invalid ${l} price.`);
      if (num("min_price") > num("retail_price") && num("retail_price") > 0)
        throw new Error("Minimum selling price cannot exceed retail price.");

      let { data: prod } = await supabase
        .from("products")
        .select("id")
        .eq("business_id", business.id)
        .eq("brand_id", f.brand_id)
        .eq("model", f.model.trim())
        .maybeSingle();
      if (!prod) {
        const r = await supabase
          .from("products")
          .insert({
            business_id: business.id,
            brand_id: f.brand_id,
            category_id: f.category_id,
            model: f.model.trim(),
          })
          .select("id")
          .single();
        if (r.error) throw r.error;
        prod = r.data;
      }
      const payload = {
        product_id: prod.id,
        sku: f.sku.trim().toUpperCase(),
        ram: f.ram || null,
        storage: f.storage || null,
        color: f.color || null,
        purchase_price: num("purchase_price"),
        wholesale_price: num("wholesale_price"),
        dealer_price: num("dealer_price"),
        retail_price: num("retail_price"),
        min_price: num("min_price"),
        reorder_level: Math.trunc(num("reorder_level")),
        warranty_months: Math.trunc(num("warranty_months")),
      };
      const result = editId
        ? await supabase
            .from("product_variants")
            .update({ ...payload, status })
            .eq("id", editId)
            .select("id")
            .single()
        : await supabase
            .from("product_variants")
            .insert({ ...payload, business_id: business.id })
            .select("id")
            .single();
      const { data, error } = result;
      if (error) throw error;
      return data.id;
    },
    onSuccess: (variantId) => {
      toast.success("Product saved");
      setOpen(false);
      setF(blank);
      setEditId(null);
      qc.invalidateQueries({ queryKey: ["product_variants"] });
      if (saveAndStock) navigate({ to: "/app/purchases/new", search: { variant: variantId } });
      setSaveAndStock(false);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("product_variants").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["product_variants"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const excelColumns: ExcelColumn[] = [
    { key: "brand", label: "Brand", required: true },
    { key: "category", label: "Category", required: true },
    { key: "model", label: "Model", required: true },
    { key: "sku", label: "SKU" },
    { key: "ram", label: "RAM" },
    { key: "storage", label: "Storage" },
    { key: "color", label: "Color" },
    { key: "purchase_price", label: "Purchase price", type: "number" },
    { key: "wholesale_price", label: "Wholesale price", type: "number" },
    { key: "dealer_price", label: "Dealer price", type: "number" },
    { key: "retail_price", label: "Retail price", type: "number" },
    { key: "min_price", label: "Minimum selling price", type: "number" },
    { key: "reorder_level", label: "Reorder level", type: "number" },
    { key: "warranty_months", label: "Warranty months", type: "number" },
    { key: "status", label: "Status" },
  ];
  const exportRows: ExcelRecord[] = (list.data ?? []).map((row) => ({
    brand: row.products.brands?.name ?? "",
    category: row.products.categories?.name ?? "",
    model: row.products.model,
    sku: row.sku,
    ram: row.ram ?? "",
    storage: row.storage ?? "",
    color: row.color ?? "",
    purchase_price: row.purchase_price,
    wholesale_price: row.wholesale_price,
    dealer_price: row.dealer_price,
    retail_price: row.retail_price,
    min_price: row.min_price,
    reorder_level: row.reorder_level,
    warranty_months: row.warranty_months,
    status: row.status,
  }));
  const importProducts = async (records: ExcelRecord[]) => {
    if (!navigator.onLine) throw new Error("Connect to the internet before importing Excel data.");
    const productRows = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("products")
        .select("id,brand_id,category_id,model")
        .eq("business_id", business.id)
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      if (error) throw error;
      productRows.push(...data);
      if (data.length < 1000) break;
    }
    const productIds = new Map(
      productRows.map((row) => [
        `${row.brand_id}:${row.category_id}:${row.model.trim().toLowerCase()}`,
        row.id,
      ]),
    );
    const skuKeys = new Set((list.data ?? []).map((row) => row.sku.trim().toLowerCase()));
    const variantKeys = new Set(
      (list.data ?? []).map((row) =>
        [
          row.products.brand_id,
          row.products.category_id,
          row.products.model.trim().toLowerCase(),
          row.ram ?? "",
          row.storage ?? "",
          row.color ?? "",
        ]
          .join(":")
          .toLowerCase(),
      ),
    );
    const seenSkus = new Set<string>();
    const seenVariants = new Set<string>();
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const [index, row] of records.entries()) {
      const brands = (lookups.data?.brands ?? []).filter(
        (item) => item.name.trim().toLowerCase() === String(row.brand).trim().toLowerCase(),
      );
      const categories = (lookups.data?.categories ?? []).filter(
        (item) => item.name.trim().toLowerCase() === String(row.category).trim().toLowerCase(),
      );
      if (brands.length !== 1 || categories.length !== 1) {
        errors.push(`Row ${index + 2}: Brand or category must match one unique record.`);
        continue;
      }
      const brand = brands[0]!;
      const category = categories[0]!;
      const model = String(row.model).trim();
      const sku = String(row.sku ?? "")
        .trim()
        .toUpperCase();
      const skuKey = sku.toLowerCase();
      const variantKey = [
        brand.id,
        category.id,
        model.toLowerCase(),
        String(row.ram ?? "")
          .trim()
          .toLowerCase(),
        String(row.storage ?? "")
          .trim()
          .toLowerCase(),
        String(row.color ?? "")
          .trim()
          .toLowerCase(),
      ].join(":");
      if (
        (skuKey && (skuKeys.has(skuKey) || seenSkus.has(skuKey))) ||
        variantKeys.has(variantKey) ||
        seenVariants.has(variantKey)
      ) {
        skipped += 1;
        continue;
      }
      const statusValue =
        String(row.status ?? "")
          .trim()
          .toLowerCase() || "active";
      if (statusValue !== "active" && statusValue !== "inactive") {
        errors.push(`Row ${index + 2}: Status must be active or inactive.`);
        continue;
      }
      const modelKey = `${brand.id}:${category.id}:${model.toLowerCase()}`;
      let productId = productIds.get(modelKey);
      let createdProduct = false;
      try {
        if (!productId) {
          const { data: product, error } = await supabase
            .from("products")
            .insert({
              business_id: business.id,
              brand_id: brand.id,
              category_id: category.id,
              model,
            })
            .select("id")
            .single();
          if (error) throw error;
          productId = product.id;
          productIds.set(modelKey, productId);
          createdProduct = true;
        }
        const { data: variant, error } = await supabase
          .from("product_variants")
          .insert({
            business_id: business.id,
            product_id: productId,
            sku,
            ram: String(row.ram ?? "").trim() || null,
            storage: String(row.storage ?? "").trim() || null,
            color: String(row.color ?? "").trim() || null,
            purchase_price: Number(row.purchase_price || 0),
            wholesale_price: Number(row.wholesale_price || 0),
            dealer_price: Number(row.dealer_price || 0),
            retail_price: Number(row.retail_price || 0),
            min_price: Number(row.min_price || 0),
            reorder_level: Math.trunc(Number(row.reorder_level || 0)),
            warranty_months: Math.trunc(Number(row.warranty_months || 0)),
            status: statusValue,
          })
          .select("id,sku")
          .single();
        if (error) throw error;
        if (variant.sku) {
          skuKeys.add(variant.sku.toLowerCase());
          seenSkus.add(variant.sku.toLowerCase());
        }
        variantKeys.add(variantKey);
        seenVariants.add(variantKey);
        imported += 1;
      } catch (error) {
        if (createdProduct && productId) {
          const { error: cleanupError } = await supabase
            .from("products")
            .delete()
            .eq("business_id", business.id)
            .eq("id", productId);
          if (cleanupError) {
            errors.push(
              `Row ${index + 2}: ${friendlyError(error)} Also failed to remove the unused product model: ${friendlyError(cleanupError)}`,
            );
            continue;
          }
          productIds.delete(modelKey);
        }
        errors.push(`Row ${index + 2}: ${friendlyError(error)}`);
      }
    }
    if (imported) await qc.invalidateQueries({ queryKey: ["product_variants", business.id] });
    return { imported, skipped, errors };
  };

  const sel = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
  const selectedCategory = lookups.data?.categories.find((c) => c.id === f.category_id);
  const input = (k: keyof typeof blank, l: string, type = "text") => (
    <div className="space-y-1.5">
      <Label>{l}</Label>
      <Input type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </div>
  );

  return (
    <div>
      <PageHeader
        title={t("products")}
        sub="Brand → Model → Variant. Prices per level."
        actions={
          <>
            <ExcelDataTools
              canExport={hasAccess(access, "products", "export") && !!list.data}
              canImport={hasAccess(access, "products", "create") && !!list.data && !!lookups.data}
              exports={[
                {
                  label: "Export Excel",
                  fileName: "products",
                  columns: excelColumns,
                  rows: exportRows,
                },
              ]}
              importConfig={{
                title: "products",
                fileName: "products",
                description:
                  "Adds new product variants. Brand and category names must already exist; duplicate SKUs or variants are skipped.",
                columns: excelColumns,
                validateRow: (row) => {
                  if (
                    lookups.data?.brands.filter(
                      (item) =>
                        item.name.trim().toLowerCase() === String(row.brand).trim().toLowerCase(),
                    ).length !== 1
                  )
                    return "Brand must match one unique existing brand.";
                  if (
                    lookups.data?.categories.filter(
                      (item) =>
                        item.name.trim().toLowerCase() ===
                        String(row.category).trim().toLowerCase(),
                    ).length !== 1
                  )
                    return "Category must match one unique existing category.";
                  for (const column of excelColumns.filter((item) => item.type === "number")) {
                    if (Number(row[column.key] || 0) < 0)
                      return `${column.label} cannot be negative.`;
                  }
                  for (const key of ["reorder_level", "warranty_months"]) {
                    if (!Number.isInteger(Number(row[key] || 0)))
                      return `${key === "reorder_level" ? "Reorder level" : "Warranty months"} must be a whole number.`;
                  }
                  if (
                    Number(row.min_price || 0) > Number(row.retail_price || 0) &&
                    Number(row.retail_price || 0) > 0
                  )
                    return "Minimum selling price cannot exceed retail price.";
                  if (
                    !["", "active", "inactive"].includes(
                      String(row.status ?? "")
                        .trim()
                        .toLowerCase(),
                    )
                  )
                    return "Status must be active or inactive.";
                  return null;
                },
                onImport: importProducts,
              }}
            />
            {can && (
              <Button
                onClick={() => {
                  setEditId(null);
                  setF(blank);
                  setStatus("active");
                  setOpen(true);
                }}
                disabled={!lookups.data?.brands.length}
              >
                <Plus className="mr-1 h-4 w-4" />
                {t("add")}
              </Button>
            )}
          </>
        }
      />
      {lookups.data && !lookups.data.brands.length && (
        <p className="mb-4 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Add a brand first (Brands page) before creating products.
        </p>
      )}
      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
        <div className="grid gap-3 border-b p-3 sm:grid-cols-[minmax(0,20rem)_auto] sm:items-center sm:p-4">
          <Input
            placeholder={`${t("search")} product, SKU or color`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <p className="text-xs text-muted-foreground sm:text-right">
            {rows.length} product variant{rows.length === 1 ? "" : "s"}
          </p>
        </div>
        {list.isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : list.error ? (
          <p className="p-6 text-sm text-destructive">{friendlyError(list.error)}</p>
        ) : rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Purchase</TableHead>
                  <TableHead className="text-right">Dealer</TableHead>
                  <TableHead className="text-right">Wholesale</TableHead>
                  <TableHead className="text-right">Retail</TableHead>
                  <TableHead className="text-right">Warranty</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="font-medium">
                        {r.products.brands?.name} {r.products.model}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {[r.ram, r.storage, r.color].filter(Boolean).join(" / ") || "—"}
                      </div>
                    </TableCell>
                    <TableCell className="num text-xs">{r.sku}</TableCell>
                    <TableCell>
                      {r.products.categories?.name}{" "}
                      {r.products.categories?.is_serialized && (
                        <Link to="/app/imei">
                          <Badge variant="outline" className="ml-1">
                            IMEI
                          </Badge>
                        </Link>
                      )}
                    </TableCell>
                    <TableCell className="num text-right">{bdt(r.purchase_price)}</TableCell>
                    <TableCell className="num text-right">{bdt(r.dealer_price)}</TableCell>
                    <TableCell className="num text-right">{bdt(r.wholesale_price)}</TableCell>
                    <TableCell className="num text-right font-semibold">
                      {bdt(r.retail_price)}
                    </TableCell>
                    <TableCell className="text-right">{r.warranty_months} mo</TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      {r.status === "inactive" && (
                        <Badge variant="secondary" className="mr-1">
                          Inactive
                        </Badge>
                      )}
                      <Button asChild size="sm" variant="ghost">
                        <Link to="/app/stock">
                          <Boxes />
                          Stock
                        </Link>
                      </Button>
                      {r.products.categories?.is_serialized && (
                        <Button asChild size="sm" variant="ghost">
                          <Link to="/app/imei">
                            <ScanLine />
                            IMEI
                          </Link>
                        </Button>
                      )}
                      {can && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Edit"
                          onClick={() => {
                            const str = (v: unknown) => (v == null ? "" : String(v));
                            setF({
                              ...blank,
                              brand_id: str(r.products.brand_id),
                              category_id: str(r.products.category_id),
                              model: r.products.model,
                              sku: r.sku,
                              ram: str(r.ram),
                              storage: str(r.storage),
                              color: str(r.color),
                              reorder_level: str(r.reorder_level),
                              warranty_months: str(r.warranty_months),
                              purchase_price: str(r.purchase_price),
                              wholesale_price: str(r.wholesale_price),
                              dealer_price: str(r.dealer_price),
                              retail_price: str(r.retail_price),
                              min_price: str(r.min_price),
                            } as typeof blank);
                            setStatus(r.status);
                            setEditId(r.id);
                            setOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {can && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Delete"
                          onClick={() => confirm("Delete this variant?") && del.mutate(r.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit product variant" : "Add product variant"}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
            className="grid gap-4 sm:grid-cols-3"
          >
            <div className="space-y-1.5">
              <Label>Brand *</Label>
              <select
                className={sel}
                value={f.brand_id}
                onChange={(e) => setF({ ...f, brand_id: e.target.value })}
              >
                <option value="">Select…</option>
                {lookups.data?.brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Category *</Label>
              <select
                className={sel}
                value={f.category_id}
                onChange={(e) => setF({ ...f, category_id: e.target.value })}
              >
                <option value="">Select…</option>
                {lookups.data?.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            {input("model", "Model *")}
            <div className="space-y-1.5">
              <Label>
                SKU <span className="font-normal text-muted-foreground">(auto)</span>
              </Label>
              <div className="relative">
                <Barcode className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  value={f.sku}
                  placeholder="SKU-000001"
                  onChange={(e) => setF({ ...f, sku: e.target.value })}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Leave blank to generate the next SKU automatically.
              </p>
            </div>
            {input("ram", "RAM")}
            {input("storage", "Storage")}
            {input("color", "Color")}
            {input("reorder_level", "Reorder level", "number")}
            {input("warranty_months", "Warranty (months)", "number")}
            {selectedCategory?.is_serialized && (
              <div className="rounded-md border border-primary/25 bg-accent p-4 sm:col-span-3">
                <div className="flex gap-3">
                  <ScanLine className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">IMEI required for every unit</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      After saving, add stock through Purchase. There you can enter IMEI 1, optional
                      IMEI 2, and serial number with supplier, branch and cost.
                    </p>
                  </div>
                </div>
              </div>
            )}
            <div className="sm:col-span-3 border-t pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Price levels (৳)
            </div>
            {PRICE_FIELDS.map(([k, l]) => (
              <div key={k}>{input(k, l, "number")}</div>
            ))}
            {editId && (
              <div className="space-y-1.5">
                <Label>Status</Label>
                <select
                  className={sel}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "active" | "inactive")}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive (hidden from sale/purchase)</option>
                </select>
              </div>
            )}
            <DialogFooter className="flex-col-reverse gap-2 sm:col-span-3 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
              {!editId && selectedCategory?.is_serialized && (
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={save.isPending}
                  onClick={() => setSaveAndStock(true)}
                >
                  <ScanLine />
                  Save & add IMEI stock
                </Button>
              )}
              <Button
                type="submit"
                disabled={save.isPending}
                onClick={() => setSaveAndStock(false)}
              >
                {t("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
