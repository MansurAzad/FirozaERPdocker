import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { useMembers, useSaleLines } from "@/lib/reports";
import { BD_MOBILE, ROLE_LABELS, bdt, friendlyError } from "@/lib/format";
import { EntityManager, PageHeader } from "@/components/erp/EntityManager";
import { F, Stat, monthStart, selectCls, today } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

export const Route = createFileRoute("/_authenticated/app/commission")({
  head: ({ matches }) => ({
    meta: [
      { title: `Commission Management — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Salesman profiles, commission rules, earnings, payments and reports in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Commission — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Salesman commission management in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Commission,
});

/** payment_method check on commission_transactions allows these only. */
const COMMISSION_METHODS = ["cash", "bkash", "nagad", "rocket", "card", "cheque"] as const;
const TABS = [
  ["rules", "Rules & accrual"],
  ["payments", "Payments"],
  ["report", "Report"],
  ["salesmen", "Salesmen"],
] as const;
type Tab = (typeof TABS)[number][0];

function Commission() {
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const canEdit = role === "owner" || role === "manager" || role === "accountant";
  const canManageRules = role === "owner" || role === "manager";
  const [tab, setTab] = useState<Tab>("rules");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [edit, setEdit] = useState<Record<string, { percent: string; per_device: string }>>({});
  const [pay, setPay] = useState<{ id: string; name: string; pending: number } | null>(null);
  const [pf, setPf] = useState<Record<string, string>>({});

  const members = useMembers(business.id);
  const lines = useSaleLines(business.id, from, to);

  const salesmen = useQuery({
    queryKey: ["salesmen", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("salesmen")
        .select("*")
        .eq("business_id", business.id)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const rules = useQuery({
    queryKey: ["commission_rules", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("commission_rules")
        .select("*")
        .eq("business_id", business.id);
      if (error) throw error;
      return data;
    },
  });

  const commissions = useQuery({
    queryKey: ["commission_transactions", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("commission_transactions")
        .select("*")
        .eq("business_id", business.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const memberName = (userId: string | null) =>
    userId ? (members.data?.find((m) => m.user_id === userId)?.display_name ?? "Member") : "—";
  const salesmanName = (id: string) => salesmen.data?.find((s) => s.id === id)?.name ?? "—";

  const activeEntries = useMemo(
    () => (commissions.data ?? []).filter((c) => c.status !== "cancelled"),
    [commissions.data],
  );
  const periodEntries = useMemo(
    () =>
      activeEntries.filter((c) => {
        const d = c.created_at.slice(0, 10);
        return d >= from && d <= to;
      }),
    [activeEntries, from, to],
  );

  const rows = useMemo(() => {
    return (salesmen.data ?? []).map((s) => {
      const myLines = (lines.data ?? []).filter((l) => s.user_id && l.salesman === s.user_id);
      const revenue = myLines.reduce((a, l) => a + l.revenue, 0);
      const devices = myLines.reduce((a, l) => a + l.devices, 0);
      const invoices = new Set(myLines.map((l) => l.saleId)).size;
      const entries = periodEntries.filter((c) => c.salesman_id === s.id);
      const rule = (rules.data ?? []).find((r) => r.user_id === s.user_id);
      const percent = Number(rule?.percent ?? 0);
      const perDevice = Number(rule?.per_device ?? 0);
      return {
        s,
        revenue,
        devices,
        invoices,
        rule,
        percent,
        perDevice,
        preview: Math.round((revenue * percent) / 100 + devices * perDevice),
        accrued: entries.reduce((a, c) => a + Number(c.amount), 0),
        paid: entries.reduce((a, c) => a + Number(c.paid_amount), 0),
        pending: entries.reduce((a, c) => a + Number(c.pending_amount), 0),
        count: entries.length,
      };
    });
  }, [salesmen.data, lines.data, periodEntries, rules.data]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          revenue: a.revenue + r.revenue,
          devices: a.devices + r.devices,
          accrued: a.accrued + r.accrued,
          paid: a.paid + r.paid,
          pending: a.pending + r.pending,
        }),
        { revenue: 0, devices: 0, accrued: 0, paid: 0, pending: 0 },
      ),
    [rows],
  );

  const saveRule = useMutation({
    mutationFn: async (userId: string) => {
      const e = edit[userId]!;
      const { error } = await supabase.from("commission_rules").upsert(
        {
          business_id: business.id,
          user_id: userId,
          percent: Number(e.percent) || 0,
          per_device: Number(e.per_device) || 0,
        },
        { onConflict: "business_id,user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Commission rule saved");
      qc.invalidateQueries({ queryKey: ["commission_rules"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const accrue = useMutation({
    mutationFn: async (ids: string[]) => {
      let added = 0;
      for (const id of ids) {
        const { data, error } = await supabase.rpc("accrue_salesman_commission", {
          _biz: business.id,
          _salesman_id: id,
          _from: from,
          _to: to,
        });
        if (error) throw error;
        added += Number(data ?? 0);
      }
      return added;
    },
    onSuccess: (added) => {
      toast.success(added ? `${added} commission entry(ies) added` : "Nothing new to accrue");
      qc.invalidateQueries({ queryKey: ["commission_transactions"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const payNow = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("pay_salesman_commission", {
        _biz: business.id,
        _commission_id: pay!.id,
        _amount: Number(pf["amount"] || 0),
        _payment_method: pf["method"] ?? "cash",
        _transaction_ref: pf["ref"] ?? "",
        _note: pf["note"] ?? "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Commission paid");
      setPay(null);
      qc.invalidateQueries({ queryKey: ["commission_transactions"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const pendingList = activeEntries.filter((c) => Number(c.pending_amount) > 0);
  const memberOptions = [
    { value: "", label: "— not linked —" },
    ...(members.data ?? []).map((m) => ({
      value: m.user_id,
      label: `${m.display_name ?? "Member"} (${ROLE_LABELS[m.role] ?? m.role})`,
    })),
  ];

  return (
    <div>
      <PageHeader
        title="Salesman commission"
        sub="Calculate commission from each salesman's sales, record payouts and review the report."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map(([v, label]) => (
          <Button
            key={v}
            size="sm"
            variant={tab === v ? "default" : "outline"}
            onClick={() => setTab(v)}
          >
            {label}
          </Button>
        ))}
      </div>

      {tab !== "salesmen" && (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <F label="From">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </F>
            <F label="To">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </F>
          </div>
          <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4">
            <Stat label="Net sales" value={totals.revenue} note={`${totals.devices} phones`} />
            <Stat label="Commission accrued" value={totals.accrued} />
            <Stat label="Paid" value={totals.paid} tone="pos" />
            <Stat
              label="Pending"
              value={totals.pending}
              tone={totals.pending > 0 ? "neg" : undefined}
            />
          </div>
        </>
      )}

      {tab === "salesmen" && (
        <EntityManager
          table="salesmen"
          title="Salesmen"
          sub="Sales staff profiles. Link a team member to attribute their invoices and commission."
          canWrite={canEdit}
          canDelete={canEdit}
          searchKeys={["name", "mobile", "email"]}
          orderBy="name"
          fields={[
            { key: "name", label: "Name", required: true },
            {
              key: "mobile",
              label: "Mobile",
              pattern: BD_MOBILE,
              patternMsg: "Enter a valid Bangladesh mobile number (01XXXXXXXXX).",
              placeholder: "01XXXXXXXXX",
            },
            { key: "email", label: "Email" },
            { key: "join_date", label: "Join date", type: "date" },
            {
              key: "status",
              label: "Status",
              type: "select",
              options: [
                { value: "active", label: "Active" },
                { value: "on_leave", label: "On leave" },
                { value: "terminated", label: "Terminated" },
              ],
            },
            {
              key: "user_id",
              label: "Linked team member",
              type: "select",
              options: memberOptions,
            },
            { key: "address", label: "Address", full: true },
          ]}
          columns={[
            {
              key: "name",
              label: "Salesman",
              render: (r) => (
                <div>
                  <div className="font-medium">{r.name}</div>
                  <div className="num text-xs text-muted-foreground">{r.mobile ?? "—"}</div>
                </div>
              ),
            },
            {
              key: "user_id",
              label: "Linked member",
              render: (r) =>
                r.user_id ? (
                  memberName(r.user_id)
                ) : (
                  <span className="text-muted-foreground">Not linked</span>
                ),
            },
            {
              key: "status",
              label: "Status",
              render: (r) => (
                <Badge variant={r.status === "active" ? "secondary" : "outline"}>{r.status}</Badge>
              ),
            },
            { key: "join_date", label: "Joined", className: "num" },
          ]}
        />
      )}

      {tab === "rules" && (
        <div className="rounded-lg border bg-card">
          {lines.error && (
            <p className="p-4 text-sm text-destructive">{friendlyError(lines.error)}</p>
          )}
          {canEdit && (
            <div className="border-b p-3">
              <Button
                size="sm"
                disabled={accrue.isPending}
                onClick={() =>
                  accrue.mutate(
                    rows
                      .filter((r) => r.s.user_id && r.s.status === "active" && r.rule)
                      .map((r) => r.s.id),
                  )
                }
              >
                Calculate for all linked salesmen
              </Button>
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Salesman</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                  <TableHead className="text-right">Phones</TableHead>
                  <TableHead className="text-right">Net sales</TableHead>
                  <TableHead>Rule</TableHead>
                  <TableHead className="text-right">Accrued</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="p-8 text-center text-sm text-muted-foreground"
                    >
                      No salesmen yet. Add one from the Salesmen tab.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => {
                    const e = r.s.user_id ? edit[r.s.user_id] : undefined;
                    return (
                      <TableRow key={r.s.id}>
                        <TableCell>
                          <div className="font-medium">{r.s.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.s.user_id ? memberName(r.s.user_id) : "Link a member to calculate"}
                          </div>
                        </TableCell>
                        <TableCell className="num text-right">{r.invoices}</TableCell>
                        <TableCell className="num text-right">{r.devices}</TableCell>
                        <TableCell className="num text-right">{bdt(r.revenue)}</TableCell>
                        <TableCell>
                          {!r.s.user_id ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : canManageRules && e ? (
                            <div className="flex items-center gap-1">
                              <Input
                                className="num h-8 w-16"
                                value={e.percent}
                                onChange={(ev) =>
                                  setEdit({
                                    ...edit,
                                    [r.s.user_id!]: { ...e, percent: ev.target.value },
                                  })
                                }
                              />
                              <span className="text-xs">%</span>
                              <Input
                                className="num h-8 w-20"
                                value={e.per_device}
                                onChange={(ev) =>
                                  setEdit({
                                    ...edit,
                                    [r.s.user_id!]: { ...e, per_device: ev.target.value },
                                  })
                                }
                              />
                              <span className="text-xs">/phone</span>
                              <Button
                                size="sm"
                                disabled={saveRule.isPending}
                                onClick={() => saveRule.mutate(r.s.user_id!)}
                              >
                                Save
                              </Button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={!canManageRules}
                              onClick={() =>
                                setEdit({
                                  ...edit,
                                  [r.s.user_id!]: {
                                    percent: String(r.percent),
                                    per_device: String(r.perDevice),
                                  },
                                })
                              }
                            >
                              {r.percent}% + {bdt(r.perDevice)}/phone
                            </button>
                          )}
                        </TableCell>
                        <TableCell className="num text-right font-semibold">
                          {bdt(r.accrued)}
                        </TableCell>
                        <TableCell className="num text-right">{bdt(r.pending)}</TableCell>
                        <TableCell className="text-right">
                          {canEdit && r.s.user_id && r.rule && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={accrue.isPending}
                              onClick={() => accrue.mutate([r.s.id])}
                            >
                              Calculate
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <p className="border-t p-3 text-xs text-muted-foreground">
            You can also preview commission per salesman in the Report tab before calculating.
          </p>
        </div>
      )}

      {tab === "payments" && (
        <div className="rounded-lg border bg-card">
          {commissions.error ? (
            <p className="p-6 text-sm text-destructive">{friendlyError(commissions.error)}</p>
          ) : pendingList.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              No pending commission. Calculate sales first.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Salesman</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingList.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="num">{c.created_at.slice(0, 10)}</TableCell>
                      <TableCell>{salesmanName(c.salesman_id)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.reference_type} · {c.reference_id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="num text-right">{bdt(c.amount)}</TableCell>
                      <TableCell className="num text-right">{bdt(c.paid_amount)}</TableCell>
                      <TableCell className="num text-right font-semibold">
                        {bdt(c.pending_amount)}
                      </TableCell>
                      <TableCell className="text-right">
                        {canEdit && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setPf({ amount: String(c.pending_amount), method: "cash" });
                              setPay({
                                id: c.id,
                                name: salesmanName(c.salesman_id),
                                pending: Number(c.pending_amount),
                              });
                            }}
                          >
                            Pay
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {tab === "report" && (
        <div className="rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Salesman</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                  <TableHead className="text-right">Phones</TableHead>
                  <TableHead className="text-right">Net sales</TableHead>
                  <TableHead className="text-right">Preview commission</TableHead>
                  <TableHead className="text-right">Accrued</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Pending</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.s.id}>
                    <TableCell className="font-medium">{r.s.name}</TableCell>
                    <TableCell className="num text-right">{r.invoices}</TableCell>
                    <TableCell className="num text-right">{r.devices}</TableCell>
                    <TableCell className="num text-right">{bdt(r.revenue)}</TableCell>
                    <TableCell className="num text-right text-muted-foreground">
                      {bdt(r.preview)}
                    </TableCell>
                    <TableCell className="num text-right">{bdt(r.accrued)}</TableCell>
                    <TableCell className="num text-right">{bdt(r.paid)}</TableCell>
                    <TableCell className="num text-right font-semibold">{bdt(r.pending)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t p-3 text-sm">
            <span className="text-muted-foreground">
              {from} → {to}
            </span>
            <div className="num flex flex-wrap gap-4">
              <span>Sales {bdt(totals.revenue)}</span>
              <span>Accrued {bdt(totals.accrued)}</span>
              <span>Paid {bdt(totals.paid)}</span>
              <span className="font-semibold">Pending {bdt(totals.pending)}</span>
            </div>
          </div>
        </div>
      )}

      <Dialog open={!!pay} onOpenChange={(o) => !o && setPay(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Pay {pay?.name} — pending {bdt(pay?.pending)}
            </DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              payNow.mutate();
            }}
          >
            <F label="Amount (৳)">
              <Input
                type="number"
                step="0.01"
                value={pf["amount"] ?? ""}
                onChange={(e) => setPf({ ...pf, amount: e.target.value })}
              />
            </F>
            <F label="Method">
              <select
                className={selectCls}
                value={pf["method"] ?? "cash"}
                onChange={(e) => setPf({ ...pf, method: e.target.value })}
              >
                {COMMISSION_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </F>
            <F label="Transaction ID">
              <Input
                value={pf["ref"] ?? ""}
                onChange={(e) => setPf({ ...pf, ref: e.target.value })}
              />
            </F>
            <F label="Note">
              <Input
                value={pf["note"] ?? ""}
                onChange={(e) => setPf({ ...pf, note: e.target.value })}
              />
            </F>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setPay(null)}>
                Cancel
              </Button>
              <Button disabled={payNow.isPending}>Record payment</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
