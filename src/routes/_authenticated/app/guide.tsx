import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/erp/EntityManager";
import { SHORTCUTS } from "@/lib/shortcuts";

export const Route = createFileRoute("/_authenticated/app/guide")({
  head: ({ matches }) => ({
    meta: [
      { title: `User Guide & Shortcuts — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: `Step-by-step operating guide and keyboard shortcuts for ${matchedCompany(matches)}.`,
      },
      { property: "og:title", content: `User Guide — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: `How to run a mobile dealer business from setup to month-end in ${matchedCompany(matches)}.`,
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Guide,
});

type Step = { t: string; to?: string; do: string[]; rules?: string[] };
const PHASES: { title: string; steps: Step[] }[] = [
  {
    title: "A. One-time setup (Owner)",
    steps: [
      {
        t: "Branches",
        to: "/app/branches",
        do: [
          "Add every shop and warehouse.",
          "Each sale, purchase and IMEI belongs to one branch.",
        ],
      },
      {
        t: "Team & roles",
        to: "/app/team",
        do: [
          "Invite staff and give each the correct role (Manager, Salesman, Accountant, Store Keeper…).",
        ],
        rules: [
          "Only the Owner manages the team, backup and reset.",
          "Staff only see and change what their role allows — enforced by the database.",
        ],
      },
      {
        t: "Cash, bank & mobile banking accounts",
        to: "/app/money",
        do: ["Create Cash, Bank, bKash, Nagad, Rocket accounts with today's opening balance."],
        rules: [
          "Opening balance is posted once; later changes must be done with entries, not edits.",
        ],
      },
      {
        t: "Brands & categories",
        to: "/app/brands",
        do: [
          "Add brands (Samsung, Xiaomi…) and categories.",
          "Categories named Mobile / Phone / Tablet / Tab / Watch are always IMEI-tracked.",
        ],
      },
      {
        t: "Products & variants",
        to: "/app/products",
        do: [
          "Add model + RAM/storage/colour variants with purchase, retail, wholesale and minimum price.",
          "Leave SKU blank — it is generated automatically.",
        ],
        rules: ["Selling below minimum price needs Manager approval."],
      },
      {
        t: "Customers & suppliers",
        to: "/app/customers",
        do: [
          "Enter name, mobile (01XXXXXXXXX), credit limit and old due as opening balance.",
          "Do the same for suppliers with what you owe them.",
        ],
      },
    ],
  },
  {
    title: "B. Daily operation",
    steps: [
      {
        t: "1. Purchase (stock in) — F4",
        to: "/app/purchases/new",
        do: [
          "Choose supplier and branch, add product lines and rate.",
          "For phones/tabs/watches enter one IMEI per unit — type, USB-scan or use the QR camera button for bulk scan.",
          "Add transport/other cost; it is spread into landed cost automatically.",
          "Enter paid amount; the rest becomes Supplier Due.",
        ],
        rules: [
          "IMEI must be 15 digits and never used before.",
          "IMEI count must equal quantity.",
          "Posted purchases cannot be edited — use Purchase Return.",
        ],
      },
      {
        t: "2. Check stock — F6",
        to: "/app/stock",
        do: ["See units and value per branch. Use Transfer to move stock between branches."],
      },
      {
        t: "3. Sell (POS) — F2",
        to: "/app/sales/new",
        do: [
          "Scan the IMEI (or bulk-scan many) — the exact device is added.",
          "Pick customer (Walk-in must pay in full).",
          "Split payment across Cash / bKash / Nagad / Bank; balance becomes Customer Due.",
          "Post and print the invoice.",
        ],
        rules: [
          "Discount above 10% or price below minimum needs Manager.",
          "Going over credit limit needs Owner/Manager override (logged).",
          "Stock, IMEI status, due, cash and accounts update together.",
        ],
      },
      {
        t: "4. Collect due — F7",
        to: "/app/due-collection",
        do: ["Select customer, enter amount and money account. Oldest invoices are settled first."],
        rules: ["You cannot collect more than the due."],
      },
      {
        t: "5. Pay suppliers",
        to: "/app/supplier-payments",
        do: ["Record each payment against the supplier's due."],
      },
      {
        t: "6. Expenses — F8",
        to: "/app/expenses",
        do: ["Record rent, salary, bills with category and paying account."],
        rules: ["Wrong entry? Use Cancel (an opposite entry is posted) — nothing is deleted."],
      },
      {
        t: "7. Returns & warranty",
        to: "/app/warranty",
        do: [
          "Customer return: open the sale invoice → Return.",
          "Return to supplier: open the purchase → Return.",
          "Warranty claim: search IMEI (F3) → Warranty claim.",
        ],
      },
      {
        t: "8. Day closing",
        to: "/app/closing",
        do: ["Count cash at day end and close the day; differences are recorded."],
      },
    ],
  },
  {
    title: "C. Weekly / monthly control",
    steps: [
      {
        t: "Party Ledger",
        to: "/app/ledger",
        do: ["Review each customer/supplier statement; export PDF/Excel or share on WhatsApp."],
      },
      {
        t: "Reports",
        to: "/app/reports",
        do: ["Check sales, profit by product/brand/branch/salesman and low stock."],
      },
      {
        t: "Customer portal & payment requests",
        to: "/app/customer-portal",
        do: [
          "Pick a customer and generate a passwordless statement link; share it on WhatsApp.",
          "The customer sees their invoices, dues and how to pay — no login needed.",
          "Send a payment request for an amount and due date, then mark it paid when money arrives.",
        ],
        rules: [
          "Links expire (30 days by default). Anyone with the link can view that customer's statement, so share it privately.",
        ],
      },
      {
        t: "Installment sales (EMI) — brand shops only",
        to: "/app/emi",
        do: [
          "Create installment sale (brand shop) with EMI plan, downpayment, start date and due day.",
          "Schedule generates automatically; collect installments, settle early, or track overdue.",
          "Downpayment goes through money accounts; finance charges update accounts and customer due consistently.",
        ],
        rules: [
          "Only owner/manager/purchase_officer/salesman/accountant can access; accountant only if permitted (as selected).",
        ],
      },
      {
        t: "Accounting",
        to: "/app/accounting",
        do: [
          "Trial balance and journals update automatically. Use manual journal only for adjustments.",
        ],
      },
      { t: "Audit log", to: "/app/audit", do: ["Owner reviews who changed what."] },
      {
        t: "Backup",
        to: "/app/backup",
        do: ["Download a backup at least weekly and keep it safe."],
        rules: ["Restore and reset replace data and need typing RESTORE / RESET."],
      },
    ],
  },
];

const TERMS = [
  "Every amount is in BDT (৳). Money is never rounded silently.",
  "Posted sales, purchases, payments and expenses are never edited or deleted — correct them with a return, cancel or reversing entry so the audit trail stays complete.",
  "A phone/tab/watch can only be sold if its IMEI is IN STOCK at the selling branch.",
  "Each business's data is fully separate; staff of one business can never see another.",
  "Demo data is fictional; clear it with Backup & Reset before going live.",
];

function Guide() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="User Guide"
        sub="Start-to-finish operating steps for a mobile dealer business, plus keyboard shortcuts."
      />
      {PHASES.map((p) => (
        <section key={p.title}>
          <h2 className="mb-3 font-display text-lg font-semibold">{p.title}</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {p.steps.map((s) => (
              <div key={s.t} className="rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">{s.t}</h3>
                  {s.to && (
                    <Link to={s.to} className="text-xs font-medium text-primary hover:underline">
                      Open →
                    </Link>
                  )}
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                  {s.do.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
                {s.rules && (
                  <ul className="mt-2 space-y-1 rounded-md bg-muted p-2 text-xs text-muted-foreground">
                    {s.rules.map((r) => (
                      <li key={r}>• {r}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">D. Rules & terms</h2>
        <ul className="list-disc space-y-1 rounded-lg border bg-card p-4 pl-8 text-sm shadow-sm">
          {TERMS.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">E. Keyboard shortcuts</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SHORTCUTS.map((s) => (
            <div
              key={s.keys}
              className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm"
            >
              <span>{s.label}</span>
              <kbd className="rounded border bg-muted px-1.5 font-mono text-xs">{s.keys}</kbd>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
