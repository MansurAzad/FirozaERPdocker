import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { guardianQuery } from "@/lib/guardian/queries";
import { useBusiness } from "@/lib/business";
import { GuardianNav } from "@/components/erp/GuardianNav";
import { PageHeader } from "@/components/erp/EntityManager";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { safeRecommendation } from "@/lib/guardian/safety";
import { makeXlsx, makePdf, download } from "@/lib/export";
import { friendlyError } from "@/lib/format";
export const Route = createFileRoute("/_authenticated/app/guardian-anomalies")({
  head: ({ matches }) => ({
    meta: [
      { title: `Anomaly Reports — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: "Daily, weekly and monthly financial risk evidence and consistency results.",
      },
      { property: "og:title", content: `Anomaly Reports — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: "Evidence-led Guardian anomalies, safe recommendations and exports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(guardianQuery(context.business.id)),
  component: AnomaliesPage,
});
function AnomaliesPage() {
  const { business } = useBusiness();
  const { data, refetch, isFetching } = useSuspenseQuery(guardianQuery(business.id));
  const [period, setPeriod] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [exporting, setExporting] = useState(false);
  const rows = useMemo(() => {
    const days = period === "day" ? 1 : period === "week" ? 7 : period === "month" ? 30 : Infinity;
    const since = new Date(data.checked_at).getTime() - days * 86400000;
    return data.alerts.filter(
      (a) =>
        (severity === "all" || a.severity === severity) &&
        (period === "all" || new Date(a.last_seen).getTime() >= since),
    );
  }, [data, period, severity]);
  async function output(kind: "pdf" | "xlsx") {
    setExporting(true);
    try {
      const s = {
        title: "Guardian anomaly report",
        subtitle: [
          data.company.name,
          `Checked ${data.checked_at}`,
          `Period ${period} · Severity ${severity}`,
        ],
        head: ["Severity", "Status", "Finding", "Evidence", "Last seen"],
        rows: rows.map((a) => [a.severity, a.status, a.title, a.detail ?? "", a.last_seen]),
        fileName: "guardian-anomalies",
      };
      download(await (kind === "pdf" ? makePdf(s) : makeXlsx(s)), `${s.fileName}.${kind}`);
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setExporting(false);
    }
  }
  return (
    <div>
      <GuardianNav />
      <PageHeader
        title="Anomaly reports"
        sub={`Current evidence · ${new Date(data.checked_at).toLocaleString("en-GB")}`}
        actions={
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw />
            Refresh
          </Button>
        }
      />
      <div className="mb-6 flex flex-wrap gap-3">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-44" aria-label="Report period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              [
                ["all", "All history"],
                ["day", "Last 24 hours"],
                ["week", "Last 7 days"],
                ["month", "Last 30 days"],
              ] as const
            ).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-40" aria-label="Severity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["all", "critical", "high", "medium", "low"].map((v) => (
              <SelectItem value={v} key={v}>
                {v === "all" ? "All severities" : v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" disabled={exporting} onClick={() => output("pdf")}>
          <Download />
          PDF
        </Button>
        <Button variant="outline" disabled={exporting} onClick={() => output("xlsx")}>
          <Download />
          Excel
        </Button>
      </div>
      <div className="mb-6 grid gap-px border bg-border sm:grid-cols-4">
        {[
          ["Findings", rows.length],
          ["Open", rows.filter((a) => a.status === "open").length],
          ["Historical auto-fixes", rows.filter((a) => a.status === "auto_fixed").length],
          ["Consistency discrepancies", data.checks.reduce((n, c) => n + c.issues, 0)],
        ].map(([l, v]) => (
          <div key={l} className="bg-background p-4">
            <p className="text-xs text-muted-foreground">{l}</p>
            <p className="mt-1 text-2xl font-semibold">{v}</p>
          </div>
        ))}
      </div>
      <div className="space-y-3">
        {rows.map((a) => (
          <article key={a.id} className="rounded-lg border bg-card p-5">
            <div className="flex flex-wrap gap-2">
              <Badge
                variant={
                  a.severity === "high" || a.severity === "critical" ? "destructive" : "secondary"
                }
              >
                {a.severity}
              </Badge>
              <Badge variant="outline">{a.status}</Badge>
              <h2 className="font-semibold">{a.title}</h2>
            </div>
            <p className="my-3 text-sm">{a.detail}</p>
            <p className="text-sm text-muted-foreground">{safeRecommendation(a.check_code)}</p>
            <div className="mt-4 flex gap-4 text-xs">
              <span>
                First {new Date(a.first_seen).toLocaleDateString("en-GB")} · Last{" "}
                {new Date(a.last_seen).toLocaleString("en-GB")}
              </span>
              {a.ref_type === "sale" && a.ref_id ? (
                <Link
                  className="text-primary underline"
                  to="/app/sales/$id"
                  params={{ id: a.ref_id }}
                >
                  Invoice
                </Link>
              ) : (
                <Link className="text-primary underline" to="/app/guardian">
                  Review alert
                </Link>
              )}
              <Link className="text-primary underline" to="/app/audit">
                Audit trail
              </Link>
            </div>
          </article>
        ))}
        {!rows.length && <p className="py-8 text-muted-foreground">No findings in this period.</p>}
      </div>
    </div>
  );
}
