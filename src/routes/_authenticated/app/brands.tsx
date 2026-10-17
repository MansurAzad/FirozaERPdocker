import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { EntityManager } from "@/components/erp/EntityManager";
import { useCan } from "@/lib/business";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/brands")({
  head: ({ matches }) => ({
    meta: [
      { title: `Brands — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Brands records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Brands — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Brands records and business operations in ${matchedCompany(matches)}.`,
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
  const canCreate = useCan("catalog", "create");
  const canEdit = useCan("catalog", "edit");
  return (
    <EntityManager
      table="brands"
      title={t("brands")}
      sub="Samsung, Apple, Xiaomi…"
      orderBy="name"
      canWrite={can}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={can}
      searchKeys={["name"]}
      fields={[{ key: "name", label: "Brand name", required: true, full: true }]}
      columns={[{ key: "name", label: "Brand" }]}
    />
  );
}
