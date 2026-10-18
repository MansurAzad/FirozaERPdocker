import { describe, expect, it } from "vitest";
import { fullAccessMatrix, hasAccess, moduleForPath } from "./access-control";

describe("page access mapping", () => {
  it("maps nested routes to their module and normalizes trailing slashes", () => {
    expect(moduleForPath("/app/sales/new")).toBe("sales");
    expect(moduleForPath("/app/emi/plans/new/")).toBe("emi");
    expect(moduleForPath("/app/guardian-owner")).toBe("guardian");
    expect(moduleForPath("/app/money")).toBe("cash_bank");
    expect(moduleForPath("/app/partner-finance/settlements")).toBe("sales");
    expect(moduleForPath("/app/")).toBe("dashboard");
  });

  it("denies unknown routes and unconfigured actions", () => {
    expect(moduleForPath("/app/not-a-real-page")).toBeNull();
    expect(hasAccess({}, "sales")).toBe(false);
    expect(hasAccess({ sales: { create: true } }, "sales")).toBe(false);
  });

  it("allows only explicit module permissions and provides full owner access", () => {
    expect(hasAccess({ sales: { view: true } }, "sales")).toBe(true);
    expect(hasAccess({ sales: { view: true } }, "sales", "delete")).toBe(false);
    expect(hasAccess(fullAccessMatrix(), "backup", "delete")).toBe(true);
  });
});
