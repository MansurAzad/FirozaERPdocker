export const BRAND_SHOPS = ["ViVO", "Xiaomi", "Techno", "iTel", "Infinix", "Honor"] as const;
export type HomeEntry = "brandshops" | "house" | "sr";
export function entryDestination(entry: HomeEntry) {
  if (entry === "brandshops") return "/app/brand-shops";
  if (entry === "sr") return "/app/field-sales";
  return "/app";
}
export function entryRequiresLogin(hasSession: boolean) {
  return !hasSession;
}
export function pendingEntry(): HomeEntry | undefined {
  const value = sessionStorage.getItem("firoza.entry");
  return value === "brandshops" || value === "house" || value === "sr" ? value : undefined;
}
