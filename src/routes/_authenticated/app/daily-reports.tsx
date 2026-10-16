import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Mail, Share2, Trash2, Plus, MessageCircle, Send, Facebook, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { sendDailyReportNow } from "@/lib/daily-report.functions";
import { useBusiness } from "@/lib/business";
import { matchedCompany } from "@/lib/branding";
import { PageHeader } from "@/components/erp/EntityManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyError } from "@/lib/format";
import {
  dailySummarySchema,
  splitSummary,
  summaryText,
  totals,
  type BranchSummary,
} from "@/lib/daily-summary";

const recipientsQuery = (biz: string) =>
  queryOptions({
    queryKey: ["report-recipients", biz],
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_recipients")
        .select("id,email")
        .eq("business_id", biz)
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

export const Route = createFileRoute("/_authenticated/app/daily-reports")({
  head: ({ matches }) => ({
    meta: [
      { title: `Daily reports — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: "Daily dealer-house and brand-shop summaries, recipients and sharing.",
      },
      { property: "og:title", content: `Daily reports — ${matchedCompany(matches)}` },
      { property: "og:description", content: "Daily business summaries for owners." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(recipientsQuery(context.business.id));
    void context.queryClient.prefetchQuery(summaryQuery(context.business.id, today()));
  },
  component: DailyReports,
});

function today() {
  return new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
}
const summaryQuery = (biz: string, date: string) =>
  queryOptions({
    queryKey: ["daily-summary", biz, date],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("daily_summary", { _biz: biz, _date: date });
      if (error) throw error;
      return dailySummarySchema.parse(data);
    },
  });
const tk = (n: number) => "৳" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

function DailyReports() {
  const { business, role } = useBusiness();
  const qc = useQueryClient();
  const recipientQuery = useQuery(recipientsQuery(business.id));
  const recipients = recipientQuery.data ?? [];
  const [email, setEmail] = useState("");
  const [date, setDate] = useState(today());
  const owner = role === "owner";

  const summary = useQuery(summaryQuery(business.id, date));

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("report_recipients")
        .insert({ business_id: business.id, email: email.trim().toLowerCase() });
      if (error) throw error;
    },
    onSuccess: () => {
      setEmail("");
      qc.invalidateQueries({ queryKey: ["report-recipients"] });
      toast.success("Email added");
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("report_recipients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["report-recipients"] }),
    onError: (e) => toast.error(friendlyError(e)),
  });

  const sendNow = useServerFn(sendDailyReportNow);
  const send = useMutation({
    mutationFn: () => sendNow({ data: { businessId: business.id, date } }),
    onSuccess: (r) =>
      r.failed
        ? toast.error(`${r.sent} sent, ${r.failed} failed`, {
            duration: 15000,
            description: r.blocked?.length
              ? `Not delivered to ${r.blocked.join(", ")}: until firozaenterprise.com is verified in Resend, reports can only go to mansurazad@gmail.com.`
              : (r.error ?? undefined),
          })
        : r.sent
          ? toast.success(`${r.sent} emails sent`)
          : toast.info("Add an email first"),
    onError: (e) => toast.error(friendlyError(e)),
  });
  const parts = summary.data ? splitSummary(summary.data) : undefined;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings · Daily reports"
        sub="দৈনিক হিসাবের সারাংশ — ডিলার হাউস ও ব্র্যান্ডশপ আলাদা"
      />

      <section className="max-w-2xl rounded-lg border bg-card p-5">
        <h2 className="flex items-center gap-2 font-semibold">
          <Mail className="size-4" /> Report emails
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          প্রতিদিন রাত ১২টায় বা দিন শেষ (Day close) হলে এই ঠিকানাগুলোতে দুটি আলাদা ইমেইল যাবে।
        </p>
        <p className="mt-2 rounded-md bg-highlight/15 px-3 py-2 text-xs">
          পাঠানো হয় report@firozaenterprise.com থেকে — ডোমেইন যাচাই (DNS) সম্পন্ন হলে ইমেইল যাবে।
        </p>
        <ul className="mt-4 divide-y">
          {recipientQuery.error && (
            <li className="py-2 text-sm text-destructive">{friendlyError(recipientQuery.error)}</li>
          )}
          {recipients.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2 text-sm">
              <span className="break-all">{r.email}</span>
              {owner && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${r.email}`}
                  onClick={() => remove.mutate(r.id)}
                >
                  <Trash2 />
                </Button>
              )}
            </li>
          ))}
          {recipients.length === 0 && !recipientQuery.error && (
            <li className="py-2 text-sm text-muted-foreground">
              {recipientQuery.isPending ? "Loading email recipients…" : "No emails yet."}
            </li>
          )}
        </ul>
        {owner ? (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <Label htmlFor="rcpt" className="sr-only">
              Email
            </Label>
            <Input
              id="rcpt"
              type="email"
              required
              maxLength={254}
              placeholder="owner@firozaenterprise.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button disabled={add.isPending}>
              <Plus /> Add
            </Button>
          </form>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Only the owner can change report emails.
          </p>
        )}
      </section>

      <div className="flex items-end gap-3">
        <div>
          <Label htmlFor="d">Date</Label>
          <Input
            id="d"
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          disabled={send.isPending || role === "viewer"}
          onClick={() => send.mutate()}
        >
          <Mail /> {send.isPending ? "Sending…" : "Email this report now"}
        </Button>
      </div>

      {summary.error && <p className="text-sm text-destructive">{friendlyError(summary.error)}</p>}
      {summary.isPending && <p className="text-sm text-muted-foreground">Loading report…</p>}
      {parts && (
        <div className="grid gap-6 lg:grid-cols-2">
          <SummaryCard
            title="ডিলার হাউস (Dealer house)"
            rows={parts.house}
            date={date}
            company={business.name}
          />
          <SummaryCard
            title="ব্র্যান্ডশপ (Brand shops)"
            rows={parts.shops}
            date={date}
            company={business.name}
          />
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  title,
  rows,
  date,
  company,
}: {
  title: string;
  rows: BranchSummary[];
  date: string;
  company: string;
}) {
  const t = totals(rows);
  const text = summaryText(company, title, date, rows);
  const enc = encodeURIComponent(text);
  const open = (url: string) => window.open(url, "_blank", "noopener");
  const items: [string, number][] = [
    ["বিক্রি · Sales", t.sales],
    ["মোট লাভ · Gross profit", t.grossProfit],
    ["খরচ · Expenses", t.expenses],
    ["নিট ফলাফল · Net result", t.netResult],
    ["নতুন বাকি · New due", t.due],
    ["ক্রয় · Purchases", t.purchases],
    ["স্টক মূল্য · Stock value", t.stockValue],
  ];
  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="font-semibold">{title}</h2>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        {items.map(([k, v]) => (
          <div key={k} className="rounded-md bg-muted p-3">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className={`num text-lg font-semibold ${v < 0 ? "text-destructive" : ""}`}>
              {tk(v)}
            </dd>
          </div>
        ))}
      </dl>
      {rows.length > 0 && (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1">Name</th>
              <th className="text-right">Sales</th>
              <th className="text-right">Expenses</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="py-1">{r.name}</td>
                <td className="num text-right">{tk(r.sales_total - r.returns_total)}</td>
                <td className="num text-right">{tk(r.expenses_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => open(`https://wa.me/?text=${enc}`)}>
          <MessageCircle /> WhatsApp
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            open(
              `https://t.me/share/url?url=${encodeURIComponent(window.location.origin)}&text=${enc}`,
            )
          }
        >
          <Send /> Telegram
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            open(
              `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.origin)}&quote=${enc}`,
            )
          }
        >
          <Facebook /> Facebook
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            if (navigator.share) {
              try {
                await navigator.share({ title, text });
              } catch {
                /* cancelled */
              }
            } else {
              await navigator.clipboard.writeText(text);
              toast.success("Copied");
            }
          }}
        >
          <Share2 /> More
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            toast.success("Copied");
          }}
        >
          <Copy /> Copy
        </Button>
      </div>
    </section>
  );
}
