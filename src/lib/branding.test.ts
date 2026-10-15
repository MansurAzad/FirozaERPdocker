import { describe, expect, it } from "vitest";
import { companyName, matchedCompany } from "./branding";
import { BRAND_SHOPS } from "./home-entry";
describe("company identity", () => {
  it("defaults to the requested company", () => expect(companyName()).toBe("FIROZA ENTERPRISE"));
  it("uses the changed company name across page identity", () =>
    expect(
      matchedCompany([{ context: {} }, { context: { business: { name: "New Company" } } }]),
    ).toBe("New Company"));
  it("keeps exactly the six requested shop identities", () =>
    expect([...BRAND_SHOPS]).toEqual(["ViVO", "Xiaomi", "Techno", "iTel", "Infinix", "Honor"]));
});
