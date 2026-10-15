export function bdt(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  return "৳ " + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export const BD_MOBILE = /^01[3-9]\d{8}$/;

export const ROLE_LABELS: Record<string, string> = {
  owner: "Business Owner",
  manager: "Manager",
  accountant: "Accountant",
  salesman: "Salesman",
  store_keeper: "Store Keeper",
  purchase_officer: "Purchase Officer",
  branch_manager: "Branch Manager",
  viewer: "Viewer",
};

export function friendlyError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (msg.includes("duplicate key")) {
    if (msg.includes("mobile")) return "This mobile number is already registered.";
    if (msg.includes("sku")) return "This SKU already exists.";
    return "This record already exists.";
  }
  if (msg.includes("row-level security")) return "You don't have permission to do this.";
  if (msg.includes("violates foreign key")) return "This record is in use and can't be removed.";
  if (msg.includes("check constraint") && msg.includes("mobile")) return "Enter a valid Bangladesh mobile number (01XXXXXXXXX).";
  return msg;
}
