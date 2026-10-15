export const BRAND_SHOPS = ["ViVO", "Xiaomi", "Techno", "iTel", "Infinix", "Honor"] as const;
export type HomeEntry = "brandshops" | "house";
export function entryDestination(entry: HomeEntry) { return entry === "brandshops" ? "/app/brand-shops" : "/app"; }
export function entryRequiresLogin(hasSession: boolean) { return !hasSession; }
export function pendingEntry(): HomeEntry | undefined {
  const value = sessionStorage.getItem("firoza.entry");
  return value === "brandshops" || value === "house" ? value : undefined;
}