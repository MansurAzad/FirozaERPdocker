import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useBranding } from "@/lib/branding-context";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "অ্যাক্সেস অপেক্ষমাণ — FIROZA ENTERPRISE" },
      {
        name: "description",
        content: "An owner must add your account to FIROZA ENTERPRISE before you can continue.",
      },
      { property: "og:title", content: "অ্যাক্সেস অপেক্ষমাণ — FIROZA ENTERPRISE" },
      {
        property: "og:description",
        content: "An owner must add your account to FIROZA ENTERPRISE before you can continue.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Onboarding,
});

export function Onboarding() {
  const branding = useBranding();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function checkAccess() {
    setBusy(true);
    await navigate({ to: "/app", replace: true });
    setBusy(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    await navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <section className="w-full max-w-lg space-y-6">
        <div>
          <p className="text-sm font-medium text-primary">{branding.name}</p>
          <h1 className="mt-1 text-2xl font-bold">অ্যাকাউন্ট তৈরি হয়েছে</h1>
          <p className="mt-3 text-muted-foreground">
            {branding.name}-এ প্রবেশের জন্য একজন Owner-কে আপনার ইমেইলটি Team পেজ থেকে যোগ করে
            উপযুক্ত role দিতে হবে। আপাতত নতুন কোম্পানি তৈরি করা যাবে না।
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="lg" disabled={busy} onClick={checkAccess}>
            অ্যাক্সেস যাচাই করুন
          </Button>
          <Button size="lg" variant="outline" onClick={signOut}>
            সাইন আউট
          </Button>
        </div>
      </section>
    </div>
  );
}
