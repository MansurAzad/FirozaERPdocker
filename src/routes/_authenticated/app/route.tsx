import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCallback, useEffect, useMemo, useState } from "react";
import emblem from "@/assets/firoza-emblem.png";
import {
  LayoutDashboard,
  ShoppingCart,
  Truck,
  Boxes,
  Package,
  Users,
  Building2,
  Wallet,
  Receipt,
  BookOpen,
  BarChart3,
  ShieldCheck,
  GitBranch,
  History,
  Tags,
  Layers,
  Menu,
  LogOut,
  Handshake,
  ScanLine,
  HandCoins,
  CalendarCheck,
  ArrowLeftRight,
  Wrench,
  Percent,
  DatabaseBackup,
  ChevronRight,
  ChevronLeft,
  Maximize,
  Search,
  HelpCircle,
  ShieldAlert,
  ClipboardList,
  FileText,
  Undo2,
  SlidersHorizontal,
  Barcode,
  Link2,
  TrendingDown,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { BusinessProvider, type Business, type Role, useBusiness } from "@/lib/business";
import { useI18n, type TKey } from "@/lib/i18n";
import { ROLE_LABELS } from "@/lib/format";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CommandPalette } from "@/components/erp/CommandPalette";
import { useAppShortcuts, toggleFullscreen, SHORTCUTS } from "@/lib/shortcuts";
import { pendingEntry } from "@/lib/home-entry";
import { VisitLogger } from "@/components/erp/VisitLogger";
import { MobileBottomNav } from "@/components/erp/MobileBottomNav";
import { NotificationBell } from "@/components/erp/NotificationBell";

export const Route = createFileRoute("/_authenticated/app")({
  beforeLoad: async ({ context }) => {
    type Membership = { business: Business; role: Role };
    const membershipsKey = ["offline-business-memberships", context.user.id] as const;
    let memberships = context.queryClient.getQueryData<Membership[]>(membershipsKey);
    if (typeof navigator === "undefined" || navigator.onLine || !memberships) {
      const { data, error } = await supabase
        .from("business_members")
        .select("role, businesses(*)")
        .eq("user_id", context.user.id)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) {
        if (typeof navigator === "undefined" || navigator.onLine || !memberships) throw error;
      } else {
        memberships = (data ?? []).flatMap((membership) =>
          membership.businesses
            ? [{ business: membership.businesses, role: membership.role as Role }]
            : [],
        );
        context.queryClient.setQueryData(membershipsKey, memberships);
      }
    }
    memberships ??= [];
    if (memberships.length === 0) throw redirect({ to: "/onboarding" });
    const preferredId =
      typeof window === "undefined"
        ? null
        : localStorage.getItem(`derp.business.${context.user.id}`);
    const selected =
      memberships.find((membership) => membership.business.id === preferredId) ?? memberships[0]!;
    return { ...selected, memberships };
  },
  component: AppLayout,
});

type NavItem = {
  to?: string;
  icon: typeof LayoutDashboard;
  k: TKey;
  soon?: boolean;
  roles?: Role[];
};
const EMI_ROLES_NAV: Role[] = ["owner", "manager", "purchase_officer", "salesman", "accountant"];
const NAV: { group?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: "/app", icon: LayoutDashboard, k: "dashboard" },
      { to: "/app/guardian-owner", icon: ShieldAlert, k: "guardian" },
    ],
  },
  {
    group: "Catalog",
    items: [
      { to: "/app/brand-shops", icon: Building2, k: "branches" },
      { to: "/app/products", icon: Package, k: "products" },
      { to: "/app/brands", icon: Tags, k: "brands" },
      { to: "/app/categories", icon: Layers, k: "categories" },
    ],
  },
  {
    group: "Sales",
    items: [
      { to: "/app/sales/new", icon: ShoppingCart, k: "newSale" },
      { to: "/app/sales", icon: Receipt, k: "salesHistory" },
      { to: "/app/quotations", icon: FileText, k: "quotations" },
      { to: "/app/orders", icon: CalendarCheck, k: "orders" },
      { to: "/app/courier", icon: Truck, k: "courier" },
      { to: "/app/emi", icon: Receipt, k: "emi", roles: EMI_ROLES_NAV },
      { to: "/app/due-collection", icon: HandCoins, k: "dueCollection" },
    ],
  },
  {
    group: "Parties",
    items: [
      { to: "/app/customers", icon: Users, k: "customers" },
      { to: "/app/customer-portal", icon: Link2, k: "customerPortal" },
      { to: "/app/suppliers", icon: Handshake, k: "suppliers" },
      { to: "/app/ledger", icon: BookOpen, k: "ledger" },
    ],
  },
  {
    group: "Purchase & Stock",
    items: [
      { to: "/app/purchases", icon: Truck, k: "purchase" },
      { to: "/app/purchase-orders", icon: ClipboardList, k: "purchaseOrders" },
      { to: "/app/purchase-returns", icon: Undo2, k: "purchaseReturns" },
      { to: "/app/stock", icon: Boxes, k: "inventory" },
      { to: "/app/stock-adjustments", icon: SlidersHorizontal, k: "stockAdjustments" },
      { to: "/app/reorder", icon: ClipboardList, k: "reorder" },
      { to: "/app/labels", icon: Barcode, k: "labels" },
      { to: "/app/bulk-price", icon: Percent, k: "bulkPrice" },
      { to: "/app/imei", icon: ScanLine, k: "imei" },
      { to: "/app/transfers", icon: ArrowLeftRight, k: "transfers" },
      { to: "/app/service", icon: Wrench, k: "service" },
      { to: "/app/warranty", icon: Wrench, k: "warranty" },
      { to: "/app/supplier-payments", icon: HandCoins, k: "supplierPayments" },
    ],
  },
  {
    group: "Money",
    items: [
      { to: "/app/money", icon: Wallet, k: "cashBank" },
      { to: "/app/bank-reconciliation", icon: Wallet, k: "bankReconciliation" },
      { to: "/app/expenses", icon: Receipt, k: "expenses" },
      { to: "/app/closing", icon: CalendarCheck, k: "closing" },
      { to: "/app/accounting", icon: BookOpen, k: "accounting" },
    ],
  },
  {
    group: "Operations",
    items: [
      { to: "/app/reports", icon: BarChart3, k: "reports" },
      { to: "/app/supplier-aging", icon: HandCoins, k: "supplierAging" },
      { to: "/app/dead-slow-stock", icon: TrendingDown, k: "deadSlowStock" },
      { to: "/app/tasks", icon: ClipboardList, k: "tasks" },
      { to: "/app/commission", icon: Percent, k: "commission" },
      { to: "/app/dealers", icon: Handshake, k: "dealers" },
    ],
  },
  {
    group: "Admin",
    items: [
      { to: "/app/company-profile", icon: Building2, k: "settings" },
      { to: "/app/daily-reports", icon: CalendarCheck, k: "dailyReports" },
      { to: "/app/branches", icon: GitBranch, k: "branches" },
      { to: "/app/team", icon: ShieldCheck, k: "team" },
      { to: "/app/audit", icon: History, k: "audit" },
      { to: "/app/sync-history", icon: History, k: "syncHistory" },
      { to: "/app/usage", icon: BarChart3, k: "usage" },
      { to: "/app/backup", icon: DatabaseBackup, k: "backup" },
      { to: "/app/guide", icon: HelpCircle, k: "guide" },
    ],
  },
];

function SidebarNav({ onNav, compact = false }: { onNav?: () => void; compact?: boolean }) {
  const { t } = useI18n();
  const { role } = useBusiness();
  const hasRole = (r?: Role[]) => !r || r.includes(role);
  return (
    <nav
      className={cn("flex-1 overflow-y-auto px-3", compact ? "space-y-3 py-2" : "space-y-5 py-4")}
    >
      {NAV.map((g, i) => (
        <div key={i}>
          {g.group && (
            <div className="mb-1.5 px-3 text-[10px] font-bold uppercase text-sidebar-foreground/45">
              {g.group}
            </div>
          )}
          {g.items
            .filter((it) => hasRole(it.roles))
            .map((it) =>
              it.soon ? (
                <div
                  key={it.k}
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/40"
                >
                  <it.icon className="h-4 w-4" />
                  {t(it.k)}
                  <span className="ml-auto rounded bg-sidebar-accent px-1.5 text-[10px]">
                    {t("comingSoon")}
                  </span>
                </div>
              ) : (
                <Link
                  key={it.to ?? it.k}
                  to={it.to ?? "/app"}
                  onClick={onNav}
                  activeOptions={{ exact: it.to === "/app" }}
                  className={cn(
                    "flex min-h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    compact ? "py-1.5" : "py-2",
                  )}
                  activeProps={{
                    className: "bg-sidebar-accent !text-sidebar-primary font-semibold shadow-sm",
                  }}
                >
                  <it.icon className="h-4 w-4" />
                  {it.to === "/app/brand-shops" ? t("brandShops") : t(it.k)}
                </Link>
              ),
            )}
        </div>
      ))}
    </nav>
  );
}

function AppLayout() {
  const { business: initialBusiness, role, user, memberships } = Route.useRouteContext();
  const { data: business = initialBusiness } = useQuery({
    queryKey: ["business-identity", initialBusiness.id],
    initialData: initialBusiness,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("businesses")
        .select("*")
        .eq("id", initialBusiness.id)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const { t, lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState(false);
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    if (pendingEntry() === "house") setPalette(true);
    sessionStorage.removeItem("firoza.entry");
  }, []);
  useEffect(() => {
    setSide(localStorage.getItem("derp.sidebar") === "1");
  }, []);
  const toggleSide = useCallback(
    () =>
      setSide((s) => {
        localStorage.setItem("derp.sidebar", s ? "0" : "1");
        return !s;
      }),
    [],
  );
  const qc = useQueryClient();
  const router = useRouter();
  async function switchBusiness(businessId: string) {
    localStorage.setItem(`derp.business.${user.id}`, businessId);
    qc.clear();
    await router.invalidate();
  }
  // Shared cloud data is refreshed while the app is visible, including other devices' edits.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible")
        void qc.invalidateQueries({ refetchType: "active" });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [qc, business.id]);
  const navigate = useNavigate();

  const { data: alertCount = 0 } = useQuery({
    queryKey: ["guardian-count", business.id],
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const { count } = await supabase
        .from("guardian_alerts")
        .select("id", { count: "exact", head: true })
        .eq("business_id", business.id)
        .eq("status", "open")
        .in("severity", ["critical", "high"]);
      return count ?? 0;
    },
  });
  useEffect(() => {
    if (!alertCount || sessionStorage.getItem("derp.guardianToast") === String(alertCount)) return;
    sessionStorage.setItem("derp.guardianToast", String(alertCount));
    toast.warning(`Guardian: ${alertCount} important issue(s) need attention`, {
      action: { label: "View", onClick: () => navigate({ to: "/app/guardian" }) },
    });
  }, [alertCount, navigate]);
  const handlers = useMemo(
    () => ({
      navigate: (to: string) => navigate({ to }),
      palette: () => setPalette((p) => !p),
      sidebar: () => {
        if (window.innerWidth < 768) setOpen((o) => !o);
        else toggleSide();
      },
    }),
    [navigate, toggleSide],
  );
  useAppShortcuts(handlers);
  const groups = useMemo(
    () =>
      NAV.map((g) => {
        const items = g.items.filter((i) => i.to && (!i.roles || i.roles.includes(role)));
        return {
          group: g.group ?? "Home",
          items: items.map((i) => ({
            to: i.to ?? "/app",
            label: i.to === "/app/brand-shops" ? t("brandShops") : t(i.k),
            icon: i.icon,
            key: SHORTCUTS.find((s) => s.to === i.to)?.keys,
          })),
        };
      }),
    [t, role],
  );

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const brand = (
    <div className="border-b border-sidebar-border px-4 py-3 md:px-5 md:py-5">
      <div className="break-words font-display text-lg font-bold text-sidebar-accent-foreground">
        {business.name}
      </div>
      {memberships.length > 1 && (
        <select
          aria-label="Active business"
          className="mt-3 h-8 w-full rounded-md border border-sidebar-border bg-sidebar px-2 text-xs text-sidebar-foreground"
          value={business.id}
          onChange={(event) => void switchBusiness(event.currentTarget.value)}
        >
          {memberships.map((membership) => (
            <option key={membership.business.id} value={membership.business.id}>
              {membership.business.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );

  return (
    <BusinessProvider value={{ business, role, userId: user.id, email: user.email ?? "" }}>
      <div className="app-shell flex h-svh min-h-0 w-full min-w-0 touch-manipulation overflow-hidden bg-background">
        {side ? (
          <aside className="hidden h-full w-64 shrink-0 flex-col bg-sidebar shadow-xl md:flex">
            {brand}
            <SidebarNav />
            <button
              type="button"
              onClick={toggleSide}
              title="Hide sidebar (Ctrl+B)"
              className="flex items-center justify-center gap-1 border-t border-sidebar-border py-2 text-xs text-sidebar-foreground/70 hover:text-sidebar-accent-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
              Hide
            </button>
          </aside>
        ) : (
          <button
            type="button"
            onClick={toggleSide}
            title="Show sidebar (Ctrl+B)"
            aria-label="Show sidebar"
            className="fixed left-0 top-1/2 z-30 hidden h-12 w-5 -translate-y-1/2 items-center justify-center rounded-r-md bg-sidebar text-sidebar-foreground shadow-lg hover:w-7 hover:text-sidebar-primary md:flex transition-all"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
        <CommandPalette
          open={palette}
          onOpenChange={setPalette}
          groups={groups}
          businessId={business.id}
        />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="right" className="flex w-64 flex-col gap-0 border-0 bg-sidebar p-0">
            {brand}
            <Button
              type="button"
              variant="ghost"
              onClick={() => void signOut()}
              className="mx-2 mt-2 h-9 justify-start gap-3 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut className="h-4 w-4" />
              {t("signOut")}
            </Button>
            <div className="mx-2 mt-1 flex items-center justify-between rounded-md px-2 py-1 text-sm text-sidebar-foreground">
              <span>{lang === "bn" ? "ভাষা" : "Language"}</span>
              <div className="flex rounded-md border border-sidebar-border bg-sidebar-accent p-0.5">
                {(["en", "bn"] as const).map((language) => (
                  <Button
                    key={language}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setLang(language)}
                    className={cn(
                      "h-7 px-2 text-xs",
                      lang === language && "bg-card text-foreground shadow-sm hover:bg-card",
                    )}
                  >
                    {language === "en" ? "EN" : "বাং"}
                  </Button>
                ))}
              </div>
            </div>
            <SidebarNav onNav={() => setOpen(false)} compact />
          </SheetContent>
        </Sheet>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="app-header relative z-20 grid h-16 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b bg-card/95 px-3 shadow-sm backdrop-blur md:px-8 print:hidden">
            <div className="flex min-w-0 items-center gap-3">
              <img
                src={emblem}
                alt={`${business.name} logo`}
                className="h-9 w-9 shrink-0 object-contain lg:hidden"
                width={36}
                height={36}
              />
              <div className="hidden h-9 w-9 shrink-0 place-items-center rounded-md bg-secondary lg:grid">
                <Building2 className="h-4 w-4 text-primary" />
              </div>
              <div className="hidden min-w-0 lg:block">
                <p className="truncate text-sm font-semibold">{business.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {ROLE_LABELS[role]} · {user.email}
                </p>
              </div>
            </div>
            <div className="pointer-events-none absolute left-1/2 top-1/2 w-[calc(100%-6rem)] -translate-x-1/2 -translate-y-1/2 truncate text-center text-base font-bold sm:text-lg md:text-xl lg:hidden">
              FIROZA ENTERPRISE
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="hidden items-center gap-2 lg:flex">
                <NotificationBell />
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="relative"
                  title="Owner Guardian alerts"
                >
                  <Link to="/app/guardian" aria-label="Guardian alerts">
                    <ShieldAlert
                      className={cn(
                        "h-4 w-4",
                        alertCount ? "text-destructive" : "text-muted-foreground",
                      )}
                    />
                    {alertCount > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                        {alertCount}
                      </span>
                    )}
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPalette(true)}
                  className="hidden gap-2 text-muted-foreground md:inline-flex"
                  title="Menu & search (Ctrl+K)"
                >
                  <Search className="h-4 w-4" />
                  Menu & search
                  <kbd className="rounded border bg-muted px-1 text-[10px]">Ctrl K</kbd>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  onClick={() => setPalette(true)}
                  aria-label="Search"
                >
                  <Search className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden md:inline-flex"
                  onClick={toggleFullscreen}
                  aria-label="Full screen"
                  title="Full screen (Ctrl+Shift+F)"
                >
                  <Maximize className="h-4 w-4" />
                </Button>
                <div className="flex rounded-md border bg-secondary p-0.5 text-xs">
                  {(["en", "bn"] as const).map((l) => (
                    <Button
                      key={l}
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setLang(l)}
                      className={cn(
                        "h-7 px-2 text-xs",
                        lang === l
                          ? "bg-card text-foreground shadow-sm hover:bg-card"
                          : "text-muted-foreground",
                      )}
                    >
                      {l === "en" ? "EN" : "বাং"}
                    </Button>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={signOut}
                  aria-label={t("signOut")}
                  title={t("signOut")}
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setOpen(true)}
                aria-label={lang === "bn" ? "মেনু" : "Menu"}
                aria-expanded={open}
                aria-haspopup="dialog"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </div>
          </header>
          <main className="app-mobile-content min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain p-3 sm:p-6 lg:p-8">
            <div className="mx-auto w-full min-w-0 max-w-[1600px]">
              <div className="mb-5 hidden border-b pb-3 print:block">
                <h2 className="text-xl font-bold">{business.name}</h2>
                <p className="text-sm">
                  {business.address} {business.phone}
                </p>
              </div>
              <VisitLogger businessId={business.id} />
              <Outlet />
            </div>
          </main>
          <MobileBottomNav onMenu={() => setOpen(true)} menuOpen={open} />
        </div>
      </div>
    </BusinessProvider>
  );
}
