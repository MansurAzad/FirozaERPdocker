import { matchedCompany } from "@/lib/branding";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { canUseEmi } from "@/lib/emi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { F, selectCls } from "@/components/erp/ui";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/emi/$id")({
  head: ({ matches }) => ({ meta: [{ title: `EMI Contract — ${matchedCompany(matches)}` }] }),
  component: EmiDetail,
});

function EmiDetail() {
  const { business, role } = useBusiness();
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const allowed = canUseEmi(role as any);

  const emi = useQuery({
    enabled: allowed,
    queryKey: ["emi-detail", business.id, id],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_emi").select("*, sales(*, customers(*)), emi_plans(*), branches(*)").eq("id", id).eq("business_id", business.id).single();
      if (error) throw error;
      return data;
    },
  });

  const inst = useQuery({
    enabled: allowed,
    queryKey: ["emi-inst", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("emi_installments").select("*").eq("emi_id", id).eq("business_id", business.id).order("installment_no");
      if (error) throw error;
      return data;
    },
  });

  const pays = useQuery({
    enabled: allowed,
    queryKey: ["emi-pays", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("emi_payments").select("*").eq("emi_id", id).eq("business_id", business.id).order("paid_on");
      if (error) throw error;
      return data;
    },
  });

  const [acc, setAcc] = useState("");
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0,10));
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");

  const accounts = useQuery({
    queryKey: ["money_accs", business.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("money_accounts").select("*").eq("business_id", business.id).eq("status", "active");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (accounts.data && accounts.data.length > 0 && !acc) {
      setAcc(accounts.data[0].id);
    }
  }, [accounts.data]);

  const recv = useMutation({
    mutationFn: async () => {
      if (!emi.data?.id) throw new Error("No EMI");
      const a = Number(amt||0);
      if (a <= 0) throw new Error("Enter amount");
      const { error } = await (supabase as any).rpc("receive_emi_payment", {
        _biz: business.id, _emi: emi.data.id, _amount: a, _account: acc||accounts.data?.[0]?.id,
        _date: date, _method: method, _txn_ref: null, _note: note, _installment: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAmt("");
      setNote("");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (!allowed) {
    return <div><PageHeader title="EMI Contract" /><p className="text-sm text-destructive">No permission.</p></div>;
  }

  if (emi.isLoading) return <div>Loading...</div>;
  if (emi.error) return <div className="text-destructive">{friendlyError(emi.error)}</div>;

  const e: any = emi.data;

  return (
    <div className="space-y-4">
      <PageHeader title={`EMI ${e.emi_no}`} sub={`Status: ${e.status} · ${e.sales?.customers?.name || "-"} · ${bdt(e.total_amount)}`} />
      <section className="grid gap-2 rounded-lg border bg-card p-4 text-sm sm:grid-cols-4">
        <div>Sale: <a href={`/app/sales/${e.sale_id}`}>{e.sales?.invoice_no}</a></div>
        <div>Plan: {e.emi_plans?.name}</div>
        <div>Tenure: {e.tenure_months} months · Due day {e.due_day}</div>
        <div>Branch: {e.branches?.name}</div>
        <div>Downpayment: {bdt(e.downpayment)}</div>
        <div>Financed: {bdt(e.financed_amount)}</div>
        <div>Interest: {bdt(e.interest_amount)}</div>
        <div>Processing: {bdt(e.processing_fee)}</div>
        <div>Settled: {bdt(e.settled_amount)} · Waived: {bdt(e.waived_amount)}</div>
        <div>Monthly: {bdt(e.monthly_amount)}</div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-2 font-semibold">Installments</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground"><tr><th>No</th><th>Due</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead>
            <tbody>
              {(inst.data||[]).map((r:any) => (
                <tr key={r.id}><td>{r.installment_no}</td><td className="num">{r.due_date}</td><td className="num">{bdt(r.amount)}</td><td className="num">{bdt(r.paid_amount)}</td><td className="num">{bdt(r.balance)}</td><td>{r.status}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {e.status==='active' && (
        <section className="rounded-lg border bg-card p-4">
          <div className="mb-2 font-semibold">Receive installment payment</div>
          <div className="grid gap-3 sm:grid-cols-4">
            <F label="Amount"><Input type="number" step="0.01" value={amt} onChange={(e)=>setAmt(e.target.value)} /></F>
            <F label="Date"><Input type="date" value={date} onChange={(e)=>setDate(e.target.value)} /></F>
            <F label="Account">
              <select className={selectCls} value={acc} onChange={(e)=>setAcc(e.target.value)}>
                {(accounts.data || []).map((a:any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </F>
            <F label="Method">
              <select className={selectCls} value={method} onChange={(e)=>setMethod(e.target.value)}>
                {["cash","bank","bkash","nagad","rocket","card","cheque","other"].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </F>
          </div>
          <div className="mt-3"><Button onClick={()=>recv.mutate()} disabled={recv.isPending}>Receive Payment</Button></div>
        </section>
      )}
    </div>
  );
}
