import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { selectCls } from "@/components/erp/ui";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, monthStart, Stat, today } from "@/components/erp/ui";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/app/accounting")({
  validateSearch: z.object({ tab: z.enum(["coa", "journal", "tb", "pl", "bs"]).optional() }),
  head: ({ matches }) => ({
    meta: [
      { title: `Accounting — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Accounting records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Accounting — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Accounting records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Accounting,
});

type Tot = {
  account_id: string;
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
};
const debitNature = (t: string) => t === "asset" || t === "expense";
const bal = (r: Tot) =>
  debitNature(r.type) ? Number(r.debit) - Number(r.credit) : Number(r.credit) - Number(r.debit);

function useTotals(biz: string, from: string | null, to: string) {
  return useQuery({
    queryKey: ["account_totals", biz, from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("account_totals", {
        _biz: biz,
        _from: from as string,
        _to: to,
      });
      if (error) throw error;
      return data as Tot[];
    },
  });
}

function Accounting() {
  const { business, role } = useBusiness();
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  if (!["owner", "manager", "accountant"].includes(role))
    return (
      <p className="text-sm text-muted-foreground">
        Accounting is available to owner, manager and accountant.
      </p>
    );

  return (
    <div>
      <PageHeader
        title="Accounting"
        sub="Double-entry books, posted automatically from purchases, payments and expenses."
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <F label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </F>
        <F label="To / As of">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </F>
      </div>
      <Tabs value={tab ?? "pl"} onValueChange={(v) => navigate({ search: { tab: v as "pl" } })}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="pl">Profit & Loss</TabsTrigger>
          <TabsTrigger value="bs">Balance Sheet</TabsTrigger>
          <TabsTrigger value="tb">Trial Balance</TabsTrigger>
          <TabsTrigger value="journal">Journal</TabsTrigger>
          <TabsTrigger value="coa">Chart of Accounts</TabsTrigger>
        </TabsList>
        <TabsContent value="pl">
          <PL biz={business.id} from={from} to={to} />
        </TabsContent>
        <TabsContent value="bs">
          <BS biz={business.id} to={to} />
        </TabsContent>
        <TabsContent value="tb">
          <TB biz={business.id} from={from} to={to} />
        </TabsContent>
        <TabsContent value="journal">
          <Journal biz={business.id} from={from} to={to} />
        </TabsContent>
        <TabsContent value="coa">
          <COA biz={business.id} to={to} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Section({ title, rows, total }: { title: string; rows: Tot[]; total: number }) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-4 py-2 text-sm font-semibold">{title}</div>
      {rows
        .filter((r) => bal(r) !== 0)
        .map((r) => (
          <div key={r.account_id} className="num flex justify-between px-4 py-1.5 text-sm">
            <span>
              <span className="text-muted-foreground">{r.code}</span> {r.name}
            </span>
            <span>{bdt(bal(r))}</span>
          </div>
        ))}
      <div className="num flex justify-between border-t px-4 py-2 text-sm font-semibold">
        <span>Total {title.toLowerCase()}</span>
        <span>{bdt(total)}</span>
      </div>
    </div>
  );
}

function PL({ biz, from, to }: { biz: string; from: string; to: string }) {
  const { data, error } = useTotals(biz, from, to);
  if (error) return <p className="text-sm text-destructive">{friendlyError(error)}</p>;
  const rev = (data ?? []).filter((r) => r.type === "revenue");
  const cogs = (data ?? []).filter((r) => r.code === "5010");
  const opex = (data ?? []).filter((r) => r.type === "expense" && r.code !== "5010");
  const sum = (x: Tot[]) => x.reduce((s, r) => s + bal(r), 0);
  const revenue = sum(rev),
    cost = sum(cogs),
    gross = revenue - cost,
    exp = sum(opex),
    net = gross - exp;
  return (
    <div className="space-y-4">
      <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        <Stat label="Sales revenue" value={revenue} />
        <Stat label="Gross profit" value={gross} note={`COGS ${bdt(cost)}`} />
        <Stat label="Expenses" value={exp} />
        <Stat label="Net profit" value={net} tone={net < 0 ? "neg" : "pos"} />
      </div>
      <p className="text-sm text-muted-foreground">
        ব্যবসা আসলে লাভ করছে নাকি শুধু cash movement হচ্ছে? Revenue and COGS fill in once sales are
        recorded.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Revenue" rows={rev} total={revenue} />
        <Section title="Expenses" rows={[...cogs, ...opex]} total={cost + exp} />
      </div>
    </div>
  );
}

function BS({ biz, to }: { biz: string; to: string }) {
  const { data, error } = useTotals(biz, null, to);
  if (error) return <p className="text-sm text-destructive">{friendlyError(error)}</p>;
  const by = (t: string) => (data ?? []).filter((r) => r.type === t);
  const sum = (x: Tot[]) => x.reduce((s, r) => s + bal(r), 0);
  const assets = sum(by("asset")),
    liab = sum(by("liability"));
  const earnings = sum(by("revenue")) - sum(by("expense"));
  const equity = sum(by("equity")) + earnings;
  const ok = Math.abs(assets - liab - equity) < 0.01;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        As of {to}{" "}
        {ok ? <Badge>Balanced</Badge> : <Badge variant="destructive">Out of balance</Badge>}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Assets" rows={by("asset")} total={assets} />
        <div className="space-y-4">
          <Section title="Liabilities" rows={by("liability")} total={liab} />
          <div className="rounded-lg border bg-card">
            <div className="border-b px-4 py-2 text-sm font-semibold">Equity</div>
            {by("equity")
              .filter((r) => bal(r) !== 0)
              .map((r) => (
                <div key={r.account_id} className="num flex justify-between px-4 py-1.5 text-sm">
                  <span>{r.name}</span>
                  <span>{bdt(bal(r))}</span>
                </div>
              ))}
            <div className="num flex justify-between px-4 py-1.5 text-sm">
              <span>Current earnings</span>
              <span>{bdt(earnings)}</span>
            </div>
            <div className="num flex justify-between border-t px-4 py-2 text-sm font-semibold">
              <span>Liabilities + equity</span>
              <span>{bdt(liab + equity)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TB({ biz, from, to }: { biz: string; from: string; to: string }) {
  const { data } = useTotals(biz, from, to);
  const rows = (data ?? []).filter((r) => Number(r.debit) || Number(r.credit));
  const d = rows.reduce((s, r) => s + Number(r.debit), 0),
    c = rows.reduce((s, r) => s + Number(r.credit), 0);
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Account</TableHead>
            <TableHead className="text-right">Debit</TableHead>
            <TableHead className="text-right">Credit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.account_id}>
              <TableCell className="num">{r.code}</TableCell>
              <TableCell>{r.name}</TableCell>
              <TableCell className="num text-right">{bdt(r.debit)}</TableCell>
              <TableCell className="num text-right">{bdt(r.credit)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2}>
              Total {Math.abs(d - c) < 0.01 ? "✓ balanced" : "✗ not balanced"}
            </TableCell>
            <TableCell className="num text-right">{bdt(d)}</TableCell>
            <TableCell className="num text-right">{bdt(c)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}

function Journal({ biz, from, to }: { biz: string; from: string; to: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [jd, setJd] = useState({ date: today(), memo: "" });
  const [lines, setLines] = useState([
    { a: "", d: "", c: "" },
    { a: "", d: "", c: "" },
  ]);
  const accs = useTotals(biz, null, to);
  const BLOCK = ["1010", "1020", "1030", "1100", "1200", "2010"];
  const td = lines.reduce((s, l) => s + Number(l.d || 0), 0),
    tc = lines.reduce((s, l) => s + Number(l.c || 0), 0);
  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("create_manual_journal", {
        _biz: biz,
        _date: jd.date,
        _memo: jd.memo,
        _lines: lines
          .filter((l) => l.a)
          .map((l) => ({ account_id: l.a, debit: Number(l.d || 0), credit: Number(l.c || 0) })),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Journal entry posted");
      setOpen(false);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const reverse = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("reverse_journal", { _biz: biz, _id: id, _reason: "" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Entry reversed");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const newBtn = (
    <div className="mb-3 flex justify-end">
      <Button
        onClick={() => {
          setJd({ date: today(), memo: "" });
          setLines([
            { a: "", d: "", c: "" },
            { a: "", d: "", c: "" },
          ]);
          setOpen(true);
        }}
      >
        <Plus className="mr-1 h-4 w-4" />
        New journal entry
      </Button>
    </div>
  );
  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New journal entry</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <F label="Date">
              <Input
                type="date"
                value={jd.date}
                onChange={(e) => setJd({ ...jd, date: e.target.value })}
              />
            </F>
            <F label="Description *">
              <Input value={jd.memo} onChange={(e) => setJd({ ...jd, memo: e.target.value })} />
            </F>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_110px_110px] gap-2">
              <select
                className={selectCls}
                value={l.a}
                onChange={(e) =>
                  setLines(lines.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))
                }
              >
                <option value="">Account…</option>
                {accs.data
                  ?.filter((r) => !BLOCK.includes(r.code))
                  .map((r) => (
                    <option key={r.account_id} value={r.account_id}>
                      {r.code} {r.name}
                    </option>
                  ))}
              </select>
              <Input
                type="number"
                step="0.01"
                placeholder="Debit"
                value={l.d}
                onChange={(e) =>
                  setLines(lines.map((x, j) => (j === i ? { ...x, d: e.target.value, c: "" } : x)))
                }
              />
              <Input
                type="number"
                step="0.01"
                placeholder="Credit"
                value={l.c}
                onChange={(e) =>
                  setLines(lines.map((x, j) => (j === i ? { ...x, c: e.target.value, d: "" } : x)))
                }
              />
            </div>
          ))}
          <div className="num flex items-center justify-between text-sm">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines([...lines, { a: "", d: "", c: "" }])}
            >
              Add line
            </Button>
            <span
              className={Math.abs(td - tc) < 0.01 && td > 0 ? "text-success" : "text-destructive"}
            >
              Dr {bdt(td)} / Cr {bdt(tc)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Cash, bank, customer due, supplier due and inventory update automatically from their own
            pages, so they are not listed here.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={create.isPending || Math.abs(td - tc) >= 0.01 || td <= 0}>
              Post entry
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
  const { data } = useQuery({
    queryKey: ["journal", biz, from, to],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("journal_entries")
        .select(
          "id,entry_no,entry_date,ref_type,memo,reversed_at,journal_lines(id,debit,credit,accounts(code,name))",
        )
        .eq("business_id", biz)
        .gte("entry_date", from)
        .lte("entry_date", to)
        .order("entry_no", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });
  if (!data?.length)
    return (
      <div>
        {newBtn}
        {dialog}
        <p className="p-6 text-sm text-muted-foreground">No journal entries in this period.</p>
      </div>
    );
  return (
    <div className="space-y-3">
      {newBtn}
      {dialog}
      {data.map((e) => (
        <div key={e.id} className="rounded-lg border bg-card">
          <div className="flex flex-wrap justify-between gap-2 border-b px-4 py-2 text-sm">
            <span>
              <span className="num text-muted-foreground">JE-{e.entry_no}</span> · {e.memo}
            </span>
            <span className="num text-muted-foreground">
              {e.entry_date} · <Badge variant="secondary">{e.ref_type.replace("_", " ")}</Badge>
              {e.reversed_at && (
                <Badge variant="outline" className="ml-1">
                  Reversed
                </Badge>
              )}
              {e.ref_type === "manual" && !e.reversed_at && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-1 h-7"
                  onClick={() => confirm("Reverse this entry?") && reverse.mutate(e.id)}
                >
                  <Undo2 className="mr-1 h-3.5 w-3.5" />
                  Reverse
                </Button>
              )}
            </span>
          </div>
          {e.journal_lines.map((l) => (
            <div key={l.id} className="num grid grid-cols-[1fr_120px_120px] px-4 py-1 text-sm">
              <span className={Number(l.credit) > 0 ? "pl-6" : ""}>
                {l.accounts?.code} {l.accounts?.name}
              </span>
              <span className="text-right">{Number(l.debit) > 0 ? bdt(l.debit) : ""}</span>
              <span className="text-right">{Number(l.credit) > 0 ? bdt(l.credit) : ""}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function COA({ biz, to }: { biz: string; to: string }) {
  const { data } = useTotals(biz, null, to);
  const qc = useQueryClient();
  const groups = ["asset", "liability", "equity", "revenue", "expense"];
  const [dlg, setDlg] = useState<null | { id?: string; code: string; name: string; type: string }>(
    null,
  );
  const sys = useQuery({
    queryKey: ["accounts-sys", biz],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id,is_system")
        .eq("business_id", biz);
      if (error) throw error;
      return new Set(data.filter((a) => !a.is_system).map((a) => a.id));
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      if (!dlg) return;
      const { error } = dlg.id
        ? await supabase.rpc("update_account", { _biz: biz, _id: dlg.id, _name: dlg.name })
        : await supabase.rpc("create_account", {
            _biz: biz,
            _code: dlg.code,
            _name: dlg.name,
            _type: dlg.type as "asset",
          });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Account saved");
      setDlg(null);
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_account", { _biz: biz, _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Account deleted");
      qc.invalidateQueries();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setDlg({ code: "", name: "", type: "expense" })}>
          <Plus className="mr-1 h-4 w-4" />
          New account
        </Button>
      </div>
      <Dialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dlg?.id ? "Rename account" : "New account"}</DialogTitle>
          </DialogHeader>
          {dlg && (
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
            >
              {!dlg.id && (
                <>
                  <F label="Code (4 digits) *">
                    <Input
                      value={dlg.code}
                      onChange={(e) => setDlg({ ...dlg, code: e.target.value })}
                    />
                  </F>
                  <F label="Type">
                    <select
                      className={selectCls}
                      value={dlg.type}
                      onChange={(e) => setDlg({ ...dlg, type: e.target.value })}
                    >
                      {groups.map((g) => (
                        <option key={g} value={g} className="capitalize">
                          {g}
                        </option>
                      ))}
                    </select>
                  </F>
                </>
              )}
              <F label="Name *" className="sm:col-span-2">
                <Input
                  value={dlg.name}
                  onChange={(e) => setDlg({ ...dlg, name: e.target.value })}
                />
              </F>
              <DialogFooter className="sm:col-span-2">
                <Button type="button" variant="outline" onClick={() => setDlg(null)}>
                  Cancel
                </Button>
                <Button disabled={save.isPending}>Save</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <div key={g} className="rounded-lg border bg-card">
            <div className="border-b px-4 py-2 text-sm font-semibold capitalize">
              {g === "liability" ? "Liabilities" : g + "s"}
            </div>
            {(data ?? [])
              .filter((r) => r.type === g)
              .map((r) => (
                <div
                  key={r.account_id}
                  className="num flex items-center justify-between gap-2 px-4 py-1.5 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-muted-foreground">{r.code}</span> {r.name}
                  </span>
                  {sys.data?.has(r.account_id) && (
                    <span className="flex">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label="Rename account"
                        onClick={() =>
                          setDlg({ id: r.account_id, code: r.code, name: r.name, type: r.type })
                        }
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label="Delete account"
                        onClick={() => confirm(`Delete ${r.name}?`) && del.mutate(r.account_id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </span>
                  )}
                  <span>{bdt(bal(r))}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
