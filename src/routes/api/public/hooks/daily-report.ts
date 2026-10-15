import { createFileRoute } from "@tanstack/react-router";

// Called by the nightly schedule at 00:00 Dhaka time; sends yesterday's reports for every business.
export const Route = createFileRoute("/api/public/hooks/daily-report")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
        if (!token || token.length > 200) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: valid } = await supabaseAdmin.rpc("verify_job_token", { _name: "daily_report", _token: token });
        if (!valid) return new Response("Unauthorized", { status: 401 });
        const { sendDailyReports, dhakaDate } = await import("@/lib/daily-report.server");
        const date = dhakaDate(-1);
        const { data: list } = await supabaseAdmin.from("report_recipients").select("business_id");
        const ids = [...new Set((list ?? []).map((r) => r.business_id))];
        const results: Record<string, unknown> = {};
        for (const id of ids) {
          try { results[id] = await sendDailyReports(supabaseAdmin, id, date); }
          catch (e) { console.error("daily report", id, e); results[id] = { error: true }; }
        }
        return Response.json({ date, businesses: ids.length, results });
      },
    },
  },
});
