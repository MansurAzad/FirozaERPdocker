import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { useI18n } from "@/lib/i18n";
import { friendlyError } from "@/lib/format";
import { PageHeader } from "@/components/erp/EntityManager";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

function summary(r: { new_value: unknown; old_value: unknown }) {
  const value = r.new_value ?? r.old_value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const details = value as Record<string, unknown>;
  const summaryValue = details["name"] ?? details["model"] ?? details["sku"];
  return typeof summaryValue === "string" || typeof summaryValue === "number"
    ? String(summaryValue)
    : "";
}

function AuditPage() {
  const { business } = useBusiness();
  const { t } = useI18n();
  const { data, error } = useQuery({
    queryKey: ["audit", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("business_id", business.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });
  return (
    <div>
      <PageHeader
        title={t("audit")}
        sub="Every change is recorded automatically. Visible to owner, manager and accountant."
      />
      <div className="rounded-lg border bg-card">
        {error ? (
          <p className="p-6 text-sm text-destructive">{friendlyError(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Record</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="num text-xs">
                    {new Date(r.created_at).toLocaleString("en-GB")}
                  </TableCell>
                  <TableCell>{r.module.replace("_", " ")}</TableCell>
                  <TableCell>
                    <Badge variant={r.action === "delete" ? "destructive" : "secondary"}>
                      {r.action}
                    </Badge>
                  </TableCell>
                  <TableCell>{summary(r)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
