import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { guardianQuery } from "@/lib/guardian/queries";
import { useBusiness } from "@/lib/business";
import { bdt } from "@/lib/format";
import { GuardianNav } from "@/components/erp/GuardianNav";
import { PageHeader } from "@/components/erp/EntityManager";
import { Button } from "@/components/ui/button";
import { RefreshCw, MessageSquare } from "lucide-react";
import { safeRecommendation } from "@/lib/guardian/safety";
import emblem from "@/assets/firoza-emblem.png";

export const Route = createFileRoute("/_authenticated/app/guardian-owner")({
  head: ({ matches }) => ({
    meta: [
      { title: `AI Owner Overview — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: "Live business health, margins, stock and safe owner recommendations.",
      },
      { property: "og:title", content: `AI Owner Overview — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: "Owner financial intelligence and verified business checks.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(guardianQuery(context.business.id)),
  component: OwnerPage,
});
function OwnerPage() {
  const { business } = useBusiness();
  const { data, refetch, isFetching } = useSuspenseQuery(guardianQuery(business.id));
  const issues = data.checks.reduce((s, c) => s + c.issues, 0);
  return (
    <div>
      <GuardianNav />
      <PageHeader
        title="Owner command center"
        sub={data.company.name}
        actions={
          <Button variant="outline" disabled={isFetching} onClick={() => refetch()}>
            <RefreshCw />
            Refresh
          </Button>
        }
      />
      <div className="flex items-center gap-4 border-y py-5">
        <img src={emblem} alt={`${business.name} Guardian`} className="h-14 w-14 object-contain" />
        <div>
          <h2 className="font-display text-xl font-semibold">
            Business health ·{" "}
            {issues ? `${issues} discrepancies` : `${data.checks.length} checks passed`}
          </h2>
          <p className="text-sm text-muted-foreground">
            Checked {new Date(data.checked_at).toLocaleString("en-GB")} · Bangladesh date{" "}
            {data.business_date}
          </p>
        </div>
      </div>
      <div className="my-6 grid gap-px border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["Today’s net sales", "today_sales"],
            ["All-time net sales", "net_sales"],
            ["All-time gross profit", "gross_profit"],
            ["Active expenses", "expenses"],
            ["Customer Due", "customer_due"],
            ["Supplier Due", "supplier_due"],
            ["Cash & Bank", "cash_bank"],
            ["Stock value", "stock_value"],
          ] as const
        ).map(([label, key]) => (
          <div key={key} className="bg-background p-5">
            <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
            <p className="num mt-2 text-2xl font-semibold">{bdt(data.metrics[key])}</p>
          </div>
        ))}
      </div>
      <div className="mb-6 grid gap-3 border-b pb-5 sm:grid-cols-3">
        <p className="text-sm">
          Today’s purchases <strong>{bdt(data.metrics["today_purchases"])}</strong>
        </p>
        <p className="text-sm">
          Today’s receipts <strong>{bdt(data.metrics["today_receipts"])}</strong>
        </p>
        <p className="text-sm">
          Today’s supplier payments <strong>{bdt(data.metrics["today_supplier_payments"])}</strong>
        </p>
      </div>
      <p className="mb-6 text-xs text-muted-foreground">
        Last scheduled/manual Guardian run:{" "}
        {data.last_guardian_run
          ? new Date(data.last_guardian_run).toLocaleString("en-GB")
          : "Not yet run"}{" "}
        · AI briefing: on request · No pending-approval workflow configured
      </p>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Owner review</h2>
        <Button asChild>
          <Link to="/app/guardian-chat" search={{ brief: true }}>
            <MessageSquare />
            Generate AI briefing
          </Link>
        </Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.loss_sales.map((s) => (
          <article
            key={s.id + s.imei1}
            className="rounded-lg border border-destructive/40 bg-card p-5"
          >
            <p className="text-xs font-semibold uppercase text-destructive">Loss-making sale</p>
            <h3 className="mt-2 text-lg font-semibold">
              {s.invoice_no} · {s.model}
            </h3>
            <p className="my-2 text-sm">
              Net revenue {bdt(s.net_revenue)} − cost {bdt(s.unit_cost)} ={" "}
              <strong className="text-destructive">{bdt(s.margin)}</strong>
            </p>
            <p className="text-xs text-muted-foreground">
              IMEI {s.imei1} · invoice discount {bdt(s.discount)} · paid at posting {bdt(s.paid)} ·
              due at posting {bdt(s.due)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Current customer balance {bdt(s.customer_current_due)} · subsequent party receipts{" "}
              {bdt(s.subsequent_party_receipts)}. Later receipts remain in the party ledger; the
              posted invoice is not overwritten.
            </p>
            <p className="my-4 text-sm text-muted-foreground">{safeRecommendation("below_cost")}</p>
            <Button asChild variant="outline">
              <Link to="/app/sales/$id" params={{ id: s.id }}>
                Review invoice
              </Link>
            </Button>
          </article>
        ))}
        {data.restock.map((v) => (
          <article key={v.id} className="rounded-lg border bg-card p-5">
            <p className="text-xs font-semibold uppercase text-primary">Stock review</p>
            <h3 className="mt-2 text-lg font-semibold">
              {v.model} {v.storage}
            </h3>
            <p className="my-2 text-sm">
              <strong>{v.available}</strong> available · reorder trigger {v.reorder_level} ·{" "}
              {v.suggested_minimum} units to reach trigger
            </p>
            <p className="my-4 text-sm text-muted-foreground">{safeRecommendation("low_stock")}</p>
            <div className="flex gap-2">
              <Button asChild variant="outline">
                <Link to="/app/stock">Review stock</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/app/purchases/new" search={{ variant: v.id }}>
                  Prepare purchase
                </Link>
              </Button>
            </div>
          </article>
        ))}
      </div>
      <h2 className="mb-3 mt-8 text-lg font-semibold">Consistency & reconciliation</h2>
      <div className="grid gap-px border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {data.checks.map((c) => (
          <div key={c.code} className="flex justify-between gap-3 bg-background p-3 text-sm">
            <span className="capitalize">{c.code.replaceAll("_", " ")}</span>
            <strong className={c.issues ? "text-destructive" : "text-success"}>
              {c.issues ? `${c.issues} issues` : "Passed"}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}
