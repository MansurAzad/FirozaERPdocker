import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type PortalInvoice = {
  invoice_no: string;
  sale_date: string;
  total: number;
  paid: number;
  due: number;
};

export type PortalRequest = {
  id: string;
  amount: number;
  due_date: string | null;
  description: string | null;
  status: string;
};

export type PortalAccount = {
  name: string;
  kind: string;
  account_no: string | null;
  bank_name: string | null;
};

export type PortalData =
  | { ok: false }
  | {
      ok: true;
      business: string;
      customer: { name: string; mobile: string; address: string | null };
      totalDue: number;
      sales: PortalInvoice[];
      requests: PortalRequest[];
      payTo: PortalAccount[];
    };

type VerifyRow = { business_id: string; customer_id: string };

/**
 * Public, token-gated customer statement. Runs only on the server with the
 * service-role client: the customer is not signed in, so RLS cannot be used.
 * The token itself is the credential and is validated inside Postgres.
 */
export const getPortalData = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ token: z.string().min(8).max(200) }).parse(d))
  .handler(async ({ data }): Promise<PortalData> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await supabaseAdmin.rpc("verify_customer_portal_token", {
      _token: data.token,
    });
    if (error) throw new Error("Could not open this statement link.");

    const hit = (Array.isArray(rows) ? rows[0] : rows) as VerifyRow | undefined;
    if (!hit?.customer_id || !hit?.business_id) return { ok: false };

    const { customer_id: customerId, business_id: businessId } = hit;

    const [bizRes, custRes, salesRes, reqRes, acctRes, tokenRes] = await Promise.all([
      supabaseAdmin.from("businesses").select("name").eq("id", businessId).maybeSingle(),
      supabaseAdmin
        .from("customers")
        .select("name,mobile,address")
        .eq("id", customerId)
        .maybeSingle(),
      supabaseAdmin
        .from("sales")
        .select("invoice_no,sale_date,total,paid,due")
        .eq("business_id", businessId)
        .eq("customer_id", customerId)
        .eq("status", "posted")
        .order("sale_date", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("customer_payment_requests")
        .select("id,amount,due_date,description,status")
        .eq("business_id", businessId)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("money_accounts")
        .select("name,kind,account_no,bank_name")
        .eq("business_id", businessId)
        .eq("status", "active")
        .in("kind", ["mfs", "bank"]),
      supabaseAdmin
        .from("customer_portal_tokens")
        .select("id")
        .eq("token", data.token)
        .maybeSingle(),
    ]);

    const sales = (salesRes.data ?? []).map((s) => ({
      invoice_no: s.invoice_no,
      sale_date: s.sale_date,
      total: Number(s.total ?? 0),
      paid: Number(s.paid ?? 0),
      due: Number(s.due ?? 0),
    }));
    const totalDue = sales.reduce((sum, s) => sum + s.due, 0);

    // Best-effort: note that the link was opened, for the shop's own records.
    if (tokenRes.data?.id) {
      try {
        await supabaseAdmin.from("customer_portal_sessions").insert({
          business_id: businessId,
          customer_id: customerId,
          token_id: tokenRes.data.id,
        });
      } catch {
        // A failed visit log must never block the statement.
      }
    }

    return {
      ok: true,
      business: bizRes.data?.name ?? "Statement",
      customer: {
        name: custRes.data?.name ?? "Customer",
        mobile: custRes.data?.mobile ?? "",
        address: custRes.data?.address ?? null,
      },
      totalDue,
      sales,
      requests: (reqRes.data ?? []).map((r) => ({
        id: r.id,
        amount: Number(r.amount ?? 0),
        due_date: r.due_date,
        description: r.description,
        status: r.status ?? "pending",
      })),
      payTo: (acctRes.data ?? []).map((a) => ({
        name: a.name,
        kind: a.kind,
        account_no: a.account_no,
        bank_name: a.bank_name,
      })),
    };
  });
