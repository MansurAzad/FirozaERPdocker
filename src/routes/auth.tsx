import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "@/components/auth-page";
import { getSiteBranding } from "@/lib/branding.functions";

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
  component: AuthRoute,
});

function AuthRoute() {
  const { entry } = Route.useSearch();
  return <AuthPage entry={entry} />;
}
