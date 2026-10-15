import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { EntityManager } from "@/components/erp/EntityManager";
import { useCan } from "@/lib/business";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/app/categories")({
  head: ({ matches }) => ({
    meta: [
      { title: `Categories — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Categories records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Categories — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Categories records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const { t } = useI18n();
  const can = useCan("catalog");
  return (
    <EntityManager
      table="categories"
      title={t("categories")}
      sub="IMEI-tracked categories require an IMEI for every unit."
      orderBy="name"
      canWrite={can}
      canDelete={can}
      searchKeys={["name"]}
      fields={[
        { key: "name", label: "Category name", required: true },
        {
          key: "is_serialized",
          label: "Track by IMEI / serial?",
          type: "select",
          options: [
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ],
        },
      ]}
      columns={[
        { key: "name", label: "Category" },
        {
          key: "is_serialized",
          label: "Tracking",
          render: (r) =>
            r.is_serialized ? <Badge>IMEI</Badge> : <Badge variant="secondary">Quantity</Badge>,
        },
      ]}
    />
  );
}
