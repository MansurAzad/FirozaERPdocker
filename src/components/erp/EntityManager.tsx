import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { friendlyError } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
export type Field = {
  key: string;
  label: string;
  type?: "text" | "number" | "select" | "textarea" | "date";
  options?: { value: string; label: string }[];
  required?: boolean;
  pattern?: RegExp;
  patternMsg?: string;
  placeholder?: string;
  full?: boolean;
};
export type Column = { key: string; label: string; render?: (r: Row) => ReactNode; className?: string };

export function PageHeader({ title, sub, actions }: { title: string; sub?: string | undefined; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="break-words text-2xl font-bold sm:text-3xl">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

export function EntityManager({
  table, title, sub, fields, columns, searchKeys, canWrite, canDelete, orderBy = "created_at", defaults = {}, rowActions, initialSearch = "",
}: {
  table: string; title: string; sub?: string | undefined; fields: Field[]; columns: Column[]; searchKeys: string[];
  canWrite: boolean; canDelete: boolean; orderBy?: string; defaults?: Row; rowActions?: (r: Row) => ReactNode; initialSearch?: string;
}) {
  const { business } = useBusiness();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [q, setQ] = useState(initialSearch);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Row>({});
  const key = [table, business.id];

  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await (supabase.from(table as any) as any)
        .select("*").eq("business_id", business.id).order(orderBy, { ascending: orderBy !== "created_at" });
      if (error) throw error;
      return data as Row[];
    },
  });

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || !data) return data ?? [];
    return data.filter((r) => searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(s)));
  }, [data, q, searchKeys]);

  const save = useMutation({
    mutationFn: async (vals: Row) => {
      const clean: Row = {};
      for (const f of fields) {
        const v = vals[f.key];
        clean[f.key] = f.type === "number" ? Number(v || 0) : v === "" ? null : v;
      }
      const tbl = supabase.from(table as any) as any;
      const res = editing?.id
        ? await tbl.update(clean).eq("business_id", business.id).eq("id", editing.id)
        : await tbl.insert({ ...clean, business_id: business.id });
      if (res.error) throw res.error;
    },
    onSuccess: () => { toast.success("Saved"); setEditing(null); qc.invalidateQueries(); },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from(table as any) as any).delete().eq("business_id", business.id).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries(); },
    onError: (e) => toast.error(friendlyError(e)),
  });

  function open(r: Row | null) {
    const init: Row = {};
    for (const f of fields) init[f.key] = r?.[f.key] ?? defaults[f.key] ?? (f.type === "select" ? f.options?.[0]?.value : "");
    setForm(init);
    setEditing(r ?? {});
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    for (const f of fields) {
      const v = String(form[f.key] ?? "").trim();
      if (f.required && !v) return void toast.error(`${f.label} is required.`);
      if (v && f.pattern && !f.pattern.test(v)) return void toast.error(f.patternMsg ?? `Invalid ${f.label}.`);
      if (f.type === "number" && v && Number.isNaN(Number(v))) return void toast.error(`${f.label} must be a number.`);
    }
    save.mutate(form);
  }

  return (
    <div>
      <PageHeader title={title} sub={sub} actions={canWrite && <Button onClick={() => open(null)}><Plus className="mr-1 h-4 w-4" />{t("add")}</Button>} />
      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
        <div className="border-b p-3 sm:p-4">
          <Input placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        </div>
        {isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : error ? (
          <p className="p-6 text-sm text-destructive">{friendlyError(error)}</p>
        ) : rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((c) => <TableHead key={c.key} className={c.className}>{c.label}</TableHead>)}
                  {(canWrite || canDelete || rowActions) && <TableHead className="w-24" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    {columns.map((c) => <TableCell key={c.key} className={c.className}>{c.render ? c.render(r) : r[c.key] ?? "—"}</TableCell>)}
                    {(canWrite || canDelete || rowActions) && (
                      <TableCell className="whitespace-nowrap text-right">
                        {rowActions?.(r)}
                        {canWrite && <Button size="icon" variant="ghost" aria-label={t("edit")} onClick={() => open(r)}><Pencil className="h-4 w-4" /></Button>}
                        {canDelete && (
                          <Button size="icon" variant="ghost" aria-label={t("delete")}
                            onClick={() => confirm("Delete this record?") && del.mutate(r.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editing?.id ? `${t("edit")} — ${title}` : `${t("add")} — ${title}`}</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key} className={f.full || f.type === "textarea" ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
                <Label>{f.label}{f.required && " *"}</Label>
                {f.type === "select" ? (
                  <select className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>
                    {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.type === "textarea" ? (
                  <Textarea value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                ) : (
                  <Input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} step="0.01" placeholder={f.placeholder}
                    value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                )}
              </div>
            ))}
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>{t("cancel")}</Button>
              <Button disabled={save.isPending}>{t("save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
