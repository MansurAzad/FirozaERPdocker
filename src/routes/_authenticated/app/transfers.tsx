import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { useBranches } from "@/lib/finance";
import { bdt, friendlyError } from "@/lib/format";
import { hasAccess } from "@/lib/access-control";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, selectCls, today } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/app/transfers")({
  head: ({ matches }) => ({
    meta: [
      { title: `Stock Transfer — ${matchedCompany(matches)}` },
      { name: "description", content: "Move stock and IMEIs between branches and warehouses." },
      { property: "og:title", content: `Stock Transfer — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: "Move stock and IMEIs between branches and warehouses.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Transfers,
});

type Line = { variant_id: string; label: string; serial: boolean; qty: number; imei_ids: string[] };
const TRANSFER_ROLES = ["owner", "manager", "store_keeper", "branch_manager"];
const APPROVAL_ROLES = ["owner", "manager", "branch_manager"];

const STATUS: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft: { label: "Draft", variant: "outline" },
  pending_approval: { label: "Pending approval", variant: "default" },
  approved: { label: "Approved", variant: "secondary" },
  rejected: { label: "Rejected", variant: "destructive" },
  dispatched: { label: "In transit", variant: "secondary" },
  received: { label: "Received", variant: "secondary" },
};

function Transfers() {
  const { business, role, access } = useBusiness();
  const qc = useQueryClient();
  const branches = useBranches(business.id);
  const centralRole = ["owner", "manager", "accountant"].includes(role);
  const branchAccess = useQuery({
    enabled: !centralRole,
    queryKey: ["transfer-branch-access", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_finance_branch_access")
        .select("branch_id")
        .eq("business_id", business.id);
      if (error) throw error;
      return data;
    },
  });
  const assignedBranchIds = new Set((branchAccess.data ?? []).map((item) => item.branch_id));
  const accessibleBranches = (branches.data ?? []).filter(
    (item) => centralRole || assignedBranchIds.has(item.id),
  );
  const [tab, setTab] = useState<"dispatch" | "approvals">("dispatch");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [approval, setApproval] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState("");
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const can = TRANSFER_ROLES.includes(role) && hasAccess(access, "transfers", "create");
  const canApprove = APPROVAL_ROLES.includes(role) && hasAccess(access, "transfers", "approve");

  const stock = useQuery({
    enabled: !!from,
    queryKey: ["transfer-stock", from],
    queryFn: async () => {
      const [s, im] = await Promise.all([
        supabase
          .from("stock")
          .select(
            "variant_id, qty, product_variants(sku,ram,storage,color,products(model,brands(name),categories(is_serialized)))",
          )
          .eq("branch_id", from)
          .gt("qty", 0),
        supabase
          .from("product_imeis")
          .select("id,imei1,variant_id")
          .eq("branch_id", from)
          .eq("status", "IN_STOCK"),
      ]);
      if (s.error) throw s.error;
      if (im.error) throw im.error;
      return { stock: s.data, imeis: im.data };
    },
  });

  const list = useQuery({
    queryKey: ["transfers", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_transfers")
        .select(
          "id,transfer_no,transfer_date,status,notes,created_at,from_branch_id,to_branch_id,from:branches!stock_transfers_from_branch_id_fkey(name),to:branches!stock_transfers_to_branch_id_fkey(name),stock_transfer_items(qty)",
        )
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const pending = useQuery({
    enabled: tab === "approvals",
    queryKey: ["transfer-approvals", business.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_pending_transfer_approvals", {
        _biz: business.id,
      });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("create_stock_transfer", {
        _biz: business.id,
        _data: {
          from_branch_id: from,
          to_branch_id: to,
          transfer_date: date,
          notes,
          require_approval: approval,
          items: lines.map((l) => ({
            variant_id: l.variant_id,
            qty: l.serial ? l.imei_ids.length : l.qty,
            imei_ids: l.imei_ids,
          })),
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(approval ? "Transfer sent for approval" : "Stock dispatched");
      setLines([]);
      setNotes("");
      setApproval(false);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const receive = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("receive_stock_transfer", {
        _biz: business.id,
        _id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Stock received");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const request = useMutation({
    mutationFn: async (t: { id: string; notes: string | null }) => {
      const { error } = await supabase.rpc("request_transfer_approval", {
        _transfer_id: t.id,
        _notes: t.notes ?? "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Approval requested");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("approve_stock_transfer", {
        _transfer_id: id,
        _comments: "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transfer approved and dispatched");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const reject = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("reject_stock_transfer", {
        _transfer_id: rejectId ?? "",
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transfer rejected");
      setRejectId(null);
      setReason("");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const label = (
    v: {
      sku: string;
      ram: string | null;
      storage: string | null;
      color: string | null;
      products: { model: string; brands: { name: string } | null } | null;
    } | null,
  ) =>
    `${v?.products?.brands?.name ?? ""} ${v?.products?.model ?? ""} ${[v?.ram, v?.storage, v?.color].filter(Boolean).join("/")}`;

  function addLine() {
    const s = stock.data?.stock.find((x) => x.variant_id === pick);
    if (!s || lines.some((l) => l.variant_id === pick)) return;
    setLines([
      ...lines,
      {
        variant_id: pick,
        label: label(s.product_variants),
        serial: s.product_variants?.products?.categories?.is_serialized ?? false,
        qty: 1,
        imei_ids: [],
      },
    ]);
    setPick("");
  }
  const upd = (i: number, p: Partial<Line>) =>
    setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Transfer"
        sub="Dispatch from one location, confirm receipt at the other"
      />
      {branchAccess.error && (
        <p className="mb-4 text-sm text-destructive">{friendlyError(branchAccess.error)}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={tab === "dispatch" ? "default" : "outline"}
          onClick={() => setTab("dispatch")}
        >
          Dispatch &amp; transfers
        </Button>
        <Button
          size="sm"
          variant={tab === "approvals" ? "default" : "outline"}
          onClick={() => setTab("approvals")}
        >
          Approvals
          {(pending.data?.length ?? 0) > 0 && (
            <Badge variant="destructive" className="ml-2">
              {pending.data?.length}
            </Badge>
          )}
        </Button>
      </div>

      {tab === "approvals" ? (
        <div className="rounded-lg border bg-card">
          {pending.error ? (
            <p className="p-6 text-sm text-destructive">{friendlyError(pending.error)}</p>
          ) : (pending.data?.length ?? 0) === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              No transfers are waiting for approval.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Requested</TableHead>
                    <TableHead>From → To</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Requested by</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.data?.map((p) => (
                    <TableRow key={p.transfer_id}>
                      <TableCell className="num text-xs">
                        {(p.requested_at ?? "").slice(0, 10)}
                      </TableCell>
                      <TableCell>
                        {p.from_branch_name} → {p.to_branch_name}
                      </TableCell>
                      <TableCell className="num text-right">{p.item_count}</TableCell>
                      <TableCell className="num text-right">{bdt(p.total_value)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {p.requested_by ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {canApprove ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              disabled={approve.isPending}
                              onClick={() => approve.mutate(p.transfer_id)}
                            >
                              <Check className="mr-1 h-3.5 w-3.5" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setReason("");
                                setRejectId(p.transfer_id);
                              }}
                            >
                              <X className="mr-1 h-3.5 w-3.5" />
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Manager approval required
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      ) : (
        <>
          {can && (
            <div className="space-y-4 rounded-lg border bg-card p-5">
              <div className="grid gap-3 sm:grid-cols-4">
                <F label="From">
                  <select
                    className={selectCls}
                    value={from}
                    onChange={(e) => {
                      setFrom(e.target.value);
                      setLines([]);
                    }}
                  >
                    <option value="">— Select —</option>
                    {accessibleBranches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </F>
                <F label="To">
                  <select className={selectCls} value={to} onChange={(e) => setTo(e.target.value)}>
                    <option value="">— Select —</option>
                    {accessibleBranches
                      .filter((b) => b.id !== from)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                  </select>
                </F>
                <F label="Date">
                  <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </F>
                <F label="Note">
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                </F>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={approval} onCheckedChange={(c) => setApproval(!!c)} />
                Send for approval first (stock moves only after a manager approves)
              </label>
              {lines.length > 0 && (
                <div className="space-y-3">
                  {lines.map((l, i) => (
                    <div key={l.variant_id} className="rounded-md border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{l.label}</span>
                        <div className="flex items-center gap-2">
                          {!l.serial && (
                            <Input
                              type="number"
                              min={1}
                              className="num w-20"
                              value={l.qty}
                              onChange={(e) =>
                                upd(i, { qty: Math.max(1, Number(e.target.value) || 1) })
                              }
                            />
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Remove"
                            onClick={() => setLines(lines.filter((_, j) => j !== i))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      {l.serial && (
                        <div className="mt-2 flex flex-wrap gap-3">
                          {(stock.data?.imeis ?? [])
                            .filter((m) => m.variant_id === l.variant_id)
                            .map((m) => (
                              <label
                                key={m.id}
                                className="num flex items-center gap-1.5 font-mono text-xs"
                              >
                                <Checkbox
                                  checked={l.imei_ids.includes(m.id)}
                                  onCheckedChange={(c) =>
                                    upd(i, {
                                      imei_ids: c
                                        ? [...l.imei_ids, m.id]
                                        : l.imei_ids.filter((x) => x !== m.id),
                                    })
                                  }
                                />
                                {m.imei1}
                              </label>
                            ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <select
                  className={selectCls + " max-w-xs"}
                  value={pick}
                  onChange={(e) => setPick(e.target.value)}
                >
                  <option value="">— Add product —</option>
                  {(stock.data?.stock ?? []).map((s) => (
                    <option key={s.variant_id} value={s.variant_id}>
                      {label(s.product_variants)} ({s.qty})
                    </option>
                  ))}
                </select>
                <Button variant="outline" onClick={addLine} disabled={!pick}>
                  Add
                </Button>
              </div>
              <Button
                onClick={() => create.mutate()}
                disabled={!from || !to || !lines.length || create.isPending}
              >
                {approval ? "Send for approval" : "Dispatch transfer"}
              </Button>
            </div>
          )}
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>From → To</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list.data ?? []).map((t) => {
                  const st = STATUS[t.status] ?? { label: t.status, variant: "outline" as const };
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="num font-medium">{t.transfer_no}</TableCell>
                      <TableCell className="num">{t.transfer_date}</TableCell>
                      <TableCell>
                        {t.from?.name} → {t.to?.name}
                      </TableCell>
                      <TableCell className="num text-right">
                        {t.stock_transfer_items.reduce((s, x) => s + x.qty, 0)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {can && t.status === "draft" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={request.isPending}
                              onClick={() => request.mutate({ id: t.id, notes: t.notes })}
                            >
                              Send for approval
                            </Button>
                          )}
                          {can &&
                            t.status === "dispatched" &&
                            (centralRole || assignedBranchIds.has(t.to_branch_id)) && (
                              <Button
                                size="sm"
                                disabled={receive.isPending}
                                onClick={() => receive.mutate(t.id)}
                              >
                                Receive
                              </Button>
                            )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {list.data?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      No transfers yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <Dialog open={!!rejectId} onOpenChange={(o) => !o && setRejectId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject transfer</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              reject.mutate();
            }}
          >
            <F label="Reason *">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </F>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRejectId(null)}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={reject.isPending || !reason.trim()}>
                Reject
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
