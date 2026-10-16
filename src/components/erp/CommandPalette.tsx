import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search, User, Handshake, Package, Receipt, Truck, ScanLine } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScanButton } from "@/components/erp/ScanButton";
import { cn } from "@/lib/utils";

export type PaletteGroup = {
  group: string;
  items: { to: string; label: string; icon: typeof Search; key?: string | undefined }[];
};
type Hit = { id: string; label: string; sub?: string; icon: typeof Search; go: () => void };

export function CommandPalette({
  open,
  onOpenChange,
  groups,
  businessId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  groups: PaletteGroup[];
  businessId: string;
}) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [sel, setSel] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim()), 220);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (!open) {
      setQ("");
      setSel(0);
    }
  }, [open]);

  const close = () => onOpenChange(false);
  const go = (fn: () => void) => {
    close();
    fn();
  };

  const { data: found = [] } = useQuery({
    queryKey: ["palette", businessId, dq],
    enabled: open && dq.length >= 2,
    queryFn: async (): Promise<Hit[]> => {
      const like = `%${dq.replace(/[%,()]/g, "")}%`;
      const digits = dq.replace(/\D/g, "");
      const [c, s, p, sa, pu, im] = await Promise.all([
        supabase
          .from("customers")
          .select("id,name,mobile")
          .eq("business_id", businessId)
          .or(`name.ilike.${like},mobile.ilike.${like}`)
          .limit(5),
        supabase
          .from("suppliers")
          .select("id,name,mobile")
          .eq("business_id", businessId)
          .or(`name.ilike.${like},mobile.ilike.${like}`)
          .limit(5),
        supabase
          .from("products")
          .select("id,model")
          .eq("business_id", businessId)
          .ilike("model", like)
          .limit(5),
        supabase
          .from("sales")
          .select("id,invoice_no")
          .eq("business_id", businessId)
          .ilike("invoice_no", like)
          .limit(5),
        supabase
          .from("purchases")
          .select("id,invoice_no")
          .eq("business_id", businessId)
          .ilike("invoice_no", like)
          .limit(5),
        digits.length >= 4
          ? supabase
              .from("product_imeis")
              .select("id,imei1,status")
              .eq("business_id", businessId)
              .or(`imei1.ilike.%${digits}%,imei2.ilike.%${digits}%`)
              .limit(5)
          : Promise.resolve({ data: [] as { id: string; imei1: string; status: string }[] }),
      ]);
      const out: Hit[] = [];
      (im.data ?? []).forEach((r) =>
        out.push({
          id: "i" + r.id,
          label: r.imei1,
          sub: `IMEI · ${r.status}`,
          icon: ScanLine,
          go: () => navigate({ to: "/app/imei", search: { q: r.imei1 } as never }),
        }),
      );
      (c.data ?? []).forEach((r) =>
        out.push({
          id: "c" + r.id,
          label: r.name,
          sub: `Customer · ${r.mobile ?? ""}`,
          icon: User,
          go: () =>
            navigate({ to: "/app/ledger", search: { kind: "customer", party: r.id } as never }),
        }),
      );
      (s.data ?? []).forEach((r) =>
        out.push({
          id: "s" + r.id,
          label: r.name,
          sub: `Supplier · ${r.mobile ?? ""}`,
          icon: Handshake,
          go: () =>
            navigate({ to: "/app/ledger", search: { kind: "supplier", party: r.id } as never }),
        }),
      );
      (p.data ?? []).forEach((r) =>
        out.push({
          id: "p" + r.id,
          label: r.model,
          sub: "Product",
          icon: Package,
          go: () => navigate({ to: "/app/stock" }),
        }),
      );
      (sa.data ?? []).forEach((r) =>
        out.push({
          id: "sa" + r.id,
          label: r.invoice_no,
          sub: "Sale invoice",
          icon: Receipt,
          go: () => navigate({ to: "/app/sales/$id", params: { id: r.id } }),
        }),
      );
      (pu.data ?? []).forEach((r) =>
        out.push({
          id: "pu" + r.id,
          label: r.invoice_no,
          sub: "Purchase invoice",
          icon: Truck,
          go: () => navigate({ to: "/app/purchases/$id", params: { id: r.id } }),
        }),
      );
      return out;
    },
  });

  const ql = q.trim().toLowerCase();
  const shownGroups = useMemo(
    () =>
      groups
        .map((g) => ({
          ...g,
          items: g.items.filter(
            (i) => !ql || i.label.toLowerCase().includes(ql) || g.group.toLowerCase().includes(ql),
          ),
        }))
        .filter((g) => g.items.length),
    [groups, ql],
  );
  const flat: Hit[] = useMemo(
    () => [
      ...shownGroups.flatMap((g) =>
        g.items.map((i) => ({
          id: i.to,
          label: i.label,
          icon: i.icon,
          go: () => navigate({ to: i.to }),
        })),
      ),
      ...(dq.length >= 2 ? found : []),
    ],
    [shownGroups, found, dq, navigate],
  );
  useEffect(() => setSel(0), [ql, found.length]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      setSel((s) => Math.min(flat.length - 1, s + 1));
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const h = flat[sel];
      if (h) go(h.go);
    }
  }

  let idx = -1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-4xl gap-0 overflow-hidden p-0" onKeyDown={onKey}>
        <DialogTitle className="sr-only">Menu and global search</DialogTitle>
        <div className="flex items-center gap-2 border-b p-3 pr-12" data-no-enter-nav>
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search menu, customer, supplier, product, invoice or IMEI…"
            className="border-0 shadow-none focus-visible:ring-0"
          />
          <ScanButton multi={false} onCodes={(c) => setQ(c[0] ?? "")} />
        </div>
        <div className="max-h-[70vh] space-y-5 overflow-y-auto p-4">
          {shownGroups.map((g) => (
            <div key={g.group}>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {g.group}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {g.items.map((it) => {
                  idx++;
                  const me = idx;
                  return (
                    <button
                      key={it.to}
                      type="button"
                      onMouseEnter={() => setSel(me)}
                      onClick={() => go(() => navigate({ to: it.to }))}
                      className={cn(
                        "flex items-center gap-2 rounded-md border bg-card px-3 py-2.5 text-left text-sm font-medium transition-colors hover:border-primary/50",
                        sel === me && "border-primary bg-accent",
                      )}
                    >
                      <it.icon className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate">{it.label}</span>
                      {it.key && (
                        <kbd className="ml-auto rounded border bg-muted px-1 text-[10px] text-muted-foreground">
                          {it.key}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {dq.length >= 2 && (
            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Records
              </div>
              {!found.length ? (
                <p className="text-sm text-muted-foreground">No matching records.</p>
              ) : (
                <div className="divide-y rounded-md border">
                  {found.map((h) => {
                    idx++;
                    const me = idx;
                    return (
                      <button
                        key={h.id}
                        type="button"
                        onMouseEnter={() => setSel(me)}
                        onClick={() => go(h.go)}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent",
                          sel === me && "bg-accent",
                        )}
                      >
                        <h.icon className="h-4 w-4 text-primary" />
                        <span className="font-medium">{h.label}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{h.sub}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-3 border-t bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
          <span>↑↓ move</span>
          <span>Enter open</span>
          <span>Esc close</span>
          <span>F1 shortcuts & guide</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
