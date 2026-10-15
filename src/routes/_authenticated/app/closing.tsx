import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { sendDailyReportNow } from "@/lib/daily-report.functions";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { useMoneyAccounts } from "@/lib/finance";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, selectCls, today } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/app/closing")({
  head: ({ matches }) => ({
    meta: [
      { title: `Daily Closing — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Daily Closing records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Daily Closing — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Daily Closing records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Closing,
});

function Closing() {
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const accounts = useMoneyAccounts(business.id);
  const cash = (accounts.data ?? []).filter((a) => a.kind === "cash");
  const [acc, setAcc] = useState("");
  const [date, setDate] = useState(today());
  const [actual, setActual] = useState("");
  const [note, setNote] = useState("");
  const account = acc || cash[0]?.id || "";
  const can = ["owner", "manager", "accountant", "branch_manager"].includes(role);

  const calc = useQuery({
    enabled: !!account,
    queryKey: ["closing-calc", account, date],
    queryFn: async () => {
      const [ma, t, h] = await Promise.all([
        supabase.from("money_accounts").select("opening_balance").eq("id", account).single(),
        supabase
          .from("money_transactions")
          .select("txn_date,direction,amount,kind")
          .eq("account_id", account)
          .lte("txn_date", date),
        supabase
          .from("daily_closings")
          .select("*")
          .eq("account_id", account)
          .order("closing_date", { ascending: false })
          .limit(30),
      ]);
      for (const x of [ma, t, h]) if (x.error) throw x.error;
      let opening = Number(ma.data!.opening_balance);
      const day: Record<string, number> = {};
      for (const r of t.data!) {
        const s = r.direction === "in" ? Number(r.amount) : -Number(r.amount);
        if (r.txn_date < date) opening += s;
        else day[r.kind] = (day[r.kind] ?? 0) + s;
      }
      return { opening, day, history: h.data! };
    },
  });
  const cin = Object.values(calc.data?.day ?? {})
    .filter((v) => v > 0)
    .reduce((a, b) => a + b, 0);
  const cout = -Object.values(calc.data?.day ?? {})
    .filter((v) => v < 0)
    .reduce((a, b) => a + b, 0);
  const expected = (calc.data?.opening ?? 0) + cin - cout;
  const variance = actual === "" ? 0 : Number(actual) - expected;
  const closed = calc.data?.history.find((h) => h.closing_date === date);

  const sendReport = useServerFn(sendDailyReportNow);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("close_day", {
        _biz: business.id,
        _account: account,
        _date: date,
        _actual: Number(actual),
        _note: note,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Day closed");
      sendReport({ data: { businessId: business.id, date } })
        .then((r) => r.sent > 0 && toast.success(`Daily report emailed (${r.sent})`))
        .catch((e) => toast.error(friendlyError(e)));
      setActual("");
      setNote("");
      qc.invalidateQueries({ queryKey: ["closing-calc"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const row = (l: string, v: number, strong = false) => (
    <div
      className={
        "num flex justify-between py-1 text-sm " + (strong ? "border-t pt-2 font-semibold" : "")
      }
    >
      <span>{l}</span>
      <span>{bdt(v)}</span>
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Daily Closing"
        sub="Count the cash drawer and compare with what the books expect."
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <F label="Cash account">
          <select className={selectCls} value={account} onChange={(e) => setAcc(e.target.value)}>
            {cash.map((a) => (
              <option key={a.id!} value={a.id!}>
                {a.name}
              </option>
            ))}
          </select>
        </F>
        <F label="Date">
          <Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </F>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-5">
          {row("Opening cash", calc.data?.opening ?? 0)}
          {Object.entries(calc.data?.day ?? {}).map(([k, v]) =>
            row(`${v > 0 ? "+" : "−"} ${k.replace(/_/g, " ")}`, Math.abs(v)),
          )}
          {row("Expected closing cash", expected, true)}
          {closed ? (
            <div className="mt-4 rounded-md bg-muted p-3 text-sm">
              Closed — counted {bdt(closed.actual)}, variance{" "}
              <span className={Number(closed.variance) === 0 ? "text-success" : "text-destructive"}>
                {bdt(closed.variance)}
              </span>
            </div>
          ) : (
            can && (
              <form
                className="mt-4 space-y-3 border-t pt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  save.mutate();
                }}
              >
                <F label="Actual cash counted (৳)">
                  <Input
                    type="number"
                    step="0.01"
                    value={actual}
                    onChange={(e) => setActual(e.target.value)}
                    className="num text-lg"
                  />
                </F>
                {actual !== "" && (
                  <div
                    className={
                      "num text-sm font-semibold " +
                      (Math.abs(variance) < 0.01 ? "text-success" : "text-destructive")
                    }
                  >
                    Variance: {bdt(variance)}{" "}
                    {variance > 0 ? "(excess)" : variance < 0 ? "(short)" : "(matched)"}
                  </div>
                )}
                <F label="Note">
                  <Input value={note} onChange={(e) => setNote(e.target.value)} />
                </F>
                <Button disabled={save.isPending || actual === ""}>Confirm closing</Button>
              </form>
            )
          )}
        </div>
        <div className="rounded-lg border bg-card">
          <div className="border-b p-3 text-sm font-semibold">Recent closings</div>
          {calc.error ? (
            <p className="p-4 text-sm text-destructive">{friendlyError(calc.error)}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Expected</TableHead>
                  <TableHead className="text-right">Actual</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calc.data?.history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="num">{h.closing_date}</TableCell>
                    <TableCell className="num text-right">{bdt(h.expected)}</TableCell>
                    <TableCell className="num text-right">{bdt(h.actual)}</TableCell>
                    <TableCell
                      className={
                        "num text-right " + (Number(h.variance) === 0 ? "" : "text-destructive")
                      }
                    >
                      {bdt(h.variance)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
