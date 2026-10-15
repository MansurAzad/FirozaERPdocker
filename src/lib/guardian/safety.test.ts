import { test } from "node:test";
import assert from "node:assert/strict";
import { canReadGuardian, profileSchema, canCloseWarrantyWithoutStock } from "./safety";
test("owner can read Guardian financial intelligence", () =>
  assert.equal(canReadGuardian("owner"), true));
test("salesman cannot read owner financial intelligence", () =>
  assert.equal(canReadGuardian("salesman"), false));
test("status-only replacement cannot close a warranty claim without stock records", () =>
  assert.equal(canCloseWarrantyWithoutStock("replaced"), false));
test("company profile rejects an empty company name", () =>
  assert.equal(
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
    false,
  ));
