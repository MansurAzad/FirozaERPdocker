import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { useMoneyAccounts, FINANCE_ROLES } from "@/lib/finance";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, selectCls, today, monthStart } from "@/components/erp/ui";
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

export const Route = createFileRoute("/_authenticated/app/bank-reconciliation")({
  head: ({ matches }) => ({
    meta: [
      { title: `Bank Reconciliation — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Match bank and mobile-banking statements against the books in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Bank Reconciliation — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: "Reconcile money accounts with the bank statement.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BankReconciliation,
});

function BankReconciliation() {
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const accounts = useMoneyAccounts(business.id);
  const can = FINANCE_ROLES.includes(role);

  const [account, setAccount] = useState("");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [selected, setSelected] = useState<string | null>(null);
  const [dlg, setDlg] = useState(false);
  const [f, setF] = useState<Record<string, string>>({});

  const acct = account || accounts.data?.[0]?.id || "";
  const current = accounts.data?.find((a) => a.id === acct);

  const recons = useQuery({
    enabled: !!acct,
    queryKey: ["bank-recons", business.id, acct, from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_bank_reconciliation_summary", {
        _biz: business.id,
        _account_id: acct,
        _from_date: from,
        _to_date: to,
      });
      if (error) throw error;
      return data;
    },
  });

  const items = useQuery({
    enabled: !!selected,
    queryKey: ["bank-recon-items", selected],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_reconciliation_items")
        .select("*")
        .eq("reconciliation_id", selected!)
        .order("transaction_type")
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const active = recons.data?.find((r) => r.recon_id === selected);

  const start = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("start_bank_reconciliation", {
        _biz: business.id,
        _account_id: f["account"] ?? acct,
        _reconciliation_date: f["date"] ?? today(),
        _statement_balance: Number(f["statement"] || 0),
        _note: f["note"] ?? "",
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (id) => {
      toast.success("Reconciliation started");
      setDlg(false);
      setSelected(id);
      qc.invalidateQueries({ queryKey: ["bank-recons"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const toggle = useMutation({
    mutationFn: async (v: { id: string; cleared: boolean }) => {
      const { error } = await supabase.rpc("mark_reconciliation_item_cleared", {
        _item_id: v.id,
        _cleared: v.cleared,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bank-recon-items", selected] }),
    onError: (e) => toast.error(friendlyError(e)),
  });

  const complete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("complete_bank_reconciliation", { _recon_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Reconciliation completed");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bank reconciliation"
        sub="Match each bank / mobile-banking statement against the money account's book balance."
        actions={
          can && (
            <Button
              onClick={() => {
                setF({ account: acct, date: today(), statement: "", note: "" });
                setDlg(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" />
              New reconciliation
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <F label="Account">
          <select className={selectCls} value={acct} onChange={(e) => setAccount(e.target.value)}>
            {(accounts.data ?? []).map((a) => (
              <option key={a.id!} value={a.id!}>
                {a.name} ({bdt(a.balance)})
              </option>
            ))}
          </select>
        </F>
        <F label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </F>
        <F label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </F>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0 overflow-hidden rounded-lg border bg-card p-4">
          <div className="break-words text-xs uppercase text-muted-foreground">Book balance</div>
          <div className="num mt-1 break-words font-display text-lg font-semibold sm:text-xl">
            {bdt(current?.balance)}
          </div>
        </div>
        <div className="min-w-0 overflow-hidden rounded-lg border bg-card p-4">
          <div className="break-words text-xs uppercase text-muted-foreground">
            Statement balance
          </div>
          <div className="num mt-1 break-words font-display text-lg font-semibold sm:text-xl">
            {active ? bdt(active.statement_balance) : "—"}
          </div>
        </div>
        <div className="min-w-0 overflow-hidden rounded-lg border bg-card p-4">
          <div className="break-words text-xs uppercase text-muted-foreground">Difference</div>
          <div
            className={
              "num mt-1 break-words font-display text-lg font-semibold sm:text-xl " +
              (active && Number(active.difference) !== 0 ? "text-destructive" : "")
            }
          >
            {active ? bdt(active.difference) : "—"}
          </div>
        </div>
        <div className="min-w-0 overflow-hidden rounded-lg border bg-card p-4">
          <div className="break-words text-xs uppercase text-muted-foreground">Items / cleared</div>
          <div className="num mt-1 break-words font-display text-lg font-semibold sm:text-xl">
            {items.data
              ? `${items.data.filter((i) => i.cleared).length} / ${items.data.length}`
              : "—"}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card">
          <div className="border-b p-3 text-sm font-semibold">Reconciliations</div>
          {recons.error ? (
            <p className="p-6 text-sm text-destructive">{friendlyError(recons.error)}</p>
          ) : (recons.data?.length ?? 0) === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No reconciliation in this range.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Statement</TableHead>
                  <TableHead className="text-right">Difference</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recons.data?.map((r) => (
                  <TableRow
                    key={r.recon_id}
                    onClick={() => setSelected(r.recon_id)}
                    className={"cursor-pointer " + (r.recon_id === selected ? "bg-muted/60" : "")}
                  >
                    <TableCell className="num">{r.reconciliation_date}</TableCell>
                    <TableCell className="num text-right">{bdt(r.statement_balance)}</TableCell>
                    <TableCell
                      className={
                        "num text-right " + (Number(r.difference) !== 0 ? "text-destructive" : "")
                      }
                    >
                      {bdt(r.difference)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status === "draft" ? "outline" : "secondary"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="rounded-lg border bg-card">
          <div className="flex items-center justify-between border-b p-3 text-sm font-semibold">
            <span>{active ? `Items — ${active.reconciliation_date}` : "Items"}</span>
            {can && active?.status === "draft" && (
              <Button
                size="sm"
                disabled={complete.isPending}
                onClick={() => complete.mutate(active.recon_id)}
              >
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                Complete
              </Button>
            )}
          </div>
          {!selected ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Pick a reconciliation to review its items.
            </p>
          ) : (items.data?.length ?? 0) === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No payment items were found for this date.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-center">Cleared</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.data?.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <Badge variant={i.transaction_type === "deposit" ? "secondary" : "outline"}>
                          {i.transaction_type === "deposit" ? "Receipt" : "Payment"}
                        </Badge>
                      </TableCell>
                      <TableCell className="num text-right">{bdt(i.amount)}</TableCell>
                      <TableCell className="text-center">
                        {can && active?.status === "draft" ? (
                          <Checkbox
                            checked={i.cleared}
                            onCheckedChange={(c) => toggle.mutate({ id: i.id, cleared: !!c })}
                          />
                        ) : (
                          <span className={i.cleared ? "text-success" : "text-muted-foreground"}>
                            {i.cleared ? "Yes" : "No"}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
          {active?.status === "draft" && (
            <p className="border-t p-3 text-xs text-muted-foreground">
              Clear every line that already appears on the statement, then complete. Only cleared
              receipts and payments are marked as reconciled.
            </p>
          )}
          {active?.status === "reconciled" && (
            <p className="border-t p-3 text-xs text-success">
              <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
              This reconciliation is complete.
            </p>
          )}
        </div>
      </div>

      <Dialog open={dlg} onOpenChange={setDlg}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New reconciliation</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              start.mutate();
            }}
          >
            <F label="Account" className="sm:col-span-2">
              <select
                className={selectCls}
                value={f["account"] ?? acct}
                onChange={(e) => setF({ ...f, account: e.target.value })}
              >
                {(accounts.data ?? []).map((a) => (
                  <option key={a.id!} value={a.id!}>
                    {a.name} ({bdt(a.balance)})
                  </option>
                ))}
              </select>
            </F>
            <F label="Statement date">
              <Input
                type="date"
                value={f["date"] ?? today()}
                onChange={(e) => setF({ ...f, date: e.target.value })}
              />
            </F>
            <F label="Statement closing balance (৳)">
              <Input
                type="number"
                step="0.01"
                value={f["statement"] ?? ""}
                onChange={(e) => setF({ ...f, statement: e.target.value })}
              />
            </F>
            <F label="Note" className="sm:col-span-2">
              <Input
                value={f["note"] ?? ""}
                onChange={(e) => setF({ ...f, note: e.target.value })}
              />
            </F>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setDlg(false)}>
                Cancel
              </Button>
              <Button disabled={start.isPending}>Start</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
