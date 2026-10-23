import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { sendDailyReportNow } from "@/lib/daily-report.functions";
import { useBusiness } from "@/lib/business";
import { hasAccess } from "@/lib/access-control";
import { bdt, friendlyError } from "@/lib/format";
import { useMoneyAccounts } from "@/lib/finance";
import { useBranches } from "@/lib/finance";
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
  const { business, role, access } = useBusiness();
  const qc = useQueryClient();
  const branches = useBranches(business.id);
  const centralRole = ["owner", "manager", "accountant"].includes(role);
  const branchAccess = useQuery({
    enabled: !centralRole,
    queryKey: ["closing-branch-access", business.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("partner_finance_branch_access")
        .select("branch_id")
        .eq("business_id", business.id);
      if (error) throw error;
      return data as { branch_id: string }[];
    },
  });
  const accessibleBranches = (branches.data ?? []).filter(
    (branch) =>
      branch.kind === "branch" &&
      (centralRole || (branchAccess.data ?? []).some((item) => item.branch_id === branch.id)),
  );
  const accounts = useMoneyAccounts(business.id);
  const [branchId, setBranchId] = useState("");
  const [acc, setAcc] = useState("");
  const [date, setDate] = useState(today());
  const [actual, setActual] = useState("");
  const [note, setNote] = useState("");
  const [differenceReason, setDifferenceReason] = useState("");
  const branch = accessibleBranches.some((item) => item.id === branchId)
    ? branchId
    : (accessibleBranches[0]?.id ?? "");
  const cash = (accounts.data ?? []).filter(
    (account) =>
      account.kind === "cash" &&
      (account.branch_id === branch || (!account.branch_id && centralRole)),
  );
  const account = cash.some((item) => item.id === acc) ? acc : (cash[0]?.id ?? "");
  const can =
    ["owner", "manager", "accountant", "branch_manager"].includes(role) &&
    hasAccess(access, "closing", "create");
  const canReview = centralRole && hasAccess(access, "closing", "approve");

  const calc = useQuery({
    enabled: !!account && !!branch,
    queryKey: ["closing-calc", account, branch, date],
    queryFn: async () => {
      const transactionQuery = supabase
        .from("money_transactions")
        .select("txn_date,direction,amount,kind,branch_id")
        .eq("account_id", account)
        .lte("txn_date", date);
      if (cash.find((item) => item.id === account)?.branch_id === branch) {
        transactionQuery.or(`branch_id.eq.${branch},branch_id.is.null`);
      } else {
        transactionQuery.eq("branch_id", branch);
      }
      const [ma, t, h] = await Promise.all([
        supabase
          .from("money_accounts")
          .select("opening_balance,branch_id")
          .eq("id", account)
          .single(),
        transactionQuery,
        supabase
          .from("daily_closings")
          .select("*")
          .eq("account_id", account)
          .eq("branch_id", branch)
          .order("closing_date", { ascending: false })
          .limit(30),
      ]);
      for (const x of [ma, t, h]) if (x.error) throw x.error;
      const priorClose = h.data!.find((closing) => closing.closing_date < date);
      let opening = priorClose
        ? Number(priorClose.actual)
        : ma.data!.branch_id === branch
          ? Number(ma.data!.opening_balance)
          : 0;
      const day: Record<string, number> = {};
      for (const r of t.data!) {
        const s = r.direction === "in" ? Number(r.amount) : -Number(r.amount);
        if (r.txn_date < date && (!priorClose || r.txn_date > priorClose.closing_date))
          opening += s;
        else day[r.kind] = (day[r.kind] ?? 0) + s;
      }
      return { opening, day, history: h.data! };
    },
  });
  const dailyCollections = useQuery({
    enabled: !!branch,
    queryKey: ["closing-collections", business.id, branch, date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("money_transactions")
        .select("amount,direction,kind,method")
        .eq("business_id", business.id)
        .eq("branch_id", branch)
        .eq("txn_date", date);
      if (error) throw error;
      return data ?? [];
    },
  });
  const cashCollection = (dailyCollections.data ?? []).reduce(
    (sum, item) =>
      sum + (item.direction === "in" && item.method === "cash" ? Number(item.amount) : 0),
    0,
  );
  const bankCollection = (dailyCollections.data ?? []).reduce(
    (sum, item) =>
      sum + (item.direction === "in" && item.method === "bank" ? Number(item.amount) : 0),
    0,
  );
  const mfsCollection = (dailyCollections.data ?? []).reduce(
    (sum, item) =>
      sum +
      (item.direction === "in" && ["bkash", "nagad", "rocket"].includes(item.method ?? "")
        ? Number(item.amount)
        : 0),
    0,
  );
  const refundTotal = (dailyCollections.data ?? []).reduce(
    (sum, item) =>
      sum +
      (item.direction === "out" && (item.kind.includes("refund") || item.kind.includes("reversal"))
        ? Number(item.amount)
        : 0),
    0,
  );
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
        _branch: branch,
        _account: account,
        _date: date,
        _actual: Number(actual),
        _note: note,
        _difference_reason: differenceReason,
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
      setDifferenceReason("");
      qc.invalidateQueries({ queryKey: ["closing-calc"] });
      qc.invalidateQueries({ queryKey: ["closing-collections"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const reviewClosing = useMutation({
    mutationFn: async (closingId: string) => {
      const { error } = await supabase.rpc("review_daily_closing", {
        _biz: business.id,
        _closing: closingId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Cash difference reviewed");
      qc.invalidateQueries({ queryKey: ["closing-calc"] });
    },
    onError: (error) => toast.error(friendlyError(error)),
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
        <F label="Brand shop">
          <select
            className={selectCls}
            value={branch}
            onChange={(event) => {
              setBranchId(event.target.value);
              setAcc("");
            }}
            disabled={!accessibleBranches.length}
          >
            {accessibleBranches.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </F>
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
      {!accessibleBranches.length &&
        !branchAccess.isLoading &&
        !branchAccess.error &&
        !branches.error && (
          <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            No brand shops are assigned to your account for daily closing.
          </p>
        )}
      {(branches.error || branchAccess.error || accounts.error) && (
        <p className="mb-4 text-sm text-destructive">
          {friendlyError(branches.error ?? branchAccess.error ?? accounts.error)}
        </p>
      )}
      {!!branch && !cash.length && !accounts.isLoading && !accounts.error && (
        <p className="mb-4 text-sm text-destructive">
          No active cash account is assigned to this shop. Configure one before closing the day.
        </p>
      )}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Cash collected", cashCollection],
          ["Bank collected", bankCollection],
          ["MFS collected", mfsCollection],
          ["Refunds", refundTotal],
        ].map(([label, amount]) => (
          <div key={label} className="rounded-lg border bg-card p-4">
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="num mt-1 text-lg font-semibold">{bdt(Number(amount))}</div>
          </div>
        ))}
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
              <div className="mt-1">
                Status: {closed.closing_status.replace(/_/g, " ")}
                {closed.difference_reason && (
                  <p className="mt-1 text-muted-foreground">
                    Difference reason: {closed.difference_reason}
                  </p>
                )}
                <p className="mt-1 text-muted-foreground">
                  Prepared by {closed.prepared_by?.slice(0, 8) ?? "—"}
                  {closed.reviewed_by ? ` · Reviewed by ${closed.reviewed_by.slice(0, 8)}` : ""}
                </p>
              </div>
              {closed.closing_status === "pending_review" && canReview && (
                <Button
                  className="mt-3"
                  size="sm"
                  disabled={reviewClosing.isPending}
                  onClick={() => reviewClosing.mutate(closed.id)}
                >
                  Review cash difference
                </Button>
              )}
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
                {actual !== "" && Math.abs(variance) >= 0.01 && (
                  <F label="Reason for cash difference (required)">
                    <Input
                      value={differenceReason}
                      onChange={(event) => setDifferenceReason(event.target.value)}
                      minLength={3}
                      required
                    />
                  </F>
                )}
                <F label="Note">
                  <Input value={note} onChange={(e) => setNote(e.target.value)} />
                </F>
                <Button
                  disabled={
                    save.isPending ||
                    actual === "" ||
                    Number(actual) < 0 ||
                    (Math.abs(variance) >= 0.01 && differenceReason.trim().length < 3)
                  }
                >
                  Confirm closing
                </Button>
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
                  <TableHead>Status</TableHead>
                  <TableHead>Prepared by</TableHead>
                  <TableHead>Reviewed by</TableHead>
                  <TableHead>Review</TableHead>
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
                    <TableCell className="capitalize">
                      {h.closing_status.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell>{h.prepared_by?.slice(0, 8) ?? "—"}</TableCell>
                    <TableCell>{h.reviewed_by?.slice(0, 8) ?? "—"}</TableCell>
                    <TableCell>
                      {h.closing_status === "pending_review" && canReview ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={reviewClosing.isPending}
                          onClick={() => reviewClosing.mutate(h.id)}
                        >
                          Review
                        </Button>
                      ) : (
                        (h.difference_reason ?? "—")
                      )}
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
