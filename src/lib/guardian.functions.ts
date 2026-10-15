import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { profileSchema } from "./guardian/safety";

export const saveGuardianProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ businessId: z.string().uuid(), profile: profileSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const membership = await context.supabase
      .from("business_members")
      .select("role")
      .eq("business_id", data.businessId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (membership.error || membership.data?.role !== "owner")
      throw new Error("Only the owner can update the company profile.");
    const result = await context.supabase
      .from("businesses")
      .update(data.profile)
      .eq("id", data.businessId)
      .select("id")
      .single();
    if (result.error) throw result.error;
    return result.data;
  });
