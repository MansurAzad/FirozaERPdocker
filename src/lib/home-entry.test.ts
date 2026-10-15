import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { BRAND_SHOPS, entryDestination, entryRequiresLogin } from "./home-entry";
describe("Firoza entry rules", () => {
  it("requires login for signed-out visitors", () => { assert.equal(entryRequiresLogin(false), true); assert.equal(entryRequiresLogin(true), false); });
  it("opens the brand-shop module", () => { assert.equal(entryDestination("brandshops"), "/app/brand-shops"); });
  it("opens House & Stock inside the app", () => { assert.equal(entryDestination("house"), "/app"); });
  it("contains exactly the six requested shops", () => { assert.deepEqual([...BRAND_SHOPS], ["ViVO", "Xiaomi", "Techno", "iTel", "Infinix", "Honor"]); });
});
