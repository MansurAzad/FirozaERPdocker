import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { EntityManager } from "@/components/erp/EntityManager";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useCan } from "@/lib/business";
import { useI18n } from "@/lib/i18n";
import { BD_MOBILE, bdt } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/app/suppliers")({
  head: ({ matches }) => ({
    meta: [
      { title: `Suppliers — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Suppliers records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Suppliers — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Suppliers records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const { t } = useI18n();
  return (
    <EntityManager
      table="suppliers"
      rowActions={(r) => (
        <>
          <Button asChild size="sm" variant="ghost">
            <Link to="/app/ledger" search={{ kind: "supplier", party: String(r.id) }}>
              Ledger
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/app/purchases/new" search={{ supplier: String(r.id) }}>
              Buy
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/app/supplier-payments" search={{ supplier: String(r.id) }}>
              Pay
            </Link>
          </Button>
        </>
      )}
      title={t("suppliers")}
      sub="Distributors and importers you buy from."
      canWrite={useCan("suppliers")}
      canDelete={useCan("deleteParty")}
      searchKeys={["name", "company", "mobile"]}
      fields={[
        { key: "name", label: "Name", required: true },
        { key: "company", label: "Company" },
        { key: "contact_person", label: "Contact person" },
        {
          key: "mobile",
          label: "Mobile",
          required: true,
          pattern: BD_MOBILE,
          patternMsg: "Enter a valid Bangladesh mobile number (01XXXXXXXXX).",
          placeholder: "01XXXXXXXXX",
        },
        { key: "opening_payable", label: "Opening payable (৳)", type: "number" },
        { key: "credit_terms_days", label: "Credit terms (days)", type: "number" },
        {
          key: "status",
          label: "Status",
          type: "select",
          options: [
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ],
        },
        { key: "address", label: "Address" },
        { key: "bank_info", label: "Bank information", type: "textarea" },
        { key: "notes", label: "Notes", type: "textarea" },
      ]}
      columns={[
        {
          key: "name",
          label: "Name",
          render: (r) => (
            <div>
              <div className="font-medium">{r.name}</div>
              <div className="text-xs text-muted-foreground">{r.company}</div>
            </div>
          ),
        },
        { key: "mobile", label: "Mobile", className: "num" },
        { key: "credit_terms_days", label: "Terms", render: (r) => `${r.credit_terms_days} days` },
        {
          key: "opening_payable",
          label: t("supplierDue"),
          className: "num text-right",
          render: (r) => bdt(r.opening_payable),
        },
      ]}
    />
  );
}
