import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ShieldAlert, RefreshCw, CheckCircle2, Wand2, EyeOff, Undo2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { GuardianNav } from "@/components/erp/GuardianNav";

export const Route = createFileRoute("/_authenticated/app/guardian")({
  head: ({ matches }) => ({
    meta: [
      { title: `Owner Guardian — ${matchedCompany(matches)}` },
      {
        name: "description",
        content:
          "Automatic checks for losses, stock mismatches, unbalanced accounts, overdue dues and unusual expenses.",
      },
      { property: "og:title", content: `Owner Guardian — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: "Always-on business checks and alerts for the owner.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GuardianPage,
});

const SEV = { critical: 0, high: 1, medium: 2, low: 3 } as const;
const SEV_STYLE: Record<string, string> = {
  critical: "border-l-destructive bg-destructive/5",
  high: "border-l-destructive/70",
  medium: "border-l-amber-500",
  low: "border-l-muted-foreground/40",
};

function linkFor(a: { ref_type: string | null; ref_id: string | null }) {
  if (!a.ref_id) return null;
  switch (a.ref_type) {
    case "sale":
      return (
        <Link
          to="/app/sales/$id"
          params={{ id: a.ref_id }}
          className="text-xs font-medium text-primary hover:underline"
        >
          Open invoice →
        </Link>
      );
    case "customer":
      return (
        <Link
          to="/app/ledger"
          search={{ kind: "customer", party: a.ref_id } as never}
          className="text-xs font-medium text-primary hover:underline"
        >
          Customer ledger →
        </Link>
      );
    case "supplier":
      return (
        <Link
          to="/app/ledger"
          search={{ kind: "supplier", party: a.ref_id } as never}
          className="text-xs font-medium text-primary hover:underline"
        >
          Supplier ledger →
        </Link>
      );
    case "variant":
      return (
        <Link to="/app/stock" className="text-xs font-medium text-primary hover:underline">
          Stock →
        </Link>
      );
    case "money_account":
      return (
        <Link to="/app/money" className="text-xs font-medium text-primary hover:underline">
          Cash & Bank →
        </Link>
      );
    case "expense":
      return (
        <Link to="/app/expenses" className="text-xs font-medium text-primary hover:underline">
          Expenses →
        </Link>
      );
    case "journal":
      return (
        <Link to="/app/accounting" className="text-xs font-medium text-primary hover:underline">
          Accounting →
        </Link>
      );
    case "imei":
      return (
        <Link to="/app/imei" className="text-xs font-medium text-primary hover:underline">
          IMEI Search →
        </Link>
      );
    default:
      return null;
  }
}

function GuardianPage() {
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"open" | "auto_fixed" | "closed">("open");
  const canRun = ["owner", "manager", "accountant"].includes(role);
  const canEdit = ["owner", "manager"].includes(role);

  const { data, error } = useQuery({
    queryKey: ["guardian", business.id],
    queryFn: async () => {
      const [a, r] = await Promise.all([
        supabase
          .from("guardian_alerts")
          .select("*")
          .eq("business_id", business.id)
          .order("last_seen", { ascending: false })
          .limit(500),
        supabase
          .from("guardian_runs")
          .select("last_run")
          .eq("business_id", business.id)
          .maybeSingle(),
      ]);
      if (a.error) throw a.error;
      if (r.error) throw r.error;
      return { alerts: a.data, lastRun: r.data?.last_run };
    },
  });

  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("run_guardian_checks", { _biz: business.id });
      if (error) throw error;
      return data as { open: number; auto_fixed_now: number };
    },
    onSuccess: (d) => {
      toast.success(
        `Checks done · ${d.open} open issue(s)${d.auto_fixed_now ? ` · ${d.auto_fixed_now} fixed automatically` : ""}`,
      );
      qc.invalidateQueries({ queryKey: ["guardian", business.id] });
      qc.invalidateQueries({ queryKey: ["guardian-count", business.id] });
      qc.invalidateQueries({ queryKey: ["guardian-snapshot", business.id] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "open" | "dismissed" }) => {
      const { error } = await supabase.rpc("set_guardian_alert", {
        _biz: business.id,
        _id: id,
        _status: status,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["guardian", business.id] });
      qc.invalidateQueries({ queryKey: ["guardian-count", business.id] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const alerts = data?.alerts ?? [];
  const open = alerts
    .filter((a) => a.status === "open")
    .sort((x, y) => SEV[x.severity as keyof typeof SEV] - SEV[y.severity as keyof typeof SEV]);
  const shown =
    tab === "open"
      ? open
      : alerts.filter((a) =>
          tab === "auto_fixed"
            ? a.status === "auto_fixed"
            : a.status === "resolved" || a.status === "dismissed",
        );
  const count = (s: string) => open.filter((a) => a.severity === s).length;

  return (
    <div className="space-y-6">
      <GuardianNav />
      <PageHeader
        title="Owner Guardian"
        sub="Checks your whole business automatically every hour and alerts you to mistakes and risks."
        actions={
          canRun && (
            <Button onClick={() => run.mutate()} disabled={run.isPending}>
              <RefreshCw className={cn("mr-1 h-4 w-4", run.isPending && "animate-spin")} />
              Check now
            </Button>
          )
        }
      />

      <div className="grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 lg:grid-cols-5">
        {[
          ["Critical", count("critical"), "text-destructive"],
          ["High", count("high"), "text-destructive"],
          ["Medium", count("medium"), "text-amber-600"],
          ["Low", count("low"), "text-muted-foreground"],
          [
            "Fixed automatically",
            alerts.filter((a) => a.status === "auto_fixed").length,
            "text-primary",
          ],
        ].map(([l, v, c]) => (
          <div key={l as string} className="min-w-0 overflow-hidden bg-card p-3 sm:p-4">
            <div className="break-words text-xs font-medium uppercase text-muted-foreground">
              {l}
            </div>
            <div
              className={cn(
                "num mt-1 break-words font-display text-xl font-semibold sm:text-2xl",
                c as string,
              )}
            >
              {v as number}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Last check: {data?.lastRun ? new Date(data.lastRun).toLocaleString("en-GB") : "never"} ·
        Problems that get corrected close on their own at the next check.
      </p>

      <div className="flex gap-1 rounded-md border bg-secondary p-1 text-sm w-fit">
        {(
          [
            ["open", `Open (${open.length})`],
            ["auto_fixed", "Auto-fixed"],
            ["closed", "Closed"],
          ] as const
        ).map(([k, l]) => (
          <Button
            key={k}
            size="sm"
            variant="ghost"
            onClick={() => setTab(k)}
            className={cn("h-8", tab === k && "bg-card shadow-sm hover:bg-card")}
          >
            {l}
          </Button>
        ))}
      </div>

      {error ? (
        <p className="text-sm text-destructive">{friendlyError(error)}</p>
      ) : !shown.length ? (
        <div className="rounded-lg border bg-card p-10 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-primary" />
          <p className="mt-2 text-sm text-muted-foreground">
            {tab === "open"
              ? "No open issues. Everything checked looks correct."
              : "Nothing here yet."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((a) => (
            <div
              key={a.id}
              className={cn(
                "flex flex-wrap items-start gap-3 rounded-lg border border-l-4 bg-card p-4 shadow-sm",
                SEV_STYLE[a.severity],
              )}
            >
              {a.status === "auto_fixed" ? (
                <Wand2 className="mt-0.5 h-4 w-4 text-primary" />
              ) : (
                <ShieldAlert className="mt-0.5 h-4 w-4 text-destructive" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{a.title}</span>
                  <Badge
                    variant={
                      a.severity === "critical" || a.severity === "high"
                        ? "destructive"
                        : "secondary"
                    }
                    className="text-[10px] uppercase"
                  >
                    {a.severity}
                  </Badge>
                  {a.status !== "open" && (
                    <Badge variant="outline" className="text-[10px]">
                      {a.status.replace("_", " ")}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{a.detail}</p>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  <span>First seen {new Date(a.first_seen).toLocaleDateString("en-GB")}</span>
                  {linkFor(a)}
                </div>
              </div>
              {canEdit && a.status === "open" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setStatus.mutate({ id: a.id, status: "dismissed" })}
                >
                  <EyeOff className="mr-1 h-3.5 w-3.5" />
                  Ignore
                </Button>
              )}
              {canEdit && a.status === "dismissed" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setStatus.mutate({ id: a.id, status: "open" })}
                >
                  <Undo2 className="mr-1 h-3.5 w-3.5" />
                  Reopen
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
