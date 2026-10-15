import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
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

export const Route = createFileRoute("/_authenticated/app/supplier-payments")({
  head: ({ matches }) => ({
    meta: [
      { title: `Supplier Payments — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Supplier Payments records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Supplier Payments — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Supplier Payments records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: z.object({ supplier: z.string().optional() }),
  component: SupplierPayments,
});

function SupplierPayments() {
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const accounts = useMoneyAccounts(business.id);
  const [pay, setPay] = useState<{ id: string; name: string; due: number } | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const can = ["owner", "manager", "accountant", "purchase_officer"].includes(role);

  const bal = useQuery({
    queryKey: ["supplier_balances", business.id],
    queryFn: async () => {
      const [b, last] = await Promise.all([
        supabase
          .from("supplier_balances")
          .select("*")
          .eq("business_id", business.id)
          .order("current_payable", { ascending: false }),
        supabase
          .from("supplier_payments")
          .select("supplier_id, paid_on, amount, method, txn_ref, suppliers(name)")
          .eq("business_id", business.id)
          .order("paid_on", { ascending: false })
          .limit(200),
      ]);
      if (b.error) throw b.error;
      if (last.error) throw last.error;
      return { balances: b.data, payments: last.data };
    },
  });
  const { supplier } = Route.useSearch();
  const openPay = (r: {
    supplier_id: string | null;
    name: string | null;
    current_payable: number | null;
  }) => {
    setF({
      date: today(),
      method: "cash",
      account: accounts.data?.[0]?.id ?? "",
      amount: String(Number(r.current_payable ?? 0)),
    });
    setPay({ id: r.supplier_id!, name: r.name!, due: Number(r.current_payable ?? 0) });
  };
  useEffect(() => {
    const r = supplier && bal.data?.balances.find((b) => b.supplier_id === supplier);
    if (r && can) openPay(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier, bal.data, accounts.data]);
  const lastPaid = (id: string) => bal.data?.payments.find((p) => p.supplier_id === id)?.paid_on;
  const totalDue = (bal.data?.balances ?? []).reduce(
    (s, r) => s + Number(r.current_payable ?? 0),
    0,
  );

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("pay_supplier", {
        _biz: business.id,
        _supplier: pay!.id,
        _account: f["account"] ?? "",
        _amount: Number(f["amount"] || 0),
        _date: f["date"] ?? today(),
        _method: (f["method"] ?? "cash") as Method,
        _txn_ref: f["ref"] ?? "",
        _note: f["note"] ?? "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment recorded");
      setPay(null);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <div>
      <PageHeader
        title="Supplier Payments"
        sub={`কাকে কত টাকা দিতে হবে? — total due ${bdt(totalDue)}`}
      />
      <div className="mb-6 rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">Purchases</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Supplier due</TableHead>
              <TableHead>Last payment</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {bal.data?.balances.map((r) => (
              <TableRow key={r.supplier_id!}>
                <TableCell className="font-medium">
                  <Link
                    to="/app/ledger"
                    search={{ kind: "supplier", party: r.supplier_id! }}
                    className="hover:text-primary hover:underline"
                  >
                    {r.name}
                  </Link>
                </TableCell>
                <TableCell className="num text-right">
                  {bdt(Number(r.purchases_total) + Number(r.opening_payable))}
                </TableCell>
                <TableCell className="num text-right">{bdt(r.payments_total)}</TableCell>
                <TableCell
                  className={
                    "num text-right font-semibold " +
                    (Number(r.current_payable) > 0 ? "text-destructive" : "text-muted-foreground")
                  }
                >
                  {bdt(r.current_payable)}
                </TableCell>
                <TableCell className="num text-sm text-muted-foreground">
                  {lastPaid(r.supplier_id!) ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  {can && Number(r.current_payable) > 0 && (
                    <Button size="sm" onClick={() => openPay(r)}>
                      Pay
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <h2 className="mb-2 text-sm font-semibold">Recent payments</h2>
      <div className="rounded-lg border bg-card">
        {!bal.data?.payments.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <Table>
            <TableBody>
              {bal.data.payments.map((p, i) => (
                <TableRow key={i}>
                  <TableCell className="num">{p.paid_on}</TableCell>
                  <TableCell>{p.suppliers?.name}</TableCell>
                  <TableCell>
                    {methodLabel(p.method)}
                    {p.txn_ref ? ` · ${p.txn_ref}` : ""}
                  </TableCell>
                  <TableCell className="num text-right">{bdt(p.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <Dialog open={!!pay} onOpenChange={(o) => !o && setPay(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Pay {pay?.name} — due {bdt(pay?.due)}
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
            <F label="Pay from">
              <select
                className={selectCls}
                value={f["account"] ?? ""}
                onChange={(e) => setF({ ...f, account: e.target.value })}
              >
                {accounts.data
                  ?.filter((a) => a.status === "active")
                  .map((a) => (
                    <option key={a.id!} value={a.id!}>
                      {a.name} ({bdt(a.balance)})
                    </option>
                  ))}
              </select>
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
            <F label="Date">
              <Input
                type="date"
                value={f["date"] ?? ""}
                onChange={(e) => setF({ ...f, date: e.target.value })}
              />
            </F>
            {f["method"] !== "cash" && (
              <F label="Transaction ID / Ref">
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
              <Button disabled={save.isPending}>Record payment</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
