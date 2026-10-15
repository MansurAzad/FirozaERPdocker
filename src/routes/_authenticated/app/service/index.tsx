import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Wrench } from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/app/service/")({
  head: ({ matches }) => ({ meta: [{ title: `Service Jobs — ${matchedCompany(matches)}` }] }),
  component: ServiceIndex,
});

function ServiceIndex() {
  const { business } = useBusiness();
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");

  const jobs = useQuery({
    queryKey: ["service-jobs", business.id, status],
    queryFn: async () => {
      let query = supabase
        .from("service_jobs")
        .select(
          "id,job_no,device_type,brand,model,customer_id,customers(name,mobile),status,received_at,estimated_cost,total_cost,balance,assigned_to",
        )
        .eq("business_id", business.id)
        .order("received_at", { ascending: false })
        .limit(500);
      if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const rows = (jobs.data ?? []).filter(
    (r) =>
      !q ||
      [r.job_no, r.brand, r.model, r.customers?.name, r.customers?.mobile].some((x) =>
        (x ?? "").toLowerCase().includes(q.toLowerCase()),
      ),
  );

  return (
    <div>
      <PageHeader
        title="Service Jobs"
        actions={
          <Button asChild>
            <Link to="/app/service/new">
              <Plus className="mr-1 h-4 w-4" />
              New Job
            </Link>
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <select
          className={selectCls + " max-w-[12rem]"}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="all">All status</option>
          <option value="received">Received</option>
          <option value="in_progress">In Progress</option>
          <option value="waiting_parts">Waiting Parts</option>
          <option value="ready_for_pickup">Ready for Pickup</option>
          <option value="completed">Completed</option>
          <option value="returned">Returned</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search job/device/customer…"
          className="max-w-xs"
        />
      </div>
      <div className="rounded-lg border bg-card">
        {jobs.error ? (
          <p className="p-4 text-sm text-destructive">{friendlyError(jobs.error)}</p>
        ) : !rows.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No service jobs.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job No</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Est.</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        to="/app/service/$id"
                        params={{ id: r.id }}
                        className="text-primary hover:underline"
                      >
                        {r.job_no}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {r.brand} {r.model} {r.device_type ? `(${r.device_type})` : ""}
                    </TableCell>
                    <TableCell>{r.customers?.name ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.status}</Badge>
                    </TableCell>
                    <TableCell className="num">{String(r.received_at).slice(0, 10)}</TableCell>
                    <TableCell className="num text-right">{bdt(r.estimated_cost)}</TableCell>
                    <TableCell className="num text-right">{bdt(r.total_cost)}</TableCell>
                    <TableCell className="num text-right">{bdt(r.balance)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
