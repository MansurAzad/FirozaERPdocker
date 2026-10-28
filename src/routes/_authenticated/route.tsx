import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { resolveAuthenticatedUser } from "@/lib/auth-session";
import { restoreOfflineQueryCache } from "@/lib/offline-query-cache";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location, context }) => {
    const user = await resolveAuthenticatedUser(
      supabase.auth,
      typeof navigator !== "undefined" && !navigator.onLine,
    );
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
