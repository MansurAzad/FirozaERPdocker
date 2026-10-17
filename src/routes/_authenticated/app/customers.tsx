import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { EntityManager } from "@/components/erp/EntityManager";
import { useCan } from "@/lib/business";
import { useI18n } from "@/lib/i18n";
import { BD_MOBILE, bdt } from "@/lib/format";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/app/customers")({
  head: ({ matches }) => ({
    meta: [
      { title: `Customers — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Customers records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `Customers — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `Customers records and business operations in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

const TYPES = (
  [
    ["retail", "Retail Customer"],
    ["retail_shop", "Retail Shop"],
    ["wholesale_dealer", "Wholesale Dealer"],
    ["sub_dealer", "Sub Dealer"],
    ["corporate", "Corporate Customer"],
    ["vip", "VIP Customer"],
  ] as [string, string][]
).map(([value, label]) => ({ value, label }));
const LEVELS = (
  [
    ["retail", "Retail Price"],
    ["wholesale", "Wholesale Price"],
    ["dealer", "Dealer Price"],
    ["special", "Special Price"],
  ] as [string, string][]
).map(([value, label]) => ({ value, label }));
const label = (arr: { value: string; label: string }[], v: string) =>
  arr.find((x) => x.value === v)?.label ?? v;

function Page() {
  const { t } = useI18n();
  return (
    <EntityManager
      table="customers"
      rowActions={(r) => (
        <>
          <Button asChild size="sm" variant="ghost">
            <Link to="/app/ledger" search={{ kind: "customer", party: String(r.id) }}>
              Ledger
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/app/sales/new" search={{ customer: String(r.id) }}>
              Sell
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/app/due-collection">Collect</Link>
          </Button>
        </>
      )}
      title={t("customers")}
      sub="Retail customers, shops and dealers with price level and credit limit."
      canWrite={useCan("customers")}
      canCreate={useCan("customers", "create")}
      canEdit={useCan("customers", "edit")}
      canDelete={useCan("deleteParty")}
      searchKeys={["name", "business_name", "mobile"]}
      fields={[
        { key: "name", label: "Name", required: true },
        { key: "business_name", label: "Business name" },
        {
          key: "mobile",
          label: "Mobile",
          required: true,
          pattern: BD_MOBILE,
          patternMsg: "Enter a valid Bangladesh mobile number (01XXXXXXXXX).",
          placeholder: "01XXXXXXXXX",
        },
        {
          key: "alt_mobile",
          label: "Alternative mobile",
          pattern: BD_MOBILE,
          patternMsg: "Invalid alternative mobile.",
        },
        { key: "type", label: "Customer type", type: "select", options: TYPES },
        { key: "price_level", label: "Default price level", type: "select", options: LEVELS },
        { key: "credit_limit", label: "Credit limit (৳)", type: "number" },
        { key: "payment_terms_days", label: "Payment terms (days)", type: "number" },
        { key: "opening_balance", label: "Opening due (৳)", type: "number" },
        { key: "nid", label: "NID" },
        { key: "trade_license", label: "Trade license" },
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
        { key: "notes", label: "Notes", type: "textarea" },
      ]}
      columns={[
        {
          key: "name",
          label: "Name",
          render: (r) => (
            <div>
              <div className="font-medium">{r.name}</div>
              <div className="text-xs text-muted-foreground">{r.business_name}</div>
            </div>
          ),
        },
        { key: "mobile", label: "Mobile", className: "num" },
        {
          key: "type",
          label: "Type",
          render: (r) => <Badge variant="secondary">{label(TYPES, r.type ?? "")}</Badge>,
        },
        {
          key: "price_level",
          label: "Price level",
          render: (r) => label(LEVELS, r.price_level ?? ""),
        },
        {
          key: "credit_limit",
          label: "Credit limit",
          className: "num text-right",
          render: (r) => bdt(r.credit_limit),
        },
        {
          key: "opening_balance",
          label: t("customerDue"),
          className: "num text-right",
          render: (r) => bdt(r.opening_balance),
        },
      ]}
    />
  );
}
