import { describe, expect, it } from "vitest";
import { getSaleExceptionTypes } from "./sale-exceptions";

describe("getSaleExceptionTypes", () => {
  it("finds all sale exceptions", () => {
    expect(
      getSaleExceptionTypes({
        lines: [{ price: 90, minPrice: 100 }],
        subtotal: 100,
        discount: 11,
        due: 50,
        customerDue: 40,
        creditLimit: 80,
      }),
    ).toEqual(["minimum_price", "discount_limit", "credit_limit"]);
  });

  it("does not flag exact thresholds or fully paid credit sales", () => {
    expect(
      getSaleExceptionTypes({
        lines: [{ price: 100, minPrice: 100 }],
        subtotal: 100,
        discount: 10,
        due: 0,
        customerDue: 80,
        creditLimit: 80,
      }),
    ).toEqual([]);
  });
});
