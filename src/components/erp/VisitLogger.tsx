import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

function sessionId() {
  let id = sessionStorage.getItem("firoza.visit-session");
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem("firoza.visit-session", id); }
  return id;
}
const device = () => {
  const ua = navigator.userAgent;
  const kind = /Mobi|Android/i.test(ua) ? "mobile" : "desktop";
  return matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches ? `${kind} app` : kind;
};

/** Records each in-app page opened by a signed-in staff member (online only; never queued offline). */
export function VisitLogger({ businessId }: { businessId: string }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    if (!navigator.onLine) return;
    void supabase.from("page_visits").insert({ business_id: businessId, path: path.slice(0, 300), session_id: sessionId(), device: device() });
  }, [businessId, path]);
  return null;
}
