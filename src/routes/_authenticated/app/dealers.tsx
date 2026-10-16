import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { useMoneyAccounts } from "@/lib/finance";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, METHODS, Stat, methodLabel, selectCls, today, type Method } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export const Route = createFileRoute("/_authenticated/app/dealers")({
  head: ({ matches }) => ({
    meta: [
      { title: `Dealers — ${matchedCompany(matches)}` },
      {
        title: `Dealer & Sub-dealer Management — ${matchedCompany(matches)}`,
        description: "Manage dealer and sub-dealer credit limits, outstanding dues and payments.",
      },
      {
        property: "og:description",
        content: "Dealer credit limits, outstanding dues and collections.",
      },
      { property: "og:type", content: "website" },
      { property: "twitter:card", content: "summary" },
    ],
  }),
  component: Dealers,
});

const DEALER_TYPES = ["wholesale_dealer", "sub_dealer", "dealer"] as const;
const TYPE_LABEL: Record<string, string> = {
  wholesale_dealer: "Wholesale dealer",
  sub_dealer: "Sub dealer",
  dealer: "Dealer",
};
const DEALER_STATUS = [
  { value: "active", label: "Active" },
  { value: "blocked", label: "Blocked" },
  { value: "suspended", label: "Suspended" },
];

function Dealers() {
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const canEdit = role === "owner" || role === "manager" || role === "accountant";
  const canCollect = canEdit || role === "salesman" || role === "branch_manager";
  const accounts = useMoneyAccounts(business.id);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"dealers" | "payments">("dealers");
  const [credit, setCredit] = useState<{ id: string; name: string } | null>(null);
  const [selectedDealer, setSelectedDealer] = useState<(typeof rows)[number] | null>(null);
  const [cf, setCf] = useState<Record<string, string>>({});
  const [pay, setPay] = useState<{ id: string; name: string; due: number } | null>(null);
  const [pf, setPf] = useState<Record<string, string>>({});

  const balances = useQuery({
    queryKey: ["dealer-balances", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_balances")
        .select("*")
        .eq("business_id", business.id)
        .in("type", [...DEALER_TYPES])
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const credits = useQuery({
    queryKey: ["dealer-credit", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dealer_credit")
        .select("*")
        .eq("business_id", business.id);
      if (error) throw error;
      return data;
    },
  });
  const creditRows = credits.data;

  const dealerIds = useMemo(
    () => (balances.data ?? []).map((b) => b.customer_id).filter((x): x is string => !!x),
    [balances.data],
  );

  const payments = useQuery({
    queryKey: ["dealer-payments", business.id, dealerIds.length],
    enabled: dealerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_payments")
        .select("id, amount, method, txn_ref, paid_on, notes, customer_id")
        .eq("business_id", business.id)
        .in("customer_id", dealerIds)
        .order("paid_on", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data;
    },
  });

  const creditByCustomer = useMemo(() => {
    const m = new Map<string, NonNullable<typeof creditRows>[number]>();
    for (const c of creditRows ?? []) m.set(c.customer_id, c);
    return m;
  }, [creditRows]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (balances.data ?? [])
      .map((b) => {
        const c = b.customer_id ? creditByCustomer.get(b.customer_id) : undefined;
        const limit = Number(b.credit_limit ?? 0);
        const due = Number(b.current_due ?? 0);
        return {
          ...b,
          status: c?.status ?? "active",
          available: limit - due,
          over: limit > 0 && due > limit,
          hasCredit: !!c,
        };
      })
      .filter((r) =>
        !s
          ? true
          : [r.name, r.business_name, r.mobile].some((x) => (x ?? "").toLowerCase().includes(s)),
      );
  }, [balances.data, creditByCustomer, q]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          due: a.due + Number(r.current_due ?? 0),
          limit: a.limit + Number(r.credit_limit ?? 0),
          over: a.over + (r.over ? 1 : 0),
        }),
        { due: 0, limit: 0, over: 0 },
      ),
    [rows],
  );

  const nameOf = (id: string | null) =>
    (balances.data ?? []).find((b) => b.customer_id === id)?.name ?? "—";

  const saveCredit = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("set_dealer_credit", {
        _biz: business.id,
        _customer: credit!.id,
        _credit_limit: Number(cf["limit"] || 0),
        _payment_terms_days: Number(cf["terms"] || 0),
        _status: cf["status"] ?? "active",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dealer credit saved");
      setCredit(null);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const receive = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("receive_customer_payment", {
        _biz: business.id,
        _customer: pay!.id,
        _account: pf["account"] || accounts.data?.[0]?.id || "",
        _amount: Number(pf["amount"] || 0),
        _date: pf["date"] ?? today(),
        _method: (pf["method"] ?? "cash") as Method,
        _txn_ref: pf["ref"] ?? "",
        _note: pf["note"] ?? "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment received");
      setPay(null);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <div>
      <PageHeader
        title="Dealers & sub-dealers"
        sub="Credit limits, dues and payments for wholesale dealers and sub-dealers."
      />

      <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4">
        <Stat label="Dealers" value={rows.length} note={`${totals.over} over limit`} />
        <Stat label="Total credit limit" value={totals.limit} />
        <Stat label="Total due" value={totals.due} tone={totals.due > 0 ? "neg" : undefined} />
        <Stat label="Available credit" value={Math.max(totals.limit - totals.due, 0)} tone="pos" />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Button
          className="h-14 justify-start gap-3 text-left"
          variant={tab === "dealers" ? "default" : "outline"}
          onClick={() => setTab("dealers")}
        >
          Dealers & sub-dealers
        </Button>
        <Button
          className="h-14 justify-start gap-3 text-left"
          variant={tab === "payments" ? "default" : "outline"}
          onClick={() => setTab("payments")}
        >
          Payment history
        </Button>
      </div>

      {tab === "dealers" ? (
        <div className="rounded-lg border bg-card">
          <div className="border-b p-3">
            <Input
              placeholder="Search dealer or mobile…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="max-w-xs"
            />
          </div>
          {balances.error ? (
            <p className="p-6 text-sm text-destructive">{friendlyError(balances.error)}</p>
          ) : rows.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              No dealers yet. Add a customer with type “Wholesale Dealer” or “Sub Dealer” from
              Customers.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dealer</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Due</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.customer_id!}>
                      <TableCell>
                        <div className="font-medium">{r.name}</div>
                        <div className="num text-xs text-muted-foreground">
                          {r.mobile}
                          {r.business_name ? ` · ${r.business_name}` : ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{typeLabel(r.type)}</Badge>
                      </TableCell>
                      <TableCell
                        className={
                          "num text-right font-semibold " + (r.over ? "text-destructive" : "")
                        }
                      >
                        {bdt(r.current_due)}
                      </TableCell>
                      <TableCell
                        className={"num text-right " + (r.available < 0 ? "text-destructive" : "")}
                      >
                        {bdt(r.available)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.status === "active" ? "secondary" : "destructive"}>
                          {r.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <Button
                          size="sm"
                          onClick={() => {
                            setSelectedDealer(r);
                          }}
                        >
                          Open
                        </Button>
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
          {payments.error ? (
            <p className="p-6 text-sm text-destructive">{friendlyError(payments.error)}</p>
          ) : !payments.data?.length ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              No dealer payments yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Dealer</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.data.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="num">{p.paid_on}</TableCell>
                      <TableCell>{nameOf(p.customer_id)}</TableCell>
                      <TableCell className="num text-right font-semibold">
                        {bdt(p.amount)}
                      </TableCell>
                      <TableCell>{methodLabel(p.method)}</TableCell>
                      <TableCell className="num text-sm text-muted-foreground">
                        {p.txn_ref ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {p.notes ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      <Dialog open={!!selectedDealer} onOpenChange={(open) => !open && setSelectedDealer(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="break-words">{selectedDealer?.name}</DialogTitle>
          </DialogHeader>
          {selectedDealer && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border bg-card p-4">
                  <p className="text-xs text-muted-foreground">Dealer type</p>
                  <p className="mt-1 font-medium">{typeLabel(selectedDealer.type)}</p>
                </div>
                <div className="rounded-md border bg-card p-4">
                  <p className="text-xs text-muted-foreground">Mobile</p>
                  <p className="mt-1 font-medium">{selectedDealer.mobile}</p>
                </div>
                <Stat label="Credit limit" value={Number(selectedDealer.credit_limit ?? 0)} />
                <Stat
                  label="Current due"
                  value={Number(selectedDealer.current_due ?? 0)}
                  tone={Number(selectedDealer.current_due ?? 0) > 0 ? "neg" : undefined}
                />
                <Stat label="Available credit" value={Math.max(selectedDealer.available, 0)} />
                <div className="rounded-md border bg-card p-4">
                  <p className="text-xs text-muted-foreground">Payment terms</p>
                  <p className="mt-1 font-medium">{selectedDealer.payment_terms_days ?? 0} days</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={selectedDealer.status === "active" ? "secondary" : "destructive"}>
                  {selectedDealer.status}
                </Badge>
                {selectedDealer.last_payment && (
                  <Badge variant="outline">Last payment: {selectedDealer.last_payment}</Badge>
                )}
              </div>
              <DialogFooter className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Button asChild variant="outline">
                  <Link
                    to="/app/ledger"
                    search={{ kind: "customer", party: String(selectedDealer.customer_id) }}
                  >
                    Ledger
                  </Link>
                </Button>
                {canEdit && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCf({
                        limit: String(selectedDealer.credit_limit ?? 0),
                        terms: String(selectedDealer.payment_terms_days ?? 0),
                        status: selectedDealer.status,
                      });
                      setCredit({
                        id: selectedDealer.customer_id!,
                        name: selectedDealer.name!,
                      });
                      setSelectedDealer(null);
                    }}
                  >
                    Credit settings
                  </Button>
                )}
                <Button
                  disabled={!canCollect || Number(selectedDealer.current_due ?? 0) <= 0}
                  onClick={() => {
                    setPf({
                      date: today(),
                      method: "cash",
                      amount: String(selectedDealer.current_due ?? 0),
                    });
                    setPay({
                      id: selectedDealer.customer_id!,
                      name: selectedDealer.name!,
                      due: Number(selectedDealer.current_due ?? 0),
                    });
                    setSelectedDealer(null);
                  }}
                >
                  Receive payment
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!credit} onOpenChange={(o) => !o && setCredit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Credit settings — {credit?.name}</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveCredit.mutate();
            }}
          >
            <F label="Credit limit (৳)">
              <Input
                type="number"
                step="0.01"
                value={cf["limit"] ?? ""}
                onChange={(e) => setCf({ ...cf, limit: e.target.value })}
              />
            </F>
            <F label="Payment terms (days)">
              <Input
                type="number"
                value={cf["terms"] ?? ""}
                onChange={(e) => setCf({ ...cf, terms: e.target.value })}
              />
            </F>
            <F label="Status">
              <select
                className={selectCls}
                value={cf["status"] ?? "active"}
                onChange={(e) => setCf({ ...cf, status: e.target.value })}
              >
                {DEALER_STATUS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </F>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setCredit(null)}>
                Cancel
              </Button>
              <Button disabled={saveCredit.isPending}>Save credit</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pay} onOpenChange={(o) => !o && setPay(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Receive from {pay?.name} — due {bdt(pay?.due)}
            </DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              receive.mutate();
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
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {methodLabel(m)}
                  </option>
                ))}
              </select>
            </F>
            <F label="Receive into">
              <select
                className={selectCls}
                value={pf["account"] ?? ""}
                onChange={(e) => setPf({ ...pf, account: e.target.value })}
              >
                {accounts.data
                  ?.filter((a) => a.status === "active")
                  .map((a) => (
                    <option key={a.id!} value={a.id!}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </F>
            <F label="Date">
              <Input
                type="date"
                value={pf["date"] ?? ""}
                onChange={(e) => setPf({ ...pf, date: e.target.value })}
              />
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
              <Button disabled={receive.isPending}>Receive payment</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function typeLabel(t: string | null) {
  return t ? (TYPE_LABEL[t] ?? t) : "—";
}
