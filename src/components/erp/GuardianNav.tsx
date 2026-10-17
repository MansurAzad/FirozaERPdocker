import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Activity, Building2, MessageSquare, ShieldCheck, ShieldAlert } from "lucide-react";
import { useBusiness } from "@/lib/business";
import { hasAccess } from "@/lib/access-control";

export function GuardianNav() {
  const { access } = useBusiness();
  return (
    <nav
      aria-label="Guardian pages"
      className="mb-6 grid grid-cols-2 gap-2 border-b pb-4 sm:grid-cols-3 xl:grid-cols-5"
    >
      {[
        {
          to: "/app/guardian-owner",
          label: "Owner overview",
          Icon: ShieldCheck,
          module: "guardian" as const,
        },
        {
          to: "/app/guardian-chat",
          label: "Ask Guardian",
          Icon: MessageSquare,
          module: "guardian" as const,
        },
        {
          to: "/app/company-profile",
          label: "Company profile",
          Icon: Building2,
          module: "company_profile" as const,
        },
        {
          to: "/app/guardian-anomalies",
          label: "Anomaly reports",
          Icon: Activity,
          module: "guardian" as const,
        },
        {
          to: "/app/guardian",
          label: "Alerts",
          Icon: ShieldAlert,
          module: "guardian" as const,
        },
      ]
        .filter((item) => hasAccess(access, item.module))
        .map(({ to, label, Icon }) => {
          return (
            <Button
              key={to}
              asChild
              variant="outline"
              className="h-12 justify-start gap-2 px-3 text-left sm:h-14"
            >
              <Link to={to} activeProps={{ className: "bg-secondary text-primary" }}>
                <Icon />
                {label}
              </Link>
            </Button>
          );
        })}
    </nav>
  );
}
