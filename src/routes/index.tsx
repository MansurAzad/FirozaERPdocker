import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Store, Warehouse, ArrowUpRight, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { entryDestination, entryRequiresLogin, type HomeEntry } from "@/lib/home-entry";
import emblem from "@/assets/firoza-emblem.png";
import { useBranding } from "@/lib/branding-context";
import { getSiteBranding } from "@/lib/branding.functions";

export const Route = createFileRoute("/")({
  loader: () => getSiteBranding(),
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.name ?? "FIROZA ENTERPRISE"} — ব্র্যান্ডশপ ও হাউজ & স্টক` },
      {
        name: "description",
        content: `${loaderData?.name ?? "FIROZA ENTERPRISE"} — ছয়টি ব্র্যান্ডশপ এবং হাউজ ও স্টকের হিসাব ব্যবস্থাপনা।`,
      },
      { property: "og:title", content: loaderData?.name ?? "FIROZA ENTERPRISE" },
      {
        property: "og:description",
        content: "ব্র্যান্ডশপ ও হাউজ & স্টক — ব্যবসার হিসাব এক জায়গায়।",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { name } = useBranding();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<HomeEntry>();
  async function enter(entry: HomeEntry) {
    setBusy(entry);
    sessionStorage.setItem("firoza.entry", entry);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || entryRequiresLogin(Boolean(data.session)))
        await navigate({ to: "/auth", search: { entry } });
      else await navigate({ to: entryDestination(entry) });
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <main className="firoza-home">
      <div className="firoza-watermarks" aria-hidden="true">
        {Array.from({ length: 30 }, (_, i) => (
          <div key={i}>
            <img src={emblem} alt="" width={1024} height={1024} loading="lazy" />
            <span>{name}</span>
          </div>
        ))}
      </div>
      <header className="firoza-identity">
        <img src={emblem} alt={`${name} logo`} width={1024} height={1024} />
        <h1 className="max-w-full break-words">{name}</h1>
        <div className="firoza-rule" aria-hidden="true" />
      </header>
      <div className="firoza-entries">
        <Button
          className="firoza-tile firoza-shop"
          onClick={() => enter("brandshops")}
          disabled={Boolean(busy)}
        >
          <ArrowUpRight className="firoza-tile-arrow" aria-hidden="true" />
          <span className="firoza-tile-icon">
            {busy === "brandshops" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Store strokeWidth={1.4} />
            )}
          </span>
          <span lang="bn">ব্র্যান্ডশপ</span>
        </Button>
        <Button
          className="firoza-tile firoza-house"
          onClick={() => enter("house")}
          disabled={Boolean(busy)}
        >
          <ArrowUpRight className="firoza-tile-arrow" aria-hidden="true" />
          <span className="firoza-tile-icon">
            {busy === "house" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Warehouse strokeWidth={1.4} />
            )}
          </span>
          <span lang="bn">হাউজ & স্টক</span>
        </Button>
      </div>
    </main>
  );
}
