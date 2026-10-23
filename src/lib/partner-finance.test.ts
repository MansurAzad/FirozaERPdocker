import { describe, expect, it } from "vitest";
import { calculatePartnerFinanceDownpayment } from "@/lib/partner-finance";

const base = {
  totalPrice: 100_000,
  downpaymentMode: "percentage" as const,
  downpaymentValue: 30,
  discountMode: "percentage" as const,
  discountValue: 10,
  maximumDiscountRate: 10,
  approvalRequired: true,
};

describe("partner-finance down payment discount calculation", () => {
  it("calculates percentage down payment and discount without deducting discount twice", () => {
    expect(calculatePartnerFinanceDownpayment(base)).toMatchObject({
      downpayment: 30_000,
      discountAmount: 3_000,
      discountEffectiveRate: 10,
      netDownpayment: 27_000,
      financedAmount: 70_000,
      requiresApproval: false,
      errors: [],
    });
  });

  it("calculates fixed amounts and requests approval above the configured rate", () => {
    expect(
      calculatePartnerFinanceDownpayment({
        ...base,
        downpaymentMode: "fixed",
        downpaymentValue: 30_000,
        discountMode: "fixed",
        discountValue: 3_300,
      }),
    ).toMatchObject({
      downpayment: 30_000,
      discountAmount: 3_300,
      netDownpayment: 26_700,
      financedAmount: 70_000,
      requiresApproval: true,
      errors: [],
    });
  });

  it("rejects invalid percentages, discounts above the down payment, and a full-price down payment", () => {
    const result = calculatePartnerFinanceDownpayment({
      ...base,
      downpaymentValue: 100,
      discountValue: 101,
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Down payment must be less than the total price.",
        "Discount percentage must be between 0 and 100.",
        "Discount cannot exceed the down payment.",
      ]),
    );
  });

  it("does not require approval when the configured policy does not require it", () => {
    expect(
      calculatePartnerFinanceDownpayment({
        ...base,
        discountValue: 50,
        approvalRequired: false,
      }).requiresApproval,
    ).toBe(false);
  });

  it("requires approval for every nonzero discount before an administrator sets an allowance", () => {
    expect(
      calculatePartnerFinanceDownpayment({
        ...base,
        maximumDiscountRate: 0,
      }).requiresApproval,
    ).toBe(true);
  });

  it("allows a fully discounted down payment without recording a cash collection", () => {
    expect(
      calculatePartnerFinanceDownpayment({
        ...base,
        discountValue: 100,
      }),
    ).toMatchObject({
      downpayment: 30_000,
      discountAmount: 30_000,
      netDownpayment: 0,
      financedAmount: 70_000,
      requiresApproval: true,
      errors: [],
    });
  });

  it("rounds the approval comparison to the database's four-decimal rate precision", () => {
    expect(
      calculatePartnerFinanceDownpayment({
        ...base,
        totalPrice: 1_000_000,
        downpaymentMode: "fixed",
        downpaymentValue: 100_000,
        discountMode: "fixed",
        discountValue: 10_000.01,
      }),
    ).toMatchObject({
      discountEffectiveRate: 10,
      requiresApproval: false,
    });
  });
});
