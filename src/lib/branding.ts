import { z } from "zod";
export const DEFAULT_COMPANY_NAME = "FIROZA ENTERPRISE";
export function companyName(name?: string | null) {
  return name?.trim() || DEFAULT_COMPANY_NAME;
}
export function brandedTitle(title: string, name?: string | null) {
  return `${title} — ${companyName(name)}`;
}
export function matchedCompany(matches: unknown) {
  const parsed = z
    .array(
      z
        .object({
          context: z.object({ business: z.object({ name: z.string() }).optional() }).passthrough(),
        })
        .passthrough(),
    )
    .safeParse(matches);
  return companyName(
    parsed.success
      ? parsed.data.find((m) => m.context.business)?.context.business?.name
      : undefined,
  );
}
