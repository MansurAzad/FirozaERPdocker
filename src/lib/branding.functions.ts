import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { companyName } from "./branding";

export const getSiteBranding = createServerFn({ method: "GET" }).handler(async () => {
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  const url = process.env["SUPABASE_URL"];
  if (!key || !url) throw new Error("Company identity unavailable");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`)
          headers.delete("Authorization");
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
  const { data, error } = await client.from("site_branding").select("name").maybeSingle();
  if (error) throw new Error("Company identity unavailable");
  return { name: companyName(data?.name) };
});
