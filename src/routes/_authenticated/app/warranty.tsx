import { matchedCompany } from "@/lib/branding";
import { z } from "zod";
import { canCloseWarrantyWithoutStock } from "@/lib/guardian/safety";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { F } from "@/components/erp/ui";
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

export const Route = createFileRoute("/_authenticated/app/warranty")({
  validateSearch: z.object({ imei: z.string().optional() }),
  head: ({ matches }) => ({
    meta: [
      { title: `Warranty Claims — ${matchedCompany(matches)}` },
      { name: "description", content: "Validate warranty by IMEI and track service claims." },
      { property: "og:title", content: `Warranty Claims — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: "IMEI warranty verification and safe service claim tracking.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Warranty,
});

const STATUS: Record<string, string> = {
  open: "Open",
  in_service: "In service",
  replaced: "Replaced",
  resolved: "Resolved",
  rejected: "Rejected",
};

function Warranty() {
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const [imei, setImei] = useState(Route.useSearch().imei ?? "");
  const [issue, setIssue] = useState("");
  const [note, setNote] = useState<Record<string, string>>({});
  const canUpdate = ["owner", "manager", "branch_manager", "store_keeper"].includes(role);

  const list = useQuery({
    queryKey: ["claims", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warranty_claims")
        .select(
          "*, customers(name,mobile), product_imeis(imei1, product_variants(products(model,brands(name))))",
        )
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("create_warranty_claim", {
        _biz: business.id,
        _imei: imei,
        _issue: issue,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Warranty valid — claim opened");
      setImei("");
      setIssue("");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const update = useMutation({
    mutationFn: async (v: { id: string; status: string }) => {
      const { error } = await supabase.rpc("update_warranty_claim", {
        _biz: business.id,
        _id: v.id,
        _status: v.status,
        _resolution: note[v.id] ?? "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Claim updated");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warranty Claims"
        sub="Scan the IMEI — warranty is checked against the sale date automatically"
      />
      <div className="grid gap-3 rounded-lg border bg-card p-5 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
        <F label="IMEI">
          <Input
            className="num font-mono"
            value={imei}
            onChange={(e) => setImei(e.target.value)}
            placeholder="Scan or type IMEI"
          />
        </F>
        <F label="Problem">
          <Input
            value={issue}
            onChange={(e) => setIssue(e.target.value)}
            placeholder="Display not working, battery…"
          />
        </F>
        <Button onClick={() => create.mutate()} disabled={!imei || !issue || create.isPending}>
          Open claim
        </Button>
      </div>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Claim</TableHead>
              <TableHead>Device</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Issue</TableHead>
              <TableHead>Warranty till</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(list.data ?? []).map((c) => {
              const open = c.status === "open" || c.status === "in_service";
              return (
                <TableRow key={c.id} className="align-top">
                  <TableCell className="num">
                    <div className="font-medium">{c.claim_no}</div>
                    <div className="text-xs text-muted-foreground">{c.claim_date}</div>
                  </TableCell>
                  <TableCell>
                    <div>
                      {c.product_imeis?.product_variants?.products?.brands?.name}{" "}
                      {c.product_imeis?.product_variants?.products?.model}
                    </div>
                    <div className="num font-mono text-xs text-muted-foreground">
                      {c.product_imeis?.imei1}
                    </div>
                  </TableCell>
                  <TableCell>
                    {c.customers?.name ?? "Walk-in"}
                    <div className="num text-xs text-muted-foreground">{c.customers?.mobile}</div>
                  </TableCell>
                  <TableCell className="max-w-56">
                    {c.issue}
                    {c.resolution && (
                      <div className="text-xs text-muted-foreground">→ {c.resolution}</div>
                    )}
                  </TableCell>
                  <TableCell className="num">{c.warranty_end}</TableCell>
                  <TableCell>
                    <Badge variant={open ? "outline" : "secondary"}>{STATUS[c.status]}</Badge>
                  </TableCell>
                  <TableCell className="min-w-64">
                    {canUpdate && open && (
                      <div className="space-y-1.5">
                        <Input
                          className="h-8"
                          placeholder="Resolution note"
                          value={note[c.id] ?? ""}
                          onChange={(e) => setNote({ ...note, [c.id]: e.target.value })}
                        />
                        <div className="flex flex-wrap gap-1">
                          {c.status === "open" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => update.mutate({ id: c.id, status: "in_service" })}
                            >
                              Send to service
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => update.mutate({ id: c.id, status: "resolved" })}
                          >
                            Resolved
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canCloseWarrantyWithoutStock("replaced")}
                            title="Replacement needs an approved linked IMEI and stock transaction"
                          >
                            Replaced
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => update.mutate({ id: c.id, status: "rejected" })}
                          >
                            Reject
                          </Button>
                        </div>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {list.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                  No claims yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
