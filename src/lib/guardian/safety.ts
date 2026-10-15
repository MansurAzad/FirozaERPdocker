import { z } from "zod";
export const guardianRoles = ["owner", "manager", "accountant"];
export const canReadGuardian = (role: string) => guardianRoles.includes(role);
export const canCloseWarrantyWithoutStock = (status: string) =>
  ["resolved", "rejected"].includes(status);
export const profileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30),
  address: z.string().trim().max(500),
  trade_license: z.string().trim().max(100),
  guardian_profile: z.object({
    contact_person: z.string().trim().max(100),
    email: z.union([z.string().email().max(200), z.literal("")]),
    website: z.union([z.string().url().max(300), z.literal("")]),
    business_hours: z.string().trim().max(200),
    notes: z.string().trim().max(2000),
  }),
});
export function safeRecommendation(code: string) {
  if (code === "below_cost")
    return "Verify the original purchase cost, selling price and discount against documents. If genuine, retain the loss. If an entry error, use an approved return and re-enter the sale only when the actual stock/payment movements support it; never overwrite the posted invoice.";
  if (code === "low_stock")
    return "Physically count each branch and check pending transfers first. If zero stock is correct, post an approved purchase with one IMEI per phone. The reorder level is a trigger, not a purchase order; confirm demand, supplier price and available funds.";
  return "Review the source records and audit trail with the owner or accountant. Use the existing approved correction workflow; do not directly alter posted transactions.";
}
