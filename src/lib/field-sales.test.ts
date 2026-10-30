import { describe, expect, it } from "vitest";
import {
  fieldSalesRemainingQty,
  fieldSalesReturnCountMatches,
  matchesFieldSalesImei,
} from "./field-sales";

describe("field-sales trip reconciliation", () => {
  it("calculates custody stock after sales, good returns and damage", () => {
    expect(fieldSalesRemainingQty(10, 2, 1, 4)).toBe(3);
    expect(fieldSalesRemainingQty(2, 1, 1, 0)).toBe(0);
  });

  it("requires every remaining unit to be accounted for exactly once", () => {
    expect(fieldSalesReturnCountMatches(4, 3, 1)).toBe(true);
    expect(fieldSalesReturnCountMatches(4, 2, 1)).toBe(false);
    expect(fieldSalesReturnCountMatches(4, 4, 1)).toBe(false);
    expect(fieldSalesReturnCountMatches(-1, 0, 0)).toBe(false);
    expect(fieldSalesReturnCountMatches(1, 0.5, 0.5)).toBe(false);
  });

  it("matches an IMEI only when the exact code belongs to the selected variant", () => {
    const imei = {
      imei1: "123456789012345",
      imei2: "543210987654321",
      variant_id: "phone-a",
    };
    expect(matchesFieldSalesImei(imei, " 123456789012345 ", "phone-a")).toBe(true);
    expect(matchesFieldSalesImei(imei, "543210987654321", "phone-a")).toBe(true);
    expect(matchesFieldSalesImei(imei, "123456789012345", "phone-b")).toBe(false);
    expect(matchesFieldSalesImei(imei, "", "phone-a")).toBe(false);
  });
});
