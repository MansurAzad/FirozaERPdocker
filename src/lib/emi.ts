import type { Role } from "@/lib/business";

export const EMI_ROLES: readonly Role[] = ["owner", "manager", "purchase_officer", "salesman", "accountant"] as const;
export const EMI_PLAN_WRITE_ROLES: readonly Role[] = ["owner", "manager", "purchase_officer", "accountant"] as const;

export function canUseEmi(role: Role) {
  return (EMI_ROLES as readonly string[]).includes(role);
}
export function canWriteEmiPlans(role: Role) {
  return (EMI_PLAN_WRITE_ROLES as readonly string[]).includes(role);
}

export const EMI_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  closed: "Closed",
  early_settled: "Early settled",
  defaulted: "Defaulted",
  cancelled: "Cancelled",
  due: "Due",
  partially_paid: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
};

export function emiDueIn(dueDate: string) {
  const d = new Date(dueDate);
  const t = new Date();
  const days = Math.floor((d.getTime() - t.getTime()) / 86400000);
  return days;
}
