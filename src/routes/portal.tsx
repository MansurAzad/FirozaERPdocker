import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Printer, ShieldCheck } from "lucide-react";
import { getPortalData } from "@/lib/portal.functions";
import { bdt } from "@/lib/format";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/portal")({
  validateSearch: (search: Record<string, unknown>): { token?: string | undefined } => ({
    token: typeof search["token"] === "string" ? search["token"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Your account statement" },
      {
        name: "description",
        content: "View your invoices, payments and outstanding dues.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: PortalPage,
});

function PortalPage() {
  const { token } = Route.useSearch();
  const fetchPortal = useServerFn(getPortalData);

  const { data, isPending, error } = useQuery({
    queryKey: ["portal", token],
    enabled: !!token,
    retry: false,
    queryFn: () => fetchPortal({ data: { token: token ?? "" } }),
  });

  return (
    <div className="min-h-screen bg-muted/40 px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-4">
        {!token || error || (data && !data.ok) ? (
          <div className="rounded-xl border bg-card p-8 text-center shadow-sm">
            <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <h1 className="text-lg font-semibold">This link can't be opened</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The statement link is invalid or has expired. Please ask the shop to send you a fresh
              link.
            </p>
            <Button asChild variant="outline" className="mt-5">
              <Link to="/">Go to home</Link>
            </Button>
          </div>
        ) : isPending || !data ? (
          <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground shadow-sm">
            Loading your statement…
          </div>
        ) : (
          <>
            <header className="flex items-start justify-between gap-4 rounded-xl border bg-card p-5 shadow-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Statement</p>
                <h1 className="font-display text-xl font-semibold">{data.business}</h1>
                <p className="mt-1 text-sm">
                  {data.customer.name}
                  {data.customer.mobile ? (
                    <span className="num text-muted-foreground"> · {data.customer.mobile}</span>
                  ) : null}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer className="mr-1 h-4 w-4" />
                Print
              </Button>
            </header>

            <section className="rounded-xl border bg-card p-5 shadow-sm">
              <p className="text-sm text-muted-foreground">Total outstanding due</p>
              <p
                className={
                  "num mt-1 text-3xl font-semibold " +
                  (data.totalDue > 0 ? "text-destructive" : "text-emerald-600")
                }
              >
                {bdt(data.totalDue)}
              </p>
            </section>

            {data.requests.length ? (
              <section className="rounded-xl border bg-card p-5 shadow-sm">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Payment requests
                </h2>
                <ul className="space-y-2">
                  {data.requests.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
                    >
                      <div>
                        <span className="num font-medium">{bdt(r.amount)}</span>
                        {r.due_date ? (
                          <span className="num ml-2 text-xs text-muted-foreground">
                            by {r.due_date}
                          </span>
                        ) : null}
                        {r.description ? (
                          <p className="text-xs text-muted-foreground">{r.description}</p>
                        ) : null}
                      </div>
                      <span
                        className={
                          "rounded px-2 py-0.5 text-xs font-medium " +
                          (r.status === "paid"
                            ? "bg-emerald-100 text-emerald-700"
                            : r.status === "cancelled"
                              ? "bg-muted text-muted-foreground"
                              : "bg-amber-100 text-amber-700")
                        }
                      >
                        {r.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
              <h2 className="border-b px-5 py-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Recent invoices
              </h2>
              {data.sales.length ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2 font-medium">Invoice</th>
                      <th className="px-4 py-2 font-medium">Date</th>
                      <th className="px-4 py-2 text-right font-medium">Total</th>
                      <th className="px-4 py-2 text-right font-medium">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sales.map((s) => (
                      <tr key={s.invoice_no} className="border-b last:border-0">
                        <td className="num px-4 py-2">{s.invoice_no}</td>
                        <td className="num px-4 py-2 text-muted-foreground">{s.sale_date}</td>
                        <td className="num px-4 py-2 text-right">{bdt(s.total)}</td>
                        <td
                          className={
                            "num px-4 py-2 text-right " + (s.due > 0 ? "text-destructive" : "")
                          }
                        >
                          {bdt(s.due)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="px-5 py-6 text-center text-sm text-muted-foreground">
                  No invoices recorded yet.
                </p>
              )}
            </section>

            {data.payTo.length ? (
              <section className="rounded-xl border bg-card p-5 shadow-sm">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  How to pay
                </h2>
                <ul className="space-y-2 text-sm">
                  {data.payTo.map((a) => (
                    <li key={a.name} className="flex items-center justify-between gap-3">
                      <span>{a.name}</span>
                      <span className="num text-muted-foreground">
                        {a.account_no ?? a.bank_name ?? ""}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted-foreground">
                  After paying, send the transaction ID to the shop so it can be credited to your
                  account.
                </p>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
