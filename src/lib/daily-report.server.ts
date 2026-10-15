import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { dailySummarySchema, splitSummary } from "./daily-summary";
import { dailyReportEmail } from "./daily-report-email";
import { companyName } from "./branding";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const FROM_ADDRESS = "report@firozaenterprise.com";

/** Dhaka (UTC+6) calendar date, optionally shifted by days. */
export function dhakaDate(offsetDays = 0, now = Date.now()) {
  return new Date(now + 6 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10);
}

async function sendOne(to: string, subject: string, html: string, from: string, key: string, _retry = false): Promise<void> {
  const lovable = process.env["LOVABLE_API_KEY"];
  const resend = process.env["RESEND_API_KEY"];
  if (!lovable || !resend) throw new Error("Email service is not configured");
  const res = await fetch(`${GATEWAY_URL}/emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lovable}`,
      "X-Connection-Api-Key": resend,
      "Idempotency-Key": key.slice(0, 256),
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (res.ok) return;
  const body = await res.text();
  // Until the company domain is verified in Resend, fall back to Resend's test sender
  // (delivers only to the Resend account owner's own email address).
  if (res.status === 403 && !from.includes("resend.dev") && /domain|verif/i.test(body))
    return sendOne(to, subject, html, from.replace(/<[^>]+>/, "<onboarding@resend.dev>"), key + "-test", true);
  throw new Error(`Email failed [${res.status}]: ${body}`);
}

/** Sends the dealer-house and brand-shop emails for one business/date to every saved recipient. */
export async function sendDailyReports(db: SupabaseClient<Database>, businessId: string, date: string) {
  const [{ data: biz, error: e1 }, { data: rcpts, error: e2 }, { data: raw, error: e3 }] = await Promise.all([
    db.from("businesses").select("name").eq("id", businessId).single(),
    db.from("report_recipients").select("email").eq("business_id", businessId),
    db.rpc("daily_summary", { _biz: businessId, _date: date }),
  ]);
  if (e1 || e2 || e3) throw e1 ?? e2 ?? e3;
  const recipients = rcpts ?? [];
  if (!recipients.length) return { sent: 0, failed: 0, blocked: [] as string[], error: null as string | null };
  const company = companyName(biz?.name);
  const { house, shops } = splitSummary(dailySummarySchema.parse(raw));
  const mails = [
    { kind: "house", ...dailyReportEmail(company, "ডিলার হাউস (Dealer house)", date, house) },
    { kind: "shops", ...dailyReportEmail(company, "ব্র্যান্ডশপ (Brand shops)", date, shops) },
  ];
  const from = `${company.replace(/[<>"]/g, "")} <${FROM_ADDRESS}>`;
  let sent = 0, failed = 0, error: string | null = null;
  const blocked = new Set<string>();
  for (const r of recipients)
    for (const m of mails) {
      try {
        await sendOne(r.email, m.subject, m.html, from, `daily-${businessId}-${date}-${m.kind}-${r.email}`);
        sent++;
      } catch (err) {
        failed++;
        const msg = String(err);
        if (/only send testing emails|verify a domain/i.test(msg)) blocked.add(r.email); else error ??= msg.slice(0, 200);
        console.error("daily report email", r.email, m.kind, err);
      }
    }
  return { sent, failed, blocked: [...blocked], error };
}
