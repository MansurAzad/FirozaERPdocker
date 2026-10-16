import { expect, it } from "vitest";
import { canReadGuardian, profileSchema, canCloseWarrantyWithoutStock } from "./safety";
it("owner can read Guardian financial intelligence", () => {
  expect(canReadGuardian("owner")).toBe(true);
});
it("salesman cannot read owner financial intelligence", () => {
  expect(canReadGuardian("salesman")).toBe(false);
});
it("status-only replacement cannot close a warranty claim without stock records", () => {
  expect(canCloseWarrantyWithoutStock("replaced")).toBe(false);
});
it("company profile rejects an empty company name", () => {
  expect(
    profileSchema.safeParse({
      name: "",
      phone: "",
      address: "",
      trade_license: "",
      guardian_profile: {
        contact_person: "",
        email: "",
        website: "",
        business_hours: "",
        notes: "",
      },
    }).success,
  ).toBe(false);
});
