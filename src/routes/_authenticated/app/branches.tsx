import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { EntityManager } from "@/components/erp/EntityManager";
import { useCan } from "@/lib/business";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/app/branches")({
  validateSearch: (search: Record<string, unknown>) => ({
    branch: typeof search["branch"] === "string" ? search["branch"] : undefined,
  }),
  head: ({ matches }) => ({
    meta: [
      { title: `Branches — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Branches records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Branches — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Branches records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const KINDS = [
  { value: "branch", label: "Branch / Shop" },
  { value: "warehouse", label: "Warehouse" },
  { value: "head", label: "Head Office" },
];

function Page() {
  const { branch } = Route.useSearch();
  const { t } = useI18n();
  const can = useCan("branches");
  return (
    <EntityManager
      table="branches"
      key={branch ?? "all"}
      initialSearch={branch ?? ""}
      rowActions={(r) => <Button asChild size="sm" variant="ghost"><Link to="/app/brand-shops" search={{ branch: r.id }}>Accounts</Link></Button>}
      title={t("branches")}
      sub="Head office, shops and warehouses."
      orderBy="name"
      canWrite={can}
      canDelete={can}
      searchKeys={["name", "address", "id"]}
      fields={[
        { key: "name", label: "Name", required: true },
        { key: "kind", label: "Type", type: "select", options: KINDS },
        { key: "phone", label: "Phone" },
        {
          key: "status",
          label: "Status",
          type: "select",
          options: [
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ],
        },
        { key: "address", label: "Address", full: true },
      ]}
      columns={[
        { key: "name", label: "Name" },
        {
          key: "kind",
          label: "Type",
          render: (r) => (
            <Badge variant="secondary">{KINDS.find((k) => k.value === r.kind)?.label}</Badge>
          ),
        },
        { key: "address", label: "Address" },
        { key: "status", label: "Status" },
      ]}
    />
  );
}
