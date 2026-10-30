import { ACCESS_ACTIONS, type AccessAction, type AccessModule } from "@/lib/access-control";

export const SHOP_PERMISSION_MODULES = [
  { module: "sales", label: "Sales" },
  { module: "inventory", label: "Inventory" },
  { module: "stock_adjustments", label: "Stock adjustments" },
  { module: "transfers", label: "Stock transfers" },
  { module: "customers", label: "Customers" },
  { module: "cash_bank", label: "Cash & bank" },
  { module: "closing", label: "Daily closing" },
] as const satisfies readonly { module: AccessModule; label: string }[];

export type MemberPermissionRow = {
  access_role_id: string | null;
  allowed: boolean;
  module: string;
  permission: string;
  user_id: string | null;
};

export type ShopAccessMember = {
  access_role_id: string | null;
  role: string;
  user_id: string;
};

export function effectiveModulePermissions(
  member: ShopAccessMember,
  rows: MemberPermissionRow[],
  module: AccessModule,
): AccessAction[] {
  if (member.role === "owner") return ACCESS_ACTIONS.map(({ key }) => key);

  const isAllowed = (permission: AccessAction) => {
    const personal = rows.find(
      (row) =>
        row.user_id === member.user_id && row.module === module && row.permission === permission,
    );
    const inherited = rows.find(
      (row) =>
        member.access_role_id !== null &&
        row.access_role_id === member.access_role_id &&
        row.module === module &&
        row.permission === permission,
    );
    return (personal ?? inherited)?.allowed === true;
  };

  if (!isAllowed("view")) return [];
  return ACCESS_ACTIONS.flatMap(({ key }) => (isAllowed(key) ? [key] : []));
}
