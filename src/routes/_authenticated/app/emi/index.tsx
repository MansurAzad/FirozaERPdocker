import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { selectCls } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type EmiPlan = {
  id: string;
  name: string;
  tenure_months: number;
  interest_rate: number;
  downpayment_percent: number;
  processing_fee: number;
  status: string;
};

type EmiInstallment = {
  emi_id: string;
  balance?: number | null;
};

type EmiContract = {
  id: string;
  emi_no?: string | null;
  total_amount?: number | null;
  downpayment?: number | null;
  status?: string | null;
  sales?: {
    customers?: {
      name?: string | null;
      mobile?: string | null;
      invoice_no?: string | null;
    } | null;
    invoice_no?: string | null;
  } | null;
  branches?: {
    name?: string | null;
  } | null;
};

type EmiSummary = {
  active_contracts?: number;
  financed_total?: number;
  collected_total?: number;
  outstanding_total?: number;
};

export const Route = createFileRoute("/_authenticated/app/emi/")({
  head: ({ matches }) => ({
    meta: [
      { title: `EMI & Installments — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Manage EMI plans and installment sales in ${matchedCompany(matches)}.`,
      },
    ],
  }),
  component: EmiIndex,
});

function EmiIndex() {
  const { business } = useBusiness();
  const [tab, setTab] = useState<"plans" | "sales">("sales");
  const [q, setQ] = useState("");

  function instAgg(emi: EmiContract, list: EmiInstallment[]) {
    const l = list.filter((x) => x.emi_id === emi.id);
    const out = l.reduce((s, x) => s + Number(x.balance || 0), 0);
    return { out };
  }

  const plans = useQuery({
    queryKey: ["emi-plans", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("emi_plans")
        .select("*")
        .eq("business_id", business.id)
        .order("name");
      if (error) throw error;
      return data as EmiPlan[];
    },
  });

  const contracts = useQuery({
    queryKey: ["emi-contracts", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_emi")
        .select("*, sales(customers(name,mobile,invoice_no)), branches(name)")
        .eq("business_id", business.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as EmiContract[];
    },
  });
  const inst = useQuery({
    queryKey: ["emi-inst-all", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("emi_installments")
        .select("*")
        .eq("business_id", business.id);
      if (error) throw error;
      return data as EmiInstallment[];
    },
  });
  const sum = useQuery({
    queryKey: ["emi-summary", business.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("emi_summary", { _biz: business.id });
      if (error) throw error;
      return data as EmiSummary;
    },
  });
  const [branch] = useState("");

  return (
    <div>
      <PageHeader
        title="EMI & Installments"
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/app/emi/new">
                <Plus className="mr-1 h-4 w-4" />
                New Installment Sale
              </Link>
            </Button>
            <Button asChild>
              <Link to="/app/emi/plans/new">
                <Plus className="mr-1 h-4 w-4" />
                New EMI plan
              </Link>
            </Button>
          </div>
        }
      />
      <div className="mb-4 grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-4 text-sm">
        <div>Active contracts: {sum.data?.active_contracts ?? 0}</div>
        <div>Financed total: {bdt(sum.data?.financed_total ?? 0)}</div>
        <div>Collected: {bdt(sum.data?.collected_total ?? 0)}</div>
        <div>Outstanding: {bdt(sum.data?.outstanding_total ?? 0)}</div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <select
          className={selectCls + " max-w-[12rem]"}
          value={tab}
          onChange={(e) => setTab(e.target.value as "plans" | "sales")}
        >
          <option value="sales">EMI Contracts</option>
          <option value="plans">EMI Plans</option>
        </select>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
          className="max-w-xs"
        />
      </div>
      {tab === "plans" ? (
        <div className="rounded-lg border bg-card">
          {plans.error ? (
            <p className="p-4 text-sm text-destructive">{friendlyError(plans.error)}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Tenure</TableHead>
                    <TableHead>Interest %</TableHead>
                    <TableHead>DP %</TableHead>
                    <TableHead>Processing</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(plans.data ?? [])
                    .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
                    .map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{p.name}</TableCell>
                        <TableCell>{p.tenure_months}</TableCell>
                        <TableCell>{p.interest_rate}%</TableCell>
                        <TableCell>{p.downpayment_percent}%</TableCell>
                        <TableCell>{bdt(p.processing_fee)}</TableCell>
                        <TableCell>
                          <Badge variant={p.status === "active" ? "default" : "secondary"}>
                            {p.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>EMI No</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Downpayment</TableHead>
                  <TableHead>Outstanding</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>View</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(contracts.data ?? []).map((c: EmiContract) => (
                  <TableRow key={c.id}>
                    <TableCell className="num">{c.emi_no}</TableCell>
                    <TableCell>{c.sales?.customers?.name || "-"}</TableCell>
                    <TableCell>{c.branches?.name || "-"}</TableCell>
                    <TableCell className="num">{bdt(c.total_amount)}</TableCell>
                    <TableCell className="num">{bdt(c.downpayment)}</TableCell>
                    <TableCell className="num">
                      {bdt(instAgg(c, inst.data || [])?.out || 0)}
                    </TableCell>
                    <TableCell>
                      <Badge>{c.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" asChild>
                        <Link to="/app/emi/$id" params={{ id: c.id }}>
                          Open
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
