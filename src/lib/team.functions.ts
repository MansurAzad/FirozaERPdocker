import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ROLES = [
  "manager",
  "accountant",
  "salesman",
  "store_keeper",
  "purchase_officer",
  "branch_manager",
  "viewer",
] as const;

export const addMemberByEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        businessId: z.string().uuid(),
        email: z.string().email().max(255),
        role: z.enum(ROLES),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isOwner } = await context.supabase.rpc("has_biz_role", {
      _biz: data.businessId,
      _roles: ["owner"],
    });
    if (!isOwner) throw new Error("Only the business owner can add users.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let found: { id: string } | undefined;
    for (let page = 1; page <= 10 && !found; page++) {
      const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error) throw new Error("Could not look up users.");
      found = list.users.find((u) => u.email?.toLowerCase() === data.email.toLowerCase());
      if (list.users.length < 200) break;
    }
    if (!found)
      return {
        ok: false as const,
        message: "No account with this email. Ask them to sign up first, then add them again.",
      };
    const { error } = await context.supabase.from("business_members").insert({
      business_id: data.businessId,
      user_id: found.id,
      role: data.role,
      display_name: data.email,
    });
    if (error)
      return {
        ok: false as const,
        message: error.message.includes("duplicate")
          ? "This user is already a member."
          : error.message,
      };
    return { ok: true as const };
  });
