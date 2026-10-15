import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Activity, Building2, MessageSquare, ShieldCheck, ShieldAlert } from "lucide-react";
export function GuardianNav() {
  return (
    <nav aria-label="Guardian pages" className="mb-6 flex flex-wrap gap-2 border-b pb-4">
      {[
        ["/app/guardian-owner", "Owner overview", ShieldCheck],
        ["/app/guardian-chat", "Ask Guardian", MessageSquare],
        ["/app/company-profile", "Company profile", Building2],
        ["/app/guardian-anomalies", "Anomaly reports", Activity],
        ["/app/guardian", "Alerts", ShieldAlert],
      ].map(([to, label, Icon]) => {
        const I = Icon as typeof ShieldCheck;
        return (
          <Button key={to as string} asChild variant="outline" size="sm">
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
