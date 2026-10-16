import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { restoreOfflineQueryCache } from "@/lib/offline-query-cache";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location, context }) => {
    let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const { data } = await supabase.auth.getSession();
      if (data.session && data.session.expires_at && data.session.expires_at * 1000 > Date.now()) {
        user = data.session.user;
      }
    }
    if (!user) {
      const { data, error } = await supabase.auth.getUser();
      if (!error) user = data.user;
    }
    if (!user)
      throw redirect({
        to: "/auth",
        search: { entry: location.pathname === "/app/brand-shops" ? "brandshops" : undefined },
      });
    await restoreOfflineQueryCache(context.queryClient, user.id);
    return { user };
  },
  component: () => <Outlet />,
});
