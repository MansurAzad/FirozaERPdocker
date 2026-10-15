import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Ban, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { useBranches, useMoneyAccounts } from "@/lib/finance";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, monthStart, selectCls, today } from "@/components/erp/ui";
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

export const Route = createFileRoute("/_authenticated/app/expenses")({
  validateSearch: (s: Record<string, unknown>): { branch?: string | undefined } => ({
    branch: typeof s["branch"] === "string" ? s["branch"] : undefined,
  }),
  head: ({ matches }) => ({
    meta: [
      { title: `Expenses — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Expenses records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Expenses — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Expenses records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExpensesPage,
});

function ExpensesPage() {
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const accounts = useMoneyAccounts(business.id);
  const branches = useBranches(business.id);
  const search = Route.useSearch();
  const [branchFilter, setBranchFilter] = useState(search.branch ?? "");
  useEffect(() => {
    setBranchFilter(search.branch ?? "");
  }, [search.branch]);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [open, setOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [catName, setCatName] = useState("");
  const [f, setF] = useState<Record<string, string>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const [rename, setRename] = useState<Record<string, string>>({});
  const canEdit = ["owner", "manager", "accountant"].includes(role);
  const can = ["owner", "manager", "accountant", "branch_manager"].includes(role);

  const cats = useQuery({
    queryKey: ["expense_categories", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("expense_categories")
        .select("id,name")
        .eq("business_id", business.id)
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const list = useQuery({
    queryKey: ["expenses", business.id, from, to, branchFilter],
    queryFn: async () => {
      let query = supabase
        .from("expenses")
        .select("*, expense_categories(name), branches(name), money_accounts(name)")
        .eq("business_id", business.id)
        .gte("expense_date", from)
        .lte("expense_date", to)
        .order("expense_date", { ascending: false });
      if (branchFilter) query = query.eq("branch_id", branchFilter);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of (list.data ?? []).filter((x) => !x.reversed_at))
      m.set(
        e.expense_categories?.name ?? "",
        (m.get(e.expense_categories?.name ?? "") ?? 0) + Number(e.amount),
      );
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [list.data]);
  const total = byCat.reduce((s, [, v]) => s + v, 0);

  const save = useMutation({
    mutationFn: async () => {
      const args = {
        _biz: business.id,
        _branch: f["branch"] ?? "",
        _category: f["category"] ?? "",
        _account: f["account"] ?? "",
        _amount: Number(f["amount"] || 0),
        _date: f["date"] ?? today(),
        _description: f["description"] ?? "",
      };
      const { error } = editId
        ? await supabase.rpc("update_expense", { ...args, _id: editId })
        : await supabase.rpc("create_expense", args);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editId ? "Expense updated" : "Expense recorded");
      setOpen(false);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const addCat = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("add_expense_category", {
        _biz: business.id,
        _name: catName,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Category added");
      setCatName("");
      setCatOpen(false);
      qc.invalidateQueries({ queryKey: ["expense_categories"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const cancel = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("reverse_expense", {
        _biz: business.id,
        _id: cancelId ?? "",
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Expense cancelled and money returned");
      setCancelId(null);
      setReason("");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const catAct = useMutation({
    mutationFn: async ({ id, del }: { id: string; del?: boolean }) => {
      const { error } = del
        ? await supabase.rpc("delete_expense_category", { _biz: business.id, _id: id })
        : await supabase.rpc("update_expense_category", {
            _biz: business.id,
            _id: id,
            _name: rename[id] ?? "",
          });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.del ? "Category deleted" : "Category renamed");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const sel = (k: string, opts: { id: string; name: string }[] | undefined) => (
    <select
      className={selectCls}
      value={f[k] ?? ""}
      onChange={(e) => setF({ ...f, [k]: e.target.value })}
    >
      <option value="">Select…</option>
      {opts?.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );

  return (
    <div>
      <PageHeader
        title="Expenses"
        sub={`${bdt(total)} in selected period`}
        actions={
          can && (
            <>
              <Button variant="outline" onClick={() => setManageOpen(true)}>
                Categories
              </Button>
              <Button variant="outline" onClick={() => setCatOpen(true)}>
                New category
              </Button>
              <Button
                onClick={() => {
                  setF({
                    date: today(),
                    branch: branchFilter || branches.data?.[0]?.id || "",
                    account: accounts.data?.[0]?.id ?? "",
                  });
                  setEditId(null);
                  setOpen(true);
                }}
              >
                <Plus className="mr-1 h-4 w-4" />
                Add Expense
              </Button>
            </>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <F label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </F>
        <F label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </F>
        <F label="Shop / Branch">
          <select
            aria-label="Shop / Branch"
            className={selectCls}
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
          >
            <option value="">All branches</option>
            {branches.data?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </F>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="rounded-lg border bg-card">
          {!list.data?.length ? (
            <p className="p-10 text-center text-sm text-muted-foreground">
              No expenses in this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Paid from</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    {canEdit && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data.map((e) => (
                    <TableRow key={e.id} className={e.reversed_at ? "opacity-60" : ""}>
                      <TableCell className="num">{e.expense_date}</TableCell>
                      <TableCell>{e.expense_categories?.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {e.description}
                        {e.reversed_at && (
                          <Badge variant="secondary" className="ml-2">
                            Cancelled{e.reversal_reason ? `: ${e.reversal_reason}` : ""}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{e.branches?.name}</TableCell>
                      <TableCell>{e.money_accounts?.name}</TableCell>
                      <TableCell
                        className={
                          "num text-right font-medium " + (e.reversed_at ? "line-through" : "")
                        }
                      >
                        {bdt(e.amount)}
                      </TableCell>
                      {canEdit && (
                        <TableCell className="text-right whitespace-nowrap">
                          {!e.reversed_at && (
                            <>
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label="Edit expense"
                                onClick={() => {
                                  setF({
                                    category: e.category_id,
                                    amount: String(e.amount),
                                    account: e.account_id,
                                    branch: e.branch_id,
                                    date: e.expense_date,
                                    description: e.description ?? "",
                                  });
                                  setEditId(e.id);
                                  setOpen(true);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label="Cancel expense"
                                onClick={() => {
                                  setReason("");
                                  setCancelId(e.id);
                                }}
                              >
                                <Ban className="h-4 w-4 text-destructive" />
                              </Button>
                            </>
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
        <div className="h-fit rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">By category</h2>
          {byCat.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            byCat.map(([n, v]) => (
              <div key={n} className="mb-2">
                <div className="num flex justify-between text-sm">
                  <span>{n}</span>
                  <span>{bdt(v)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded bg-muted">
                  <div
                    className="h-1.5 rounded bg-primary"
                    style={{ width: `${(v / total) * 100}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? "Edit expense" : "Add expense"}</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <F label="Category *">{sel("category", cats.data)}</F>
            <F label="Amount (৳) *">
              <Input
                type="number"
                step="0.01"
                value={f["amount"] ?? ""}
                onChange={(e) => setF({ ...f, amount: e.target.value })}
              />
            </F>
            <F label="Paid from *">
              {sel(
                "account",
                accounts.data
                  ?.filter((a) => a.status === "active" && a.id)
                  .map((a) => ({ id: a.id ?? "", name: `${a.name} (${bdt(a.balance)})` })),
              )}
            </F>
            <F label="Branch *">{sel("branch", branches.data)}</F>
            <F label="Date">
              <Input
                type="date"
                value={f["date"] ?? ""}
                onChange={(e) => setF({ ...f, date: e.target.value })}
              />
            </F>
            <F label="Description">
              <Input
                value={f["description"] ?? ""}
                onChange={(e) => setF({ ...f, description: e.target.value })}
              />
            </F>
            {editId && (
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Saving cancels the old entry and records the corrected one, so your books keep a
                full history.
              </p>
            )}
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={save.isPending}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New expense category</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              addCat.mutate();
            }}
          >
            <F label="Name">
              <Input value={catName} onChange={(e) => setCatName(e.target.value)} />
            </F>
            <p className="text-xs text-muted-foreground">
              A matching expense account is created in the chart of accounts.
            </p>
            <DialogFooter>
              <Button disabled={addCat.isPending}>Add</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!cancelId} onOpenChange={(o) => !o && setCancelId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel expense</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              cancel.mutate();
            }}
          >
            <p className="text-sm text-muted-foreground">
              The money goes back to the account it was paid from and the accounts are reversed. The
              entry stays in history marked Cancelled.
            </p>
            <F label="Reason">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </F>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCancelId(null)}>
                Back
              </Button>
              <Button variant="destructive" disabled={cancel.isPending}>
                Cancel expense
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Expense categories</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {cats.data?.map((c) => (
              <div key={c.id} className="flex gap-2">
                <Input
                  value={rename[c.id] ?? c.name}
                  onChange={(e) => setRename({ ...rename, [c.id]: e.target.value })}
                />
                <Button
                  variant="outline"
                  disabled={(rename[c.id] ?? c.name) === c.name || catAct.isPending}
                  onClick={() => catAct.mutate({ id: c.id })}
                >
                  Save
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Delete category"
                  onClick={() =>
                    confirm(`Delete "${c.name}"?`) && catAct.mutate({ id: c.id, del: true })
                  }
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Categories that already have expenses cannot be deleted.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
