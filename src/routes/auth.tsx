import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { entryDestination, pendingEntry } from "@/lib/home-entry";
import { useBranding } from "@/lib/branding-context";
import { getSiteBranding } from "@/lib/branding.functions";
import emblem from "@/assets/firoza-emblem.png";

export const Route = createFileRoute("/auth")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { entry?: "brandshops" | "house" | undefined } => ({
    entry:
      search["entry"] === "brandshops" || search["entry"] === "house" ? search["entry"] : undefined,
  }),
  loader: () => getSiteBranding(),
  head: ({ loaderData }) => ({
    meta: [
      { title: `Sign in — ${loaderData?.name ?? "FIROZA ENTERPRISE"}` },
      {
        name: "description",
        content: `Sign in to ${loaderData?.name ?? "FIROZA ENTERPRISE"} business accounts.`,
      },
      { property: "og:title", content: `Sign in — ${loaderData?.name ?? "FIROZA ENTERPRISE"}` },
      { property: "og:description", content: "Access your mobile business ERP." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { name } = useBranding();
  const navigate = useNavigate();
  const { entry } = Route.useSearch();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const redirectStarted = useRef(false);

  useEffect(() => {
    if (entry) sessionStorage.setItem("firoza.entry", entry);
    const proceed = () => {
      if (redirectStarted.current) return;
      redirectStarted.current = true;
      void navigate({ to: entryDestination(pendingEntry() ?? "house"), replace: true });
    };
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) proceed();
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" || !session) return;
      window.setTimeout(proceed, 0);
    });
    return () => data.subscription.unsubscribe();
  }, [navigate, entry]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return void toast.error("Password must be at least 8 characters.");
    setBusy(true);
    const res =
      mode === "in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin + "/app" },
          });
    setBusy(false);
    if (res.error) return void toast.error(res.error.message);
    if (mode === "up" && !res.data.session)
      toast.success("Check your email to confirm your account.");
  }

  async function google() {
    const r = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/auth",
    });
    if (r.error) toast.error(String(r.error.message ?? r.error));
  }

  return (
    <div className="grid min-h-screen min-h-svh md:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground md:flex">
        <div className="font-display text-lg font-bold text-sidebar-accent-foreground">{name}</div>
        <div>
          <p className="text-3xl font-display font-semibold leading-snug text-sidebar-accent-foreground">
            আজ কত বিক্রি হয়েছে? কার কাছে কত পাওনা?
          </p>
          <p className="mt-3 text-sidebar-foreground/70">Answers in one glance, every day.</p>
        </div>
        <p className="text-xs text-sidebar-foreground/50">
          মোবাইল ব্যবসার সম্পূর্ণ ডিজিটাল ব্যবস্থাপনা
        </p>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div className="flex items-center gap-3">
            <img src={emblem} alt="" className="h-14 w-14 object-contain" />
            <p className="break-words text-lg font-bold">{name}</p>
          </div>
          <h1 className="text-2xl font-bold">
            {mode === "in" ? "Welcome back" : "Create your account"}
          </h1>
          <Button type="button" variant="outline" className="w-full" onClick={google}>
            Continue with Google
          </Button>
          <div className="text-center text-xs text-muted-foreground">or with email</div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw">Password</Label>
            <Input
              id="pw"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button className="w-full" disabled={busy}>
            {mode === "in" ? "Sign in" : "Sign up"}
          </Button>
          <button
            type="button"
            className="w-full text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setMode(mode === "in" ? "up" : "in")}
          >
            {mode === "in" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
