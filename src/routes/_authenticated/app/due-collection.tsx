import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { useMoneyAccounts } from "@/lib/finance";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, METHODS, methodLabel, selectCls, today, type Method } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export const Route = createFileRoute("/_authenticated/app/due-collection")({
  head: ({ matches }) => ({
    meta: [
      { title: `Due Collection — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Due Collection records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Due Collection — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Due Collection records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DueCollection,
});

const BUCKETS = [
  "Current",
  "1–7 days",
  "8–15 days",
  "16–30 days",
  "31–60 days",
  "60+ days",
] as const;
function bucketOf(ageDays: number, terms: number) {
  const over = ageDays - terms;
  if (over <= 0) return 0;
  if (over <= 7) return 1;
  if (over <= 15) return 2;
  if (over <= 30) return 3;
  if (over <= 60) return 4;
  return 5;
}

function DueCollection() {
  const { business } = useBusiness();
  const qc = useQueryClient();
  const accounts = useMoneyAccounts(business.id);
  const [q, setQ] = useState("");
  const [pay, setPay] = useState<{ id: string; name: string; due: number } | null>(null);
  const [f, setF] = useState<Record<string, string>>({});

  const { data, error } = useQuery({
    queryKey: ["due-collection", business.id],
    queryFn: async () => {
      const [b, s] = await Promise.all([
        supabase
          .from("customer_balances")
          .select("*")
          .eq("business_id", business.id)
          .gt("current_due", 0)
          .order("current_due", { ascending: false }),
        supabase
          .from("sales")
          .select("customer_id,sale_date,total")
          .eq("business_id", business.id)
          .eq("status", "posted")
          .not("customer_id", "is", null)
          .order("sale_date"),
      ]);
      if (b.error) throw b.error;
      if (s.error) throw s.error;
      return { balances: b.data, sales: s.data };
    },
  });

  // FIFO aging: the unpaid due is attributed to the newest invoices first (oldest invoices are considered paid first).
  const aged = useMemo(() => {
    const now = new Date(today()).getTime();
    return (data?.balances ?? []).map((c) => {
      const buckets = [0, 0, 0, 0, 0, 0];
      let remaining = Number(c.current_due);
      const inv = (data?.sales ?? []).filter((s) => s.customer_id === c.customer_id).reverse();
      for (const s of inv) {
        if (remaining <= 0) break;
        const part = Math.min(remaining, Number(s.total));
        buckets[
          bucketOf(
            Math.floor((now - new Date(s.sale_date).getTime()) / 86400000),
            c.payment_terms_days ?? 0,
          )
        ]! += part;
        remaining -= part;
      }
      if (remaining > 0) buckets[5]! += remaining; // opening balance
      return { ...c, buckets, overdue: buckets.slice(1).reduce((a, b) => a + b, 0) };
    });
  }, [data]);
  const rows = aged.filter((r) => {
    const s = q.toLowerCase();
    return (
      !s || [r.name, r.mobile, r.business_name].some((x) => (x ?? "").toLowerCase().includes(s))
    );
  });
  const totals = BUCKETS.map((_, i) => aged.reduce((a, r) => a + r.buckets[i]!, 0));
  const grand = totals.reduce((a, b) => a + b, 0);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("receive_customer_payment", {
        _biz: business.id,
        _customer: pay!.id,
        _account: f["account"] || accounts.data?.[0]?.id || "",
        _amount: Number(f["amount"] || 0),
        _date: f["date"] ?? today(),
        _method: (f["method"] ?? "cash") as Method,
        _txn_ref: f["ref"] ?? "",
        _note: f["note"] ?? "",
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
      <PageHeader title="Due Collection" sub={`কার কাছে কত টাকা পাওনা? — total ${bdt(grand)}`} />
      <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 lg:grid-cols-6">
        {BUCKETS.map((b, i) => (
          <div key={b} className="min-w-0 overflow-hidden bg-card p-3 sm:p-4">
            <div className="break-words text-xs text-muted-foreground">{b}</div>
            <div
              className={
                "num mt-1 break-all font-display text-sm font-semibold leading-tight sm:text-base " +
                (i >= 4 && totals[i]! > 0 ? "text-destructive" : "")
              }
            >
              {bdt(totals[i])}
            </div>
            <div className="mt-2 h-1 rounded bg-muted">
              <div
                className="h-1 rounded bg-foreground/60"
                style={{ width: grand ? `${(totals[i]! / grand) * 100}%` : 0 }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-lg border bg-card">
        <div className="border-b p-3">
          <Input
            placeholder="Search customer or mobile…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-xs"
          />
        </div>
        {error ? (
          <p className="p-6 text-sm text-destructive">{friendlyError(error)}</p>
        ) : !rows.length ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No customer dues. 🎉</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead className="text-right">Overdue</TableHead>
                  <TableHead className="text-right">Credit limit</TableHead>
                  <TableHead>Last payment</TableHead>
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
                    <TableCell className="num text-right font-semibold">
                      {bdt(r.current_due)}
                    </TableCell>
                    <TableCell
                      className={
                        "num text-right " +
                        (r.overdue > 0 ? "text-destructive" : "text-muted-foreground")
                      }
                    >
                      {bdt(r.overdue)}
                    </TableCell>
                    <TableCell
                      className={
                        "num text-right " +
                        (Number(r.current_due) > Number(r.credit_limit) ? "text-destructive" : "")
                      }
                    >
                      {bdt(r.credit_limit)}
                    </TableCell>
                    <TableCell className="num text-sm text-muted-foreground">
                      {r.last_payment ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        onClick={() => {
                          setF({ date: today(), method: "cash", amount: String(r.current_due) });
                          setPay({ id: r.customer_id!, name: r.name!, due: Number(r.current_due) });
                        }}
                      >
                        Receive
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
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
              save.mutate();
            }}
          >
            <F label="Amount (৳)">
              <Input
                type="number"
                step="0.01"
                value={f["amount"] ?? ""}
                onChange={(e) => setF({ ...f, amount: e.target.value })}
              />
            </F>
            <F label="Method">
              <select
                className={selectCls}
                value={f["method"]}
                onChange={(e) => setF({ ...f, method: e.target.value })}
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
                value={f["account"] ?? ""}
                onChange={(e) => setF({ ...f, account: e.target.value })}
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
                value={f["date"] ?? ""}
                onChange={(e) => setF({ ...f, date: e.target.value })}
              />
            </F>
            {f["method"] !== "cash" && (
              <F label="Transaction ID">
                <Input
                  value={f["ref"] ?? ""}
                  onChange={(e) => setF({ ...f, ref: e.target.value })}
                />
              </F>
            )}
            <F label="Note">
              <Input
                value={f["note"] ?? ""}
                onChange={(e) => setF({ ...f, note: e.target.value })}
              />
            </F>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setPay(null)}>
                Cancel
              </Button>
              <Button disabled={save.isPending}>Receive payment</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
