import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useState } from "react";
import { addDays, format, parseISO, startOfDay, subDays } from "date-fns";
import { toast } from "sonner";
import { Download, Eye, Printer } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { useI18n } from "@/lib/i18n";
import { friendlyError } from "@/lib/format";
import { download } from "@/lib/export";
import { ACCESS_MODULES } from "@/lib/access-control";
import { PageHeader } from "@/components/erp/EntityManager";
import { Badge } from "@/components/ui/badge";
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
import type { Database, Json } from "@/integrations/supabase/types";

type AuditEntry = Database["public"]["Tables"]["audit_logs"]["Row"];

const PAGE_SIZE = 50;
const EXPORT_BATCH_SIZE = 1000;
const SECRET_FIELD = /password|token|secret|credential|api[_-]?key|private[_-]?key/i;

function localDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function auditRange(from: string, through: string) {
  return {
    from: startOfDay(parseISO(from)).toISOString(),
    to: startOfDay(addDays(parseISO(through), 1)).toISOString(),
  };
}

function moduleLabel(module: string) {
  return (
    ACCESS_MODULES.find(({ key }) => key === module)?.label ??
    module.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

function redact(value: Json | null): Json | null {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item) ?? null);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SECRET_FIELD.test(key) ? "[REDACTED]" : (redact(item ?? null) ?? null),
    ]),
  );
}

function jsonText(value: Json | null) {
  const safeValue = redact(value);
  return safeValue === null ? "—" : JSON.stringify(safeValue, null, 2);
}

function changedFields(entry: AuditEntry) {
  const oldValue = (redact(entry.old_value) as Record<string, Json> | null) ?? {};
  const newValue = (redact(entry.new_value) as Record<string, Json> | null) ?? {};
  const keys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);
  return [...keys]
    .filter((key) => JSON.stringify(oldValue[key]) !== JSON.stringify(newValue[key]))
    .map((key) => ({
      field: key,
      oldValue: key in oldValue ? JSON.stringify(oldValue[key], null, 2) : "—",
      newValue: key in newValue ? JSON.stringify(newValue[key], null, 2) : "—",
    }));
}

function csvCell(value: string) {
  const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function csvReport(rows: AuditEntry[]) {
  const headings = [
    "Date and time",
    "User",
    "Role",
    "Page / module",
    "Source table",
    "Action",
    "Record ID",
    "Previous values",
    "Updated values",
  ];
  const lines = rows.map((row) => [
    new Date(row.created_at).toLocaleString("en-GB"),
    row.actor_name ?? row.user_id ?? "System",
    row.actor_role ?? "",
    moduleLabel(row.module),
    row.source_table ?? row.module,
    row.action,
    row.record_id ?? "",
    JSON.stringify(redact(row.old_value)),
    JSON.stringify(redact(row.new_value)),
  ]);
  return `\uFEFF${[headings, ...lines].map((line) => line.map(csvCell).join(",")).join("\r\n")}`;
}

function htmlText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function loadAuditReport(businessId: string, from: string, through: string) {
  const range = auditRange(from, through);
  const rows: AuditEntry[] = [];

  for (let offset = 0; ; offset += EXPORT_BATCH_SIZE) {
    const { data, error } = await supabase
      .from("audit_logs")
      .select("*")
      .eq("business_id", businessId)
      .gte("created_at", range.from)
      .lt("created_at", range.to)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + EXPORT_BATCH_SIZE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < EXPORT_BATCH_SIZE) return rows;
  }
}

function printReport(
  printWindow: Window,
  rows: AuditEntry[],
  businessName: string,
  from: string,
  through: string,
) {
  const body = rows
    .map((row) => {
      const oldValue = htmlText(jsonText(row.old_value));
      const newValue = htmlText(jsonText(row.new_value));
      return `<tr>
        <td>${htmlText(new Date(row.created_at).toLocaleString("en-GB"))}</td>
        <td>${htmlText(row.actor_name ?? row.user_id ?? "System")}<br><small>${htmlText(row.actor_role ?? "")}</small></td>
        <td>${htmlText(moduleLabel(row.module))}<br><small>${htmlText(row.source_table ?? row.module)}</small></td>
        <td>${htmlText(row.action)}</td>
        <td>${htmlText(row.record_id ?? "—")}</td>
        <td><strong>Before</strong><pre>${oldValue}</pre><strong>After</strong><pre>${newValue}</pre></td>
      </tr>`;
    })
    .join("");

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><title>Audit report</title>
    <style>
      body{font:12px Arial,sans-serif;color:#111;padding:24px}
      h1{font-size:20px;margin:0 0 8px}p{margin:0 0 18px;color:#444}
      table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:6px;text-align:left;vertical-align:top}
      th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:10px monospace;margin:4px 0 12px}
      small{color:#555}@media print{body{padding:0}tr{break-inside:avoid}}
    </style></head><body>
    <h1>${htmlText(businessName)} — Audit report</h1>
    <p>${htmlText(from)} to ${htmlText(through)} · ${rows.length} records</p>
    <table><thead><tr><th>Date / time</th><th>User / role</th><th>Page / source</th><th>Action</th><th>Record ID</th><th>Changed values</th></tr></thead>
    <tbody>${body || '<tr><td colspan="6">No records found</td></tr>'}</tbody></table>
    </body></html>`);
  printWindow.document.close();
  window.setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 250);
}

function pageNumbers(current: number, total: number) {
  const first = Math.max(1, Math.min(current - 2, total - 4));
  const last = Math.min(total, first + 4);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index);
}

export const Route = createFileRoute("/_authenticated/app/audit")({
  head: ({ matches }) => ({
    meta: [
      { title: `Audit Log — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Audit Log records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Audit Log — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Audit Log records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuditPage,
});

function AuditPage() {
  const { business } = useBusiness();
  const { t } = useI18n();
  const [from, setFrom] = useState(() => localDate(subDays(new Date(), 29)));
  const [through, setThrough] = useState(() => localDate(new Date()));
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [busy, setBusy] = useState<"export" | "print" | null>(null);
  const validRange = Boolean(from && through && from <= through);
  const bounds = validRange ? auditRange(from, through) : null;
  const { data, error, isPending } = useQuery({
    queryKey: ["audit", business.id, from, through, page],
    enabled: validRange,
    queryFn: async () => {
      if (!bounds) return { rows: [], count: 0 };
      const { data, error, count } = await supabase
        .from("audit_logs")
        .select("*", { count: "exact" })
        .eq("business_id", business.id)
        .gte("created_at", bounds.from)
        .lt("created_at", bounds.to)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: data, count: count ?? 0 };
    },
  });
  const pageCount = Math.ceil((data?.count ?? 0) / PAGE_SIZE);

  useEffect(() => {
    if (pageCount > 0 && page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  async function exportReport() {
    setBusy("export");
    try {
      const rows = await loadAuditReport(business.id, from, through);
      download(
        new Blob([csvReport(rows)], { type: "text/csv;charset=utf-8" }),
        `audit-report-${from}-to-${through}.csv`,
      );
      toast.success(`Exported ${rows.length} audit records.`);
    } catch (cause) {
      toast.error(friendlyError(cause));
    } finally {
      setBusy(null);
    }
  }

  async function printFilteredReport() {
    const printWindow = window.open("", "_blank", "width=1100,height=800");
    if (!printWindow) {
      toast.error("Allow pop-ups to open the printable audit report.");
      return;
    }
    setBusy("print");
    try {
      const rows = await loadAuditReport(business.id, from, through);
      printReport(printWindow, rows, business.name, from, through);
    } catch (cause) {
      printWindow.close();
      toast.error(friendlyError(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader
        title={t("audit")}
        sub="৩০ দিনের বিস্তারিত কার্যক্রম · User, time, page, action and field-by-field changes."
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button
              type="button"
              variant="outline"
              onClick={() => void exportReport()}
              disabled={!validRange || busy !== null}
            >
              <Download />
              {busy === "export" ? "Exporting…" : "Export CSV"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void printFilteredReport()}
              disabled={!validRange || busy !== null}
            >
              <Printer />
              {busy === "print" ? "Preparing…" : "Print report"}
            </Button>
          </div>
        }
      />

      <section className="mb-4 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end print:hidden">
        <label className="space-y-1 text-sm">
          <span>From date</span>
          <Input
            type="date"
            value={from}
            max={through || undefined}
            onChange={(event) => {
              setFrom(event.currentTarget.value);
              setPage(1);
            }}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>To date</span>
          <Input
            type="date"
            value={through}
            min={from || undefined}
            onChange={(event) => {
              setThrough(event.currentTarget.value);
              setPage(1);
            }}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Data is retained for at least 30 days. Changes are recorded automatically.
        </p>
      </section>

      {!validRange ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-destructive">
          Select a valid date range.
        </p>
      ) : error ? (
        <p className="rounded-lg border bg-card p-6 text-sm text-destructive">
          {friendlyError(error)}
        </p>
      ) : (
        <>
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date &amp; time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Where / source</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead>Changes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isPending ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      Loading audit report…
                    </TableCell>
                  </TableRow>
                ) : data?.rows.length ? (
                  data.rows.map((entry) => {
                    const expanded = expandedId === entry.id;
                    const changes = changedFields(entry);
                    return (
                      <Fragment key={entry.id}>
                        <TableRow key={entry.id}>
                          <TableCell className="num whitespace-nowrap text-xs">
                            {new Date(entry.created_at).toLocaleString("en-GB")}
                          </TableCell>
                          <TableCell className="min-w-32">
                            <div className="font-medium">
                              {entry.actor_name ?? entry.user_id ?? "System"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {entry.actor_role ?? (entry.user_id ? "Previous member" : "System")}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div>{moduleLabel(entry.module)}</div>
                            <div className="text-xs text-muted-foreground">
                              {entry.source_table ?? entry.module}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={entry.action === "delete" ? "destructive" : "secondary"}
                            >
                              {entry.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-40 break-all font-mono text-xs">
                            {entry.record_id ?? "—"}
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-expanded={expanded}
                              onClick={() => setExpandedId(expanded ? null : entry.id)}
                            >
                              <Eye />
                              {expanded ? "Hide" : "View"}
                            </Button>
                          </TableCell>
                        </TableRow>
                        {expanded && (
                          <TableRow key={`${entry.id}-details`}>
                            <TableCell colSpan={6} className="bg-muted/40">
                              <div className="space-y-3">
                                <p className="text-sm font-medium">
                                  {entry.action} · {entry.source_table ?? entry.module} ·{" "}
                                  {entry.record_id ?? "Record ID unavailable"}
                                </p>
                                {changes.length ? (
                                  <div className="space-y-2">
                                    {changes.map((change) => (
                                      <div
                                        key={change.field}
                                        className="grid gap-2 rounded-md border bg-card p-3 sm:grid-cols-[minmax(100px,0.5fr)_1fr_1fr]"
                                      >
                                        <strong className="break-all text-sm">
                                          {change.field.replaceAll("_", " ")}
                                        </strong>
                                        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all text-xs">
                                          <span className="font-semibold">Before: </span>
                                          {change.oldValue}
                                        </pre>
                                        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all text-xs">
                                          <span className="font-semibold">After: </span>
                                          {change.newValue}
                                        </pre>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-card p-3 text-xs">
                                      <strong>Before</strong>
                                      {"\n"}
                                      {jsonText(entry.old_value)}
                                    </pre>
                                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-card p-3 text-xs">
                                      <strong>After</strong>
                                      {"\n"}
                                      {jsonText(entry.new_value)}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      No audit records found for this date range.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row print:hidden">
            <p className="text-sm text-muted-foreground">
              {data?.count
                ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, data.count)} of ${data.count}`
                : "0 records"}
            </p>
            {pageCount > 1 && (
              <nav aria-label="Audit report pages" className="flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => current - 1)}
                >
                  Previous
                </Button>
                {pageNumbers(page, pageCount).map((pageNumber) => (
                  <Button
                    key={pageNumber}
                    type="button"
                    variant={pageNumber === page ? "default" : "outline"}
                    size="sm"
                    aria-current={pageNumber === page ? "page" : undefined}
                    onClick={() => setPage(pageNumber)}
                  >
                    {pageNumber}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </Button>
              </nav>
            )}
          </div>
        </>
      )}
    </div>
  );
}
