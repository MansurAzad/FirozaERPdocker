import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendDailyReports } from "./daily-report.server";

export const sendDailyReportNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({ businessId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("has_biz_role", {
      _biz: data.businessId,
      _roles: ["owner", "manager", "accountant"],
    });
    if (!ok) throw new Error("Only owner, manager or accountant can send reports");
    return sendDailyReports(context.supabase, data.businessId, data.date);
  });
