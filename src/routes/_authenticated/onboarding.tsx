import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { friendlyError } from "@/lib/format";
import { useBranding } from "@/lib/branding-context";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Set up your business — FIROZA ENTERPRISE" },
      {
        name: "description",
        content: "Set up your business records and business operations in FIROZA ENTERPRISE.",
      },
      { property: "og:title", content: "Set up your business — FIROZA ENTERPRISE" },
      {
        property: "og:description",
        content: "Set up your business records and business operations in FIROZA ENTERPRISE.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Onboarding,
});

const TYPES = [
  {
    v: "retail",
    t: "Retail Mobile Shop",
    bn: "খুচরা মোবাইল দোকান",
    d: "Sell phones & accessories to end customers.",
  },
  {
    v: "wholesale",
    t: "Wholesale Mobile Dealer",
    bn: "পাইকারি ডিলার",
    d: "Bulk sales to shops and dealers with credit.",
  },
  { v: "both", t: "Retail + Wholesale", bn: "খুচরা + পাইকারি", d: "Run both operations together." },
] as const;

function Onboarding() {
  const branding = useBranding();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [type, setType] = useState<"retail" | "wholesale" | "both">("retail");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return void toast.error("Business name is required.");
    setBusy(true);
    const { error } = await supabase.rpc("create_business", {
      _name: name.trim(),
      _type: type,
      ...(phone ? { _phone: phone } : {}),
      ...(address ? { _address: address } : {}),
    });
    setBusy(false);
    if (error) return void toast.error(friendlyError(error));
    toast.success("Business created");
    navigate({ to: "/app", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <form onSubmit={submit} className="w-full max-w-2xl space-y-6">
        <div>
          <p className="text-sm font-medium text-primary">{branding.name}</p>
          <h1 className="mt-1 text-3xl font-bold">Set up your business</h1>
        </div>
        <div className="space-y-1.5">
          <Label>Business name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Nabil Telecom"
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01XXXXXXXXX"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Select business type</Label>
          <div className="grid gap-3 md:grid-cols-3">
            {TYPES.map((o) => (
              <button
                type="button"
                key={o.v}
                onClick={() => setType(o.v)}
                className={cn(
                  "rounded-lg border bg-card p-4 text-left transition-colors",
                  type === o.v
                    ? "border-primary ring-2 ring-primary/20"
                    : "hover:border-foreground/30",
                )}
              >
                <div className="font-semibold">{o.t}</div>
                <div className="text-sm text-primary">{o.bn}</div>
                <div className="mt-2 text-xs text-muted-foreground">{o.d}</div>
              </button>
            ))}
          </div>
        </div>
        <Button size="lg" disabled={busy}>
          Create business
        </Button>
      </form>
    </div>
  );
}
