import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Save, Trash2, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, selectCls } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/app/service/$id")({
  head: ({ matches }) => ({
    meta: [
      { title: `Service Job — ${matchedCompany(matches)}` },
      { name: "description", content: `Service job detail in ${matchedCompany(matches)}.` },
      { property: "og:title", content: `Service Job — ${matchedCompany(matches)}` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ServiceDetail,
});

const WRITE_ROLES = [
  "owner",
  "manager",
  "salesman",
  "branch_manager",
  "accountant",
  "store_keeper",
];
const COST_ROLES = ["owner", "manager", "accountant", "store_keeper"];
const STATUSES = [
  "received",
  "in_progress",
  "waiting_parts",
  "ready_for_pickup",
  "completed",
  "returned",
  "cancelled",
];
const CLOSED = ["completed", "returned", "cancelled"];

type Item = { key: number; description: string; qty: number; unit_price: string };
let seq = 1;
const n = (v: string | number) => (v === "" ? 0 : Number(v));

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function ServiceDetail() {
  const { id } = Route.useParams();
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canWrite = WRITE_ROLES.includes(role as string);
  const canCost = COST_ROLES.includes(role as string);

  const [items, setItems] = useState<Item[]>([]);
  const [labor, setLabor] = useState("");
  const [advance, setAdvance] = useState("");
  const [loaded, setLoaded] = useState(false);

  const doc = useQuery({
    queryKey: ["service-job", id],
    queryFn: async () => {
      const [h, its] = await Promise.all([
        supabase
          .from("service_jobs")
          .select("*,branches(name),customers(name,mobile)")
          .eq("id", id)
          .eq("business_id", business.id)
          .single(),
        supabase
          .from("service_items")
          .select("id,description,qty,unit_price,amount")
          .eq("job_id", id)
          .order("created_at"),
      ]);
      if (h.error) throw h.error;
      if (its.error) throw its.error;
      return { h: h.data, items: its.data };
    },
  });

  useEffect(() => {
    const d = doc.data;
    if (!d || loaded) return;
    setLoaded(true);
    setItems(
      d.items.map((it) => ({
        key: seq++,
        description: it.description,
        qty: it.qty,
        unit_price: Number(it.unit_price) ? String(it.unit_price) : "",
      })),
    );
    setLabor(Number(d.h.labor_cost) ? String(d.h.labor_cost) : "");
    setAdvance(Number(d.h.advance) ? String(d.h.advance) : "");
  }, [doc.data, loaded]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["service-job", id] });
    qc.invalidateQueries({ queryKey: ["service-jobs"] });
  };

  const setStatus = useMutation({
    mutationFn: async (status: string) => {
      const { error } = await supabase.rpc("update_service_status", {
        _biz: business.id,
        _id: id,
        _status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Status updated");
      refresh();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const saveItems = useMutation({
    mutationFn: async () => {
      const lines = items
        .filter((l) => l.description.trim())
        .map((l) => ({
          description: l.description,
          qty: Math.trunc(l.qty),
          unit_price: n(l.unit_price),
        }));
      const { error } = await supabase.rpc("save_service_items", {
        _biz: business.id,
        _id: id,
        _data: { labor_cost: n(labor), advance: n(advance), items: lines },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Job costs saved");
      refresh();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const d = doc.data;
  const partsTotal = items.reduce((s, l) => s + n(l.qty) * n(l.unit_price), 0);
  const previewTotal = partsTotal + n(labor);
  const closed = d ? CLOSED.includes(d.h.status) : false;

  return (
    <div>
      <PageHeader
        title={d ? d.h.job_no : "Service job"}
        sub={
          d
            ? `${d.h.brand ?? ""} ${d.h.model ?? ""} ${d.h.device_type ? `(${d.h.device_type})` : ""}`
            : ""
        }
        actions={
          d && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => navigate({ to: "/app/service" })}>
                Back
              </Button>
              {canWrite && !closed && (
                <Button asChild variant="outline">
                  <Link to="/app/service/new" search={{ edit: d.h.id }}>
                    <Pencil className="mr-1 h-4 w-4" />
                    Edit
                  </Link>
                </Button>
              )}
            </div>
          )
        }
      />

      {doc.error ? (
        <p className="text-sm text-destructive">{friendlyError(doc.error)}</p>
      ) : !d ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <section className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Wrench className="h-4 w-4" />
                Problem
              </div>
              <p className="text-sm text-muted-foreground">{d.h.problem || "—"}</p>
              {d.h.serial_imei && (
                <p className="num mt-2 text-xs text-muted-foreground">
                  Serial / IMEI: {d.h.serial_imei}
                </p>
              )}
            </section>

            <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b p-3 text-sm font-medium">
                <span>Parts &amp; charges</span>
                {canCost && !closed && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setItems((ls) => [
                        ...ls,
                        { key: seq++, description: "", qty: 1, unit_price: "" },
                      ])
                    }
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Add line
                  </Button>
                )}
              </div>
              {!items.length ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  No parts or charges added.
                </p>
              ) : (
                <div className="divide-y">
                  {items.map((l) => (
                    <div key={l.key} className="flex items-center gap-2 p-3">
                      <Input
                        className="flex-1"
                        placeholder="Description"
                        value={l.description}
                        disabled={!canCost || closed}
                        onChange={(e) =>
                          setItems((ls) =>
                            ls.map((x) =>
                              x.key === l.key ? { ...x, description: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <Input
                        type="number"
                        min={1}
                        className="w-16"
                        value={l.qty}
                        disabled={!canCost || closed}
                        onChange={(e) =>
                          setItems((ls) =>
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
                      <Input
                        type="number"
                        step="0.01"
                        className="w-24"
                        value={l.unit_price}
                        disabled={!canCost || closed}
                        onChange={(e) =>
                          setItems((ls) =>
                            ls.map((x) =>
                              x.key === l.key ? { ...x, unit_price: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <div className="num w-24 text-right text-sm text-muted-foreground">
                        {bdt(n(l.qty) * n(l.unit_price))}
                      </div>
                      {canCost && !closed && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remove line"
                          onClick={() => setItems((ls) => ls.filter((x) => x.key !== l.key))}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {canCost && !closed && (
              <section className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-3">
                <F label="Labour / service charge">
                  <Input
                    type="number"
                    step="0.01"
                    value={labor}
                    onChange={(e) => setLabor(e.target.value)}
                  />
                </F>
                <F label="Advance received">
                  <Input
                    type="number"
                    step="0.01"
                    value={advance}
                    onChange={(e) => setAdvance(e.target.value)}
                  />
                </F>
                <div className="flex items-end">
                  <Button
                    className="w-full"
                    disabled={saveItems.isPending}
                    onClick={() => saveItems.mutate()}
                  >
                    <Save className="mr-1 h-4 w-4" />
                    {saveItems.isPending ? "Saving…" : "Save costs"}
                  </Button>
                </div>
              </section>
            )}
          </div>

          <aside className="h-fit space-y-3 rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Status</span>
              <Badge variant={closed ? "secondary" : "default"}>
                {d.h.status.replace(/_/g, " ")}
              </Badge>
            </div>
            {canWrite && !closed && (
              <F label="Change status">
                <select
                  className={selectCls}
                  value={d.h.status}
                  disabled={setStatus.isPending}
                  onChange={(e) => setStatus.mutate(e.target.value)}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </F>
            )}
            <dl className="border-t pt-2">
              <Row label="Customer">{d.h.customers?.name ?? "Walk-in"}</Row>
              {d.h.customers?.mobile && <Row label="Mobile">{d.h.customers.mobile}</Row>}
              <Row label="Branch">{d.h.branches?.name ?? "—"}</Row>
              <Row label="Received">{String(d.h.received_at).slice(0, 10)}</Row>
              <Row label="Est. delivery">{d.h.estimated_delivery ?? "—"}</Row>
              <Row label="Assigned to">{d.h.assigned_to ?? "—"}</Row>
            </dl>
            <dl className="border-t pt-2">
              <Row label="Parts">{bdt(doc.data?.h.parts_cost ?? partsTotal)}</Row>
              <Row label="Labour">{bdt(doc.data?.h.labor_cost ?? n(labor))}</Row>
              <Row label="Estimated">{bdt(d.h.estimated_cost)}</Row>
            </dl>
            <div className="num flex justify-between border-t pt-3 text-base font-semibold">
              <span>Total</span>
              <span>{bdt(previewTotal)}</span>
            </div>
            <dl className="border-t pt-2">
              <Row label="Advance">{bdt(n(advance))}</Row>
              <Row label="Balance">
                <span
                  className={
                    n(labor) + partsTotal - n(advance) > 0 ? "text-destructive" : "text-success"
                  }
                >
                  {bdt(n(labor) + partsTotal - n(advance))}
                </span>
              </Row>
            </dl>
            {d.h.note && <p className="border-t pt-3 text-xs text-muted-foreground">{d.h.note}</p>}
          </aside>
        </div>
      )}
    </div>
  );
}
