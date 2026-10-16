import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Activity, Building2, MessageSquare, ShieldCheck, ShieldAlert } from "lucide-react";
export function GuardianNav() {
  return (
    <nav
      aria-label="Guardian pages"
      className="mb-6 grid grid-cols-2 gap-2 border-b pb-4 sm:grid-cols-3 xl:grid-cols-5"
    >
      {[
        ["/app/guardian-owner", "Owner overview", ShieldCheck],
        ["/app/guardian-chat", "Ask Guardian", MessageSquare],
        ["/app/company-profile", "Company profile", Building2],
        ["/app/guardian-anomalies", "Anomaly reports", Activity],
        ["/app/guardian", "Alerts", ShieldAlert],
      ].map(([to, label, Icon]) => {
        const I = Icon as typeof ShieldCheck;
        return (
          <Button
            key={to as string}
            asChild
            variant="outline"
            className="h-12 justify-start gap-2 px-3 text-left sm:h-14"
          >
            <Link to={to as string} activeProps={{ className: "bg-secondary text-primary" }}>
              <I />
              {label as string}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}
