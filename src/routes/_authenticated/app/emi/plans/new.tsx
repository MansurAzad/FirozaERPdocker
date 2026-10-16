import { matchedCompany } from "@/lib/branding";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, selectCls } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/app/emi/plans/new")({
  head: ({ matches }) => ({ meta: [{ title: `New EMI Plan — ${matchedCompany(matches)}` }] }),
  component: PlanNew,
});

function PlanNew() {
  const { business, role } = useBusiness();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [tenure, setTenure] = useState("12");
  const [rate, setRate] = useState("0");
  const [dp, setDp] = useState("0");
  const [fee, setFee] = useState("0");
  const [status, setStatus] = useState("active");

  const can =
    role === "owner" || role === "manager" || role === "accountant" || role === "purchase_officer";

  const save = useMutation({
    mutationFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("save_emi_plan", {
        _biz: business.id,
        _data: {
          name,
          tenure_months: Number(tenure),
          interest_rate: Number(rate),
          downpayment_percent: Number(dp),
          processing_fee: Number(fee),
          status,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Plan saved");
      navigate({ to: "/app/emi" });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (!can)
    return (
      <div>
        <PageHeader title="New EMI Plan" />
        <p className="text-sm text-destructive">No permission.</p>
      </div>
    );

  return (
    <div className="max-w-xl">
      <PageHeader title="New EMI Plan" />
      <div className="grid gap-3 rounded-lg border bg-card p-4">
        <F label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </F>
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="Tenure (months)">
            <Input type="number" value={tenure} onChange={(e) => setTenure(e.target.value)} />
          </F>
          <F label="Interest %">
            <Input
              type="number"
              step="0.01"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </F>
          <F label="Downpayment %">
            <Input type="number" step="0.01" value={dp} onChange={(e) => setDp(e.target.value)} />
          </F>
          <F label="Processing fee">
            <Input type="number" step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} />
          </F>
        </div>
        <F label="Status">
          <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </F>
        <div className="flex gap-2">
          <Button disabled={save.isPending || !name} onClick={() => save.mutate()}>
            Save
          </Button>
          <Button variant="outline" onClick={() => navigate({ to: "/app/emi" })}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
