import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { entryDestination, pendingEntry } from "@/lib/home-entry";
import { useBranding } from "@/lib/branding-context";
import emblem from "@/assets/firoza-emblem.png";

type AuthPageProps = {
  entry?: "brandshops" | "house" | undefined;
};

export function AuthPage({ entry }: AuthPageProps) {
  const { name } = useBranding();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const redirectStarted = useRef(false);

  useEffect(() => {
    let active = true;
    if (entry) sessionStorage.setItem("firoza.entry", entry);
    const proceed = () => {
      if (!active || redirectStarted.current) return;
      redirectStarted.current = true;
      void navigate({ to: entryDestination(pendingEntry() ?? "house"), replace: true }).catch(
        (error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not open the requested page. Try again.",
          );
          redirectStarted.current = false;
        },
      );
    };
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          toast.error("Could not check your existing sign-in. Please try again.");
          return;
        }
        if (
          data.session &&
          (!data.session.expires_at || data.session.expires_at * 1000 > Date.now())
        )
          proceed();
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : "Could not check your existing sign-in.",
        );
      });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" || !session) return;
      window.setTimeout(proceed, 0);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [navigate, entry]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return void toast.error("Password must be at least 8 characters.");
    setBusy(true);
    try {
      const res =
        mode === "in"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: window.location.origin + "/app" },
            });
      if (res.error) {
        toast.error(res.error.message);
        return;
      }
      if (mode === "up" && !res.data.session)
        toast.success("Check your email to confirm your account.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Sign-in failed. Check your connection and retry.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    try {
      const r = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + "/auth",
      });
      if (r.error) toast.error(String(r.error.message ?? r.error));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Google sign-in failed. Please try again.",
      );
    }
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
              autoComplete="username"
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
              autoComplete={mode === "in" ? "current-password" : "new-password"}
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
