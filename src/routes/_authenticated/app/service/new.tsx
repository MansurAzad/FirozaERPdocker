import { matchedCompany } from "@/lib/branding";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { friendlyError } from "@/lib/format";
import { useBranches } from "@/lib/finance";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, selectCls } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/app/service/new")({
  validateSearch: z.object({ edit: z.string().optional() }),
  head: ({ matches }) => ({
    meta: [
      { title: `New Service Job — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Open a service / repair job in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `New Service Job — ${matchedCompany(matches)}` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ServiceForm,
});

const ROLES = ["owner", "manager", "salesman", "branch_manager", "accountant", "store_keeper"];

function ServiceForm() {
  const { business, role } = useBusiness();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const branches = useBranches(business.id);
  const editId = Route.useSearch().edit;
  const canEdit = ROLES.includes(role as string);

  const [branch, setBranch] = useState("");
  const [customer, setCustomer] = useState("");
  const [deviceType, setDeviceType] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [problem, setProblem] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [estimatedDelivery, setEstimatedDelivery] = useState("");
  const [estimatedCost, setEstimatedCost] = useState("");
  const [note, setNote] = useState("");
  const prefilled = useRef(false);

  const br =
    branch ||
    branches.data?.find((b) => b.kind !== "warehouse")?.id ||
    branches.data?.[0]?.id ||
    "";

  const customers = useQuery({
    queryKey: ["svc-customers", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id,name,mobile")
        .eq("business_id", business.id)
        .order("name")
        .limit(2000);
      if (error) throw error;
      return data;
    },
  });

  const existing = useQuery({
    enabled: !!editId,
    queryKey: ["service-job-edit", editId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_jobs")
        .select("*")
        .eq("id", editId!)
        .eq("business_id", business.id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const ex = existing.data;
    if (!ex || prefilled.current) return;
    prefilled.current = true;
    setBranch(ex.branch_id);
    setCustomer(ex.customer_id ?? "");
    setDeviceType(ex.device_type ?? "");
    setBrand(ex.brand ?? "");
    setModel(ex.model ?? "");
    setSerial(ex.serial_imei ?? "");
    setProblem(ex.problem ?? "");
    setAssignedTo(ex.assigned_to ?? "");
    setEstimatedDelivery(ex.estimated_delivery ?? "");
    setEstimatedCost(Number(ex.estimated_cost) ? String(ex.estimated_cost) : "");
    setNote(ex.note ?? "");
  }, [existing.data]);

  const customerLabel = useMemo(() => {
    const c = customers.data?.find((x) => x.id === customer);
    return c ? `${c.name} · ${c.mobile}` : "";
  }, [customers.data, customer]);

  const save = useMutation({
    mutationFn: async () => {
      if (!problem.trim()) throw new Error("Describe the problem.");
      const payload = {
        branch_id: br,
        customer_id: customer || null,
        device_type: deviceType,
        brand,
        model,
        serial_imei: serial,
        problem,
        assigned_to: assignedTo,
        estimated_delivery: estimatedDelivery || null,
        estimated_cost: estimatedCost === "" ? 0 : Number(estimatedCost),
        note,
      };
      const { data, error } = editId
        ? await supabase.rpc("save_service_job", {
            _biz: business.id,
            _id: editId,
            _data: payload,
          })
        : await supabase.rpc("save_service_job", { _biz: business.id, _data: payload });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success(editId ? "Service job updated" : "Service job created");
      qc.invalidateQueries({ queryKey: ["service-jobs"] });
      navigate({ to: "/app/service/$id", params: { id } });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (!canEdit)
    return (
      <div>
        <PageHeader title="New Service Job" />
        <p className="text-sm text-destructive">You do not have permission to open service jobs.</p>
      </div>
    );

  return (
    <div>
      <PageHeader
        title={editId ? "Edit service job" : "New service job"}
        sub="Log the device, the fault and the estimate. Parts and charges are added on the job page."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <section className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-2">
            <F label="Branch">
              <select className={selectCls} value={br} onChange={(e) => setBranch(e.target.value)}>
                {branches.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </F>
            <F label="Customer">
              <select
                className={selectCls}
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
              >
                <option value="">Walk-in / no customer</option>
                {customers.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.mobile}
                  </option>
                ))}
              </select>
            </F>
          </section>

          <section className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-2">
            <F label="Device type">
              <Input
                value={deviceType}
                onChange={(e) => setDeviceType(e.target.value)}
                placeholder="Phone, laptop, tablet…"
              />
            </F>
            <F label="Brand">
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
            </F>
            <F label="Model">
              <Input value={model} onChange={(e) => setModel(e.target.value)} />
            </F>
            <F label="Serial / IMEI">
              <Input value={serial} onChange={(e) => setSerial(e.target.value)} />
            </F>
            <F label="Reported problem" className="sm:col-span-2">
              <Textarea
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
                placeholder="What the customer says is wrong…"
              />
            </F>
          </section>

          <section className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-3">
            <F label="Assigned to">
              <Input
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                placeholder="Technician name"
              />
            </F>
            <F label="Estimated delivery">
              <Input
                type="date"
                value={estimatedDelivery}
                onChange={(e) => setEstimatedDelivery(e.target.value)}
              />
            </F>
            <F label="Estimated cost">
              <Input
                type="number"
                step="0.01"
                value={estimatedCost}
                onChange={(e) => setEstimatedCost(e.target.value)}
              />
            </F>
            <F label="Note" className="sm:col-span-3">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
            </F>
          </section>
        </div>

        <aside className="h-fit space-y-3 rounded-lg border bg-card p-4 shadow-sm lg:sticky lg:top-24">
          {customerLabel && (
            <p className="text-sm text-muted-foreground">
              Customer: <span className="font-medium text-foreground">{customerLabel}</span>
            </p>
          )}
          <Button
            className="w-full"
            size="lg"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : editId ? "Save changes" : "Create service job"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => navigate({ to: "/app/service" })}
          >
            Cancel
          </Button>
        </aside>
      </div>
    </div>
  );
}
