import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Plus,
  Pencil,
  Ban,
  Trash2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { useBranches, useMoneyAccounts, FINANCE_ROLES } from "@/lib/finance";
import { PageHeader } from "@/components/erp/EntityManager";
import {
  F,
  KIND_LABEL,
  METHODS,
  methodLabel,
  selectCls,
  today,
  type Method,
} from "@/components/erp/ui";
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

export const Route = createFileRoute("/_authenticated/app/money")({
  validateSearch: z.object({ kind: z.enum(["cash", "bank"]).optional() }),
  head: ({ matches }) => ({
    meta: [
      { title: `Cash & Bank — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Cash & Bank records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Cash & Bank — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Cash & Bank records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MoneyPage,
});

const IN_KINDS = [
  ["other_income", "Other income"],
  ["owner_capital", "Owner capital"],
  ["loan_received", "Loan received"],
  ["adjustment", "Adjustment"],
] as const;
const OUT_KINDS = [
  ["owner_drawing", "Owner drawing"],
  ["loan_repayment", "Loan repayment"],
  ["adjustment", "Adjustment"],
] as const;
const KIND_TXT: Record<string, string> = {
  supplier_payment: "Supplier payment",
  expense: "Expense",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  other_income: "Other income",
  owner_capital: "Owner capital",
  owner_drawing: "Owner drawing",
  loan_received: "Loan received",
  loan_repayment: "Loan repayment",
  adjustment: "Adjustment",
  sale_receipt: "Sale receipt",
  customer_payment: "Customer payment",
};

function MoneyPage() {
  const { business, role } = useBusiness();
  const { kind } = Route.useSearch();
  const qc = useQueryClient();
  const accounts = useMoneyAccounts(business.id);
  const branches = useBranches(business.id);
  const [sel, setSel] = useState("");
  const [dlg, setDlg] = useState<null | "new" | "edit" | "in" | "out" | "transfer">(null);
  const [rev, setRev] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [f, setF] = useState<Record<string, string>>({});
  const can = FINANCE_ROLES.includes(role);

  const list = (accounts.data ?? []).filter(
    (a) => !kind || (kind === "cash" ? a.kind === "cash" : a.kind !== "cash"),
  );
  const total = list.reduce((s, a) => s + Number(a.balance ?? 0), 0);
  const selected = sel || list[0]?.id || "";

  const txns = useQuery({
    enabled: !!selected,
    queryKey: ["money_txns", selected],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("money_transactions")
        .select("*")
        .eq("account_id", selected)
        .order("txn_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data;
    },
  });

  const open = (d: typeof dlg) => {
    setF({
      date: today(),
      kind: d === "out" ? "owner_drawing" : "other_income",
      account: selected,
      method: "cash",
      akind: kind === "bank" ? "bank" : "cash",
    });
    setDlg(d);
  };
  const done = (msg: string) => {
    toast.success(msg);
    setDlg(null);
    qc.invalidateQueries();
  };

  const save = useMutation({
    mutationFn: async () => {
      const amt = Number(f["amount"] || 0);
      if (dlg === "new") {
        const { error } = await supabase.rpc("create_money_account", {
          _biz: business.id,
          _kind: (f["akind"] ?? "cash") as "cash" | "bank" | "mfs",
          _name: f["name"] ?? "",
          _bank_name: f["bank_name"] ?? "",
          _bank_branch: f["bank_branch"] ?? "",
          _account_no: f["account_no"] ?? "",
          _opening: Number(f["opening"] || 0),
          _branch: f["branch"] || (null as unknown as string),
        });
        if (error) throw error;
        return "Account created";
      }
      if (dlg === "edit") {
        const { error } = await supabase.rpc("update_money_account", {
          _biz: business.id,
          _id: f["id"] ?? "",
          _name: f["name"] ?? "",
          _bank_name: f["bank_name"] ?? "",
          _bank_branch: f["bank_branch"] ?? "",
          _account_no: f["account_no"] ?? "",
          _branch: f["branch"] || (null as unknown as string),
          _status: (f["status"] ?? "active") as "active" | "inactive",
        });
        if (error) throw error;
        return "Account updated";
      }
      if (dlg === "transfer") {
        const { error } = await supabase.rpc("transfer_money", {
          _biz: business.id,
          _from: f["account"] ?? "",
          _to: f["to"] ?? "",
          _amount: amt,
          _date: f["date"] ?? today(),
          _note: f["note"] ?? "",
        });
        if (error) throw error;
        return "Transfer recorded";
      }
      const { error } = await supabase.rpc("record_money_txn", {
        _biz: business.id,
        _account: f["account"] ?? "",
        _direction: dlg === "in" ? "in" : "out",
        _kind: f["kind"] ?? "",
        _amount: amt,
        _date: f["date"] ?? today(),
        _method: (f["method"] ?? "cash") as Method,
        _txn_ref: f["ref"] ?? "",
        _note: f["note"] ?? "",
      });
      if (error) throw error;
      return dlg === "in" ? "Cash in recorded" : "Cash out recorded";
    },
    onSuccess: done,
    onError: (e) => toast.error(friendlyError(e)),
  });

  const reverse = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("reverse_money_txn", {
        _biz: business.id,
        _id: rev ?? "",
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entry cancelled");
      setRev(null);
      setReason("");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const delAcc = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_money_account", { _biz: business.id, _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Account deleted");
      setSel("");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const REVERSIBLE = [
    "other_income",
    "owner_capital",
    "loan_received",
    "owner_drawing",
    "loan_repayment",
    "adjustment",
    "transfer_in",
    "transfer_out",
  ];
  const cur = list.find((a) => a.id === selected);

  const inp = (k: string, type = "text") => (
    <Input
      type={type}
      step="0.01"
      value={f[k] ?? ""}
      onChange={(e) => setF({ ...f, [k]: e.target.value })}
    />
  );
  const acctSelect = (k: string) => (
    <select
      className={selectCls}
      value={f[k] ?? ""}
      onChange={(e) => setF({ ...f, [k]: e.target.value })}
    >
      <option value="">Select…</option>
      {accounts.data
        ?.filter((a) => a.status === "active")
        .map((a) => (
          <option key={a.id!} value={a.id!}>
            {a.name} ({bdt(a.balance)})
          </option>
        ))}
    </select>
  );

  return (
    <div>
      <PageHeader
        title={kind === "cash" ? "Cashbook" : kind === "bank" ? "Bank Accounts" : "Cash & Bank"}
        sub={kind === "bank" ? "ব্যাংকে কত টাকা আছে?" : "হাতে কত টাকা আছে?"}
        actions={
          can && (
            <>
              <Button variant="outline" onClick={() => open("in")}>
                <ArrowDownLeft className="mr-1 h-4 w-4" />
                Cash In
              </Button>
              <Button variant="outline" onClick={() => open("out")}>
                <ArrowUpRight className="mr-1 h-4 w-4" />
                Cash Out
              </Button>
              <Button variant="outline" onClick={() => open("transfer")}>
                <ArrowLeftRight className="mr-1 h-4 w-4" />
                Transfer
              </Button>
              <Button onClick={() => open("new")}>
                <Plus className="mr-1 h-4 w-4" />
                Account
              </Button>
            </>
          )
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0 overflow-hidden rounded-lg border bg-sidebar p-3 text-sidebar-foreground sm:p-4">
          <div className="break-words text-xs uppercase opacity-70">Total balance</div>
          <div className="num mt-1 break-all font-display text-lg font-semibold text-sidebar-accent-foreground sm:text-2xl">
            {bdt(total)}
          </div>
        </div>
        {list.map((a) => (
          <button
            key={a.id!}
            onClick={() => setSel(a.id!)}
            className={
              "min-w-0 overflow-hidden rounded-lg border bg-card p-3 text-left transition-colors sm:p-4 " +
              (selected === a.id
                ? "border-primary ring-2 ring-primary/20"
                : "hover:border-foreground/30")
            }
          >
            <div className="flex min-w-0 items-start justify-between gap-2 text-xs text-muted-foreground">
              <span className="break-words">{KIND_LABEL[a.kind!]}</span>
              {a.status === "inactive" && <Badge variant="secondary">Inactive</Badge>}
            </div>
            <div className="mt-0.5 break-words font-medium">{a.name}</div>
            {a.account_no && (
              <div className="num break-words text-xs text-muted-foreground">
                {a.bank_name} · {a.account_no}
              </div>
            )}
            <div
              className={
                "num mt-2 break-all font-display text-lg font-semibold sm:text-xl " +
                (Number(a.balance) < 0 ? "text-destructive" : "")
              }
            >
              {bdt(a.balance)}
            </div>
          </button>
        ))}
      </div>

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between gap-2 border-b p-3 text-sm font-semibold">
          <span>Transactions — {cur?.name ?? "—"}</span>
          {can && cur && (
            <span className="flex gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setF({
                    id: cur.id!,
                    name: cur.name ?? "",
                    bank_name: cur.bank_name ?? "",
                    bank_branch: cur.bank_branch ?? "",
                    account_no: cur.account_no ?? "",
                    status: cur.status ?? "active",
                    akind: cur.kind ?? "cash",
                  });
                  setDlg("edit");
                }}
              >
                <Pencil className="mr-1 h-3.5 w-3.5" />
                Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Delete account"
                onClick={() =>
                  confirm(
                    `Delete "${cur.name}"? Accounts with history can only be made inactive.`,
                  ) && delAcc.mutate(cur.id!)
                }
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </span>
          )}
        </div>
        {!txns.data?.length ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No transactions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                  {can && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {txns.data.map((t) => (
                  <TableRow key={t.id} className={t.reversed_at ? "opacity-60" : ""}>
                    <TableCell className="num">{t.txn_date}</TableCell>
                    <TableCell>
                      {t.kind === "reversal" ? "Cancellation" : (KIND_TXT[t.kind] ?? t.kind)}
                      {t.reversed_at && (
                        <Badge variant="secondary" className="ml-2">
                          Cancelled
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {t.note}
                      {t.method && t.method !== "cash" ? ` · ${methodLabel(t.method)}` : ""}
                      {t.txn_ref ? ` · ${t.txn_ref}` : ""}
                    </TableCell>
                    <TableCell className="num text-right text-success">
                      {t.direction === "in" ? bdt(t.amount) : ""}
                    </TableCell>
                    <TableCell className="num text-right text-destructive">
                      {t.direction === "out" ? bdt(t.amount) : ""}
                    </TableCell>
                    {can && (
                      <TableCell className="text-right">
                        {REVERSIBLE.includes(t.kind) && !t.reversed_at && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Cancel entry"
                            onClick={() => {
                              setReason("");
                              setRev(t.id);
                            }}
                          >
                            <Ban className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {
                {
                  new: "New cash / bank account",
                  edit: "Edit account",
                  in: "Cash In",
                  out: "Cash Out",
                  transfer: "Transfer between accounts",
                }[dlg ?? "new"]
              }
            </DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            {dlg === "edit" ? (
              <>
                <F label="Account name *">{inp("name")}</F>
                {f["akind"] !== "cash" && (
                  <>
                    <F label="Bank / provider">{inp("bank_name")}</F>
                    <F label="Bank branch">{inp("bank_branch")}</F>
                    <F label="Account / wallet number">{inp("account_no")}</F>
                  </>
                )}
                <F label="Shop / branch">
                  <select
                    className={selectCls}
                    value={f["branch"] ?? ""}
                    onChange={(e) => setF({ ...f, branch: e.target.value })}
                  >
                    <option value="">—</option>
                    {branches.data?.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </F>
                <F label="Status">
                  <select
                    className={selectCls}
                    value={f["status"]}
                    onChange={(e) => setF({ ...f, status: e.target.value })}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </F>
              </>
            ) : dlg === "new" ? (
              <>
                <F label="Type">
                  <select
                    className={selectCls}
                    value={f["akind"]}
                    onChange={(e) => setF({ ...f, akind: e.target.value })}
                  >
                    <option value="cash">Cash</option>
                    <option value="bank">Bank</option>
                    <option value="mfs">Mobile Banking (bKash/Nagad/Rocket)</option>
                  </select>
                </F>
                <F label="Account name *">{inp("name")}</F>
                {f["akind"] !== "cash" && (
                  <>
                    <F label={f["akind"] === "mfs" ? "Provider" : "Bank"}>{inp("bank_name")}</F>
                    <F label="Bank branch">{inp("bank_branch")}</F>
                    <F label="Account / wallet number">{inp("account_no")}</F>
                  </>
                )}
                <F label="Shop / branch">
                  <select
                    className={selectCls}
                    value={f["branch"] ?? ""}
                    onChange={(e) => setF({ ...f, branch: e.target.value })}
                  >
                    <option value="">—</option>
                    {branches.data?.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </F>
                <F label="Opening balance (৳)">{inp("opening", "number")}</F>
              </>
            ) : (
              <>
                <F label={dlg === "transfer" ? "From account" : "Account"}>
                  {acctSelect("account")}
                </F>
                {dlg === "transfer" ? (
                  <F label="To account">{acctSelect("to")}</F>
                ) : (
                  <F label="Type">
                    <select
                      className={selectCls}
                      value={f["kind"]}
                      onChange={(e) => setF({ ...f, kind: e.target.value })}
                    >
                      {(dlg === "in" ? IN_KINDS : OUT_KINDS).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </F>
                )}
                <F label="Amount (৳) *">{inp("amount", "number")}</F>
                <F label="Date">{inp("date", "date")}</F>
                {dlg !== "transfer" && (
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
                )}
                {dlg !== "transfer" && f["method"] !== "cash" && (
                  <F label="Transaction ID / Ref">{inp("ref")}</F>
                )}
                <F label="Note" className="sm:col-span-2">
                  {inp("note")}
                </F>
              </>
            )}
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setDlg(null)}>
                Cancel
              </Button>
              <Button disabled={save.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!rev} onOpenChange={(o) => !o && setRev(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel entry</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              reverse.mutate();
            }}
          >
            <p className="text-sm text-muted-foreground">
              An opposite entry is added and the accounts are reversed. Transfers are cancelled on
              both accounts. To fix an amount, cancel it and enter it again.
            </p>
            <F label="Reason">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </F>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRev(null)}>
                Back
              </Button>
              <Button variant="destructive" disabled={reverse.isPending}>
                Cancel entry
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
