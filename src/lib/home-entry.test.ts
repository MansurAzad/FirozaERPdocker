import { describe, expect, it } from "vitest";
import { BRAND_SHOPS, entryDestination, entryRequiresLogin } from "./home-entry";
describe("Firoza entry rules", () => {
  it("requires login for signed-out visitors", () => {
    expect(entryRequiresLogin(false)).toBe(true);
    expect(entryRequiresLogin(true)).toBe(false);
  });
  it("opens the brand-shop module", () => {
    expect(entryDestination("brandshops")).toBe("/app/brand-shops");
  });
  it("opens House & Stock inside the app", () => {
    expect(entryDestination("house")).toBe("/app");
  });
  it("contains exactly the six requested shops", () => {
    expect([...BRAND_SHOPS]).toEqual(["ViVO", "Xiaomi", "Techno", "iTel", "Infinix", "Honor"]);
  });
});
