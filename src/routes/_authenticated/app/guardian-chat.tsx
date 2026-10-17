import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { GuardianNav } from "@/components/erp/GuardianNav";
import { GuardianChat } from "@/components/erp/GuardianChat";
import { PageHeader } from "@/components/erp/EntityManager";
import { useBusiness } from "@/lib/business";
import { hasAccess } from "@/lib/access-control";
export const Route = createFileRoute("/_authenticated/app/guardian-chat")({
  validateSearch: (s: Record<string, unknown>) => ({
    brief: s["brief"] === true || s["brief"] === "true",
  }),
  head: ({ matches }) => ({
    meta: [
      { title: `Ask Guardian — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: "Session-only business AI conversation and Bangla or English voice commands.",
      },
      { property: "og:title", content: `Ask Guardian — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: "Read-only owner guidance from current business records.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ChatPage,
});
function ChatPage() {
  const { access, business } = useBusiness();
  const { brief } = Route.useSearch();
  return (
    <div className="mx-auto max-w-4xl">
      <GuardianNav />
      <PageHeader title="Ask Guardian" />
      {hasAccess(access, "guardian") ? (
        <GuardianChat key={business.id} brief={brief} />
      ) : (
        <p className="text-destructive">Guardian access has not been granted to this account.</p>
      )}
    </div>
  );
}
