import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Printer, Save, Tag, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { BARCODE_FORMATS, type BarcodeFormat, useBarcode, useQr } from "@/lib/barcode";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, selectCls } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label as FieldLabel } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/app/labels")({
  head: ({ matches }) => ({
    meta: [
      { title: `Barcode & QR Labels — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Print barcode and QR labels for products in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Barcode & QR Labels — ${matchedCompany(matches)}` },
      { property: "og:description", content: "Design and print shelf / product labels." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Labels,
});

type Variant = {
  id: string;
  sku: string;
  ram: string | null;
  storage: string | null;
  color: string | null;
  retail_price: number;
  products: { model: string; brands: { name: string } | null } | null;
};
type Tmpl = {
  kind: string;
  paper: string;
  width_mm: number;
  height_mm: number;
  cols: number;
  rows: number;
  show_name: boolean;
  show_sku: boolean;
  show_price: boolean;
  barcode_format: string;
};
type Picked = { variant_id: string; copies: number };

const DEFAULTS: Tmpl = {
  kind: "barcode",
  paper: "a4",
  width_mm: 50,
  height_mm: 25,
  cols: 4,
  rows: 10,
  show_name: true,
  show_sku: true,
  show_price: false,
  barcode_format: "CODE128",
};

function Labels() {
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const canSave = ["owner", "manager"].includes(role as string);

  const [tmplId, setTmplId] = useState("");
  const [name, setName] = useState("Default label");
  const [t, setT] = useState<Tmpl>(DEFAULTS);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);

  const templates = useQuery({
    queryKey: ["label-templates", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("label_templates")
        .select("*")
        .eq("business_id", business.id)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const variants = useQuery({
    queryKey: ["label-variants", business.id],
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

  // Load the default template once, if the business has one.
  useEffect(() => {
    const def = templates.data?.find((x) => x.is_default) ?? templates.data?.[0];
    if (def && !tmplId) {
      setTmplId(def.id);
      setName(def.name);
      setT({
        kind: def.kind,
        paper: def.paper,
        width_mm: Number(def.width_mm),
        height_mm: Number(def.height_mm),
        cols: def.cols,
        rows: def.rows,
        show_name: def.show_name,
        show_sku: def.show_sku,
        show_price: def.show_price,
        barcode_format: def.barcode_format,
      });
    }
  }, [templates.data, tmplId]);

  const loadTemplate = (id: string) => {
    setTmplId(id);
    const def = templates.data?.find((x) => x.id === id);
    if (!def) return;
    setName(def.name);
    setT({
      kind: def.kind,
      paper: def.paper,
      width_mm: Number(def.width_mm),
      height_mm: Number(def.height_mm),
      cols: def.cols,
      rows: def.rows,
      show_name: def.show_name,
      show_sku: def.show_sku,
      show_price: def.show_price,
      barcode_format: def.barcode_format,
    });
  };

  const saveTemplate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("save_label_template", {
        _biz: business.id,
        ...(tmplId ? { _id: tmplId } : {}),
        _data: { name, ...t, is_default: !templates.data?.length },
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success("Template saved");
      setTmplId(id);
      qc.invalidateQueries({ queryKey: ["label-templates"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

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

  const add = (v: Variant) => {
    setPicked((p) =>
      p.some((x) => x.variant_id === v.id) ? p : [...p, { variant_id: v.id, copies: 1 }],
    );
    setSearch("");
  };

  const labels = useMemo(() => {
    const out: { key: string; variant: Variant; index: number }[] = [];
    for (const p of picked) {
      const v = vmap.get(p.variant_id);
      if (!v) continue;
      for (let i = 0; i < Math.min(p.copies, 200); i++) {
        out.push({ key: `${p.variant_id}-${i}`, variant: v, index: i });
      }
    }
    return out.slice(0, 240);
  }, [picked, vmap]);

  const totalLabels = picked.reduce((s, p) => s + p.copies, 0);

  return (
    <div>
      <style>{`
        .label-sheet { display: grid; gap: 2mm; }
        .label-cell { border: 1px dashed #cbd5e1; border-radius: 2px; padding: 2mm; overflow: hidden;
          display: flex; flex-direction: column; align-items: center; justify-content: center; }
        .label-cell svg { max-width: 100%; height: auto; }
        @media print {
          body * { visibility: hidden !important; }
          .label-sheet, .label-sheet * { visibility: visible !important; }
          .label-sheet { position: absolute; left: 0; top: 0; width: 100%; gap: 0; }
          .label-cell { border-color: #e2e8f0; break-inside: avoid; }
          @page { margin: 6mm; }
        }
      `}</style>

      <PageHeader
        title="Barcode & QR Labels"
        sub="Pick products, choose a label size, then print on A4 sheets or a thermal printer."
        actions={
          <Button onClick={() => window.print()} disabled={!picked.length}>
            <Printer className="mr-1 h-4 w-4" />
            Print {totalLabels > 0 ? `(${totalLabels})` : ""}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <section className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Tag className="h-4 w-4" />
              Label template
            </div>
            {!!templates.data?.length && (
              <F label="Load template">
                <select
                  className={selectCls}
                  value={tmplId}
                  onChange={(e) => loadTemplate(e.target.value)}
                >
                  <option value="">New template…</option>
                  {templates.data.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {x.is_default ? " ★" : ""}
                    </option>
                  ))}
                </select>
              </F>
            )}
            <F label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </F>
            <div className="grid grid-cols-2 gap-2">
              <F label="Content">
                <select
                  className={selectCls}
                  value={t.kind}
                  onChange={(e) => setT({ ...t, kind: e.target.value })}
                >
                  <option value="barcode">Barcode</option>
                  <option value="qr">QR only</option>
                  <option value="both">Barcode + QR</option>
                </select>
              </F>
              <F label="Paper">
                <select
                  className={selectCls}
                  value={t.paper}
                  onChange={(e) =>
                    setT(
                      e.target.value === "thermal"
                        ? { ...t, paper: "thermal", cols: 1, rows: 1, width_mm: 40, height_mm: 25 }
                        : { ...t, paper: "a4", cols: 4, rows: 10 },
                    )
                  }
                >
                  <option value="a4">A4 sheet</option>
                  <option value="thermal">Thermal roll</option>
                </select>
              </F>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <F label="Barcode format">
                <select
                  className={selectCls}
                  value={t.barcode_format}
                  onChange={(e) => setT({ ...t, barcode_format: e.target.value })}
                >
                  {BARCODE_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </F>
              <F label="Width × height (mm)">
                <div className="flex gap-1">
                  <Input
                    type="number"
                    value={t.width_mm}
                    onChange={(e) => setT({ ...t, width_mm: Number(e.target.value) || 40 })}
                  />
                  <Input
                    type="number"
                    value={t.height_mm}
                    onChange={(e) => setT({ ...t, height_mm: Number(e.target.value) || 25 })}
                  />
                </div>
              </F>
            </div>
            {t.paper === "a4" && (
              <div className="grid grid-cols-2 gap-2">
                <F label="Columns">
                  <Input
                    type="number"
                    min={1}
                    value={t.cols}
                    onChange={(e) => setT({ ...t, cols: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </F>
                <F label="Rows">
                  <Input
                    type="number"
                    min={1}
                    value={t.rows}
                    onChange={(e) => setT({ ...t, rows: Math.max(1, Number(e.target.value) || 1) })}
                  />
                </F>
              </div>
            )}
            <div className="flex flex-wrap gap-4">
              {(
                [
                  ["show_name", "Product name"],
                  ["show_sku", "SKU text"],
                  ["show_price", "Price"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={t[key]}
                    onChange={(e) => setT({ ...t, [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
            </div>
            {canSave && (
              <Button
                variant="outline"
                className="w-full"
                disabled={saveTemplate.isPending}
                onClick={() => saveTemplate.mutate()}
              >
                <Save className="mr-1 h-4 w-4" />
                {saveTemplate.isPending ? "Saving…" : "Save template"}
              </Button>
            )}
          </section>

          <section className="space-y-3 rounded-lg border bg-card p-4 shadow-sm">
            <FieldLabel className="text-sm font-medium">Products</FieldLabel>
            <Input
              placeholder="Search product to add…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {q && (
              <div className="max-h-48 divide-y overflow-y-auto rounded-md border">
                {results.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => add(v)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="min-w-0 truncate">
                      {v.products?.brands?.name} {v.products?.model}
                    </span>
                    <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                ))}
                {!results.length && (
                  <p className="p-3 text-sm text-muted-foreground">No matching product.</p>
                )}
              </div>
            )}
            {picked.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Add products to build the label sheet.
              </p>
            ) : (
              <div className="space-y-2">
                {picked.map((p) => {
                  const v = vmap.get(p.variant_id);
                  return (
                    <div key={p.variant_id} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">
                        {v?.products?.brands?.name} {v?.products?.model}{" "}
                        <span className="text-muted-foreground">{v?.sku}</span>
                      </span>
                      <Input
                        type="number"
                        min={1}
                        className="h-8 w-16"
                        value={p.copies}
                        onChange={(e) =>
                          setPicked((list) =>
                            list.map((x) =>
                              x.variant_id === p.variant_id
                                ? {
                                    ...x,
                                    copies: Math.max(1, Math.trunc(Number(e.target.value) || 1)),
                                  }
                                : x,
                            ),
                          )
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Remove"
                        onClick={() =>
                          setPicked((list) => list.filter((x) => x.variant_id !== p.variant_id))
                        }
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <section className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between text-sm">
            <span className="font-medium">Preview</span>
            <span className="num text-muted-foreground">
              {labels.length} of {totalLabels} labels
            </span>
          </div>
          {!labels.length ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Labels will appear here.
            </p>
          ) : (
            <div
              className="label-sheet rounded-md bg-white p-1"
              style={{
                gridTemplateColumns:
                  t.paper === "thermal" ? "1fr" : `repeat(${t.cols}, minmax(0, 1fr))`,
              }}
            >
              {labels.map((l) => (
                <LabelCell
                  key={l.key}
                  variant={l.variant}
                  tmpl={t}
                  widthMm={t.paper === "thermal" ? t.width_mm : undefined}
                  heightMm={t.paper === "thermal" ? t.height_mm : undefined}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function LabelCell({
  variant,
  tmpl,
  widthMm,
  heightMm,
}: {
  variant: Variant;
  tmpl: Tmpl;
  widthMm?: number | undefined;
  heightMm?: number | undefined;
}) {
  const wantBarcode = tmpl.kind === "barcode" || tmpl.kind === "both";
  const wantQr = tmpl.kind === "qr" || tmpl.kind === "both";
  const { svg: bar } = useBarcode(variant.sku, tmpl.barcode_format as BarcodeFormat, wantBarcode);
  const { svg: qr } = useQr(variant.sku, wantQr);

  return (
    <div
      className="label-cell"
      style={{
        width: widthMm ? `${widthMm}mm` : "100%",
        height: heightMm ? `${heightMm}mm` : undefined,
      }}
    >
      {tmpl.show_name && (
        <div className="w-full truncate text-center text-[9px] font-medium leading-tight text-slate-800">
          {variant.products?.brands?.name} {variant.products?.model}
        </div>
      )}
      {wantQr && qr && (
        <div
          className="my-0.5 h-12 w-12"
          dangerouslySetInnerHTML={{ __html: qr }}
          aria-hidden="true"
        />
      )}
      {wantBarcode && bar && (
        <div className="w-full" dangerouslySetInnerHTML={{ __html: bar }} aria-hidden="true" />
      )}
      {tmpl.show_sku && (
        <div className="num w-full truncate text-center text-[9px] text-slate-700">
          {variant.sku}
        </div>
      )}
      {tmpl.show_price && (
        <div className="num w-full text-center text-[10px] font-semibold text-slate-900">
          {bdt(variant.retail_price)}
        </div>
      )}
    </div>
  );
}
