import { Link, useRouterState } from "@tanstack/react-router";
import { House, ShoppingCart, Boxes, Wallet, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useBusiness } from "@/lib/business";
import { hasAccess } from "@/lib/access-control";

export function MobileBottomNav({ onMenu, menuOpen }: { onMenu: () => void; menuOpen: boolean }) {
  const { lang } = useI18n();
  const { access } = useBusiness();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const items = [
    {
      to: "/app/sales/new",
      icon: ShoppingCart,
      module: "sales",
      en: "Sales",
      bn: "বিক্রি",
      active: pathname.startsWith("/app/sales"),
    },
    {
      to: "/app/stock",
      icon: Boxes,
      module: "inventory",
      en: "Stock",
      bn: "স্টক",
      active: pathname === "/app/stock",
    },
    {
      to: "/app",
      icon: House,
      module: "dashboard",
      en: "Home",
      bn: "হোম",
      active: pathname === "/app" || pathname === "/app/",
    },
    {
      to: "/app/money",
      icon: Wallet,
      module: "cash_bank",
      en: "Money",
      bn: "হিসাব",
      active: pathname === "/app/money",
    },
  ] as const;
  const accessibleItems = items.filter((item) => hasAccess(access, item.module));
  const itemClass =
    "h-14 min-w-0 flex-col gap-1 rounded-md px-1 py-2 text-[11px] leading-4 [&_svg]:size-5";

  return (
    <nav
      aria-label={lang === "bn" ? "মোবাইল নেভিগেশন" : "Mobile navigation"}
      className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-40 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden print:hidden"
    >
      <div
        className="grid gap-1 px-2 py-1"
        style={{ gridTemplateColumns: `repeat(${accessibleItems.length + 1}, minmax(0, 1fr))` }}
      >
        {accessibleItems.map((item) => (
          <Button
            key={item.to}
            asChild
            variant="ghost"
            className={cn(
              itemClass,
              item.active && !menuOpen ? "bg-secondary text-primary" : "text-muted-foreground",
            )}
          >
            <Link to={item.to} aria-current={item.active && !menuOpen ? "page" : undefined}>
              <item.icon aria-hidden="true" />
              <span>{lang === "bn" ? item.bn : item.en}</span>
            </Link>
          </Button>
        ))}
        <Button
          type="button"
          variant="ghost"
          onClick={onMenu}
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          className={cn(
            itemClass,
            menuOpen ? "bg-secondary text-primary" : "text-muted-foreground",
          )}
        >
          <Menu aria-hidden="true" />
          <span>{lang === "bn" ? "সব মেনু" : "Menu"}</span>
        </Button>
      </div>
    </nav>
  );
}
