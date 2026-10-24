import type { Business, Role } from "@/lib/business";

type MembershipRow = {
  role: Role;
  business?: Business | null;
  businesses?: Business | null;
};

export type Membership = { business: Business; role: Role };

export function normalizeBusinessMemberships(
  rows: MembershipRow[] | null | undefined,
): Membership[] {
  return (rows ?? []).flatMap((membership) => {
    const business = membership.business ?? membership.businesses;
    if (!business) return [];
    return [{ business, role: membership.role }];
  });
}
