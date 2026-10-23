export type FinanceAmountMode = "fixed" | "percentage";

export type PartnerFinanceCalculation = {
  downpayment: number;
  discountAmount: number;
  discountEffectiveRate: number;
  netDownpayment: number;
  financedAmount: number;
  requiresApproval: boolean;
  errors: string[];
};

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function rate(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

export function calculatePartnerFinanceDownpayment({
  totalPrice,
  downpaymentMode,
  downpaymentValue,
  discountMode,
  discountValue,
  maximumDiscountRate,
  approvalRequired,
}: {
  totalPrice: number;
  downpaymentMode: FinanceAmountMode;
  downpaymentValue: number;
  discountMode: FinanceAmountMode;
  discountValue: number;
  maximumDiscountRate: number;
  approvalRequired: boolean;
}): PartnerFinanceCalculation {
  const errors: string[] = [];
  const total = money(totalPrice);
  const downpayment = money(
    downpaymentMode === "percentage" ? (total * downpaymentValue) / 100 : downpaymentValue,
  );
  const discountAmount = money(
    discountMode === "percentage" ? (downpayment * discountValue) / 100 : discountValue,
  );
  const discountEffectiveRate = downpayment > 0 ? rate((discountAmount / downpayment) * 100) : 0;
  const requiresApproval =
    discountAmount > 0 && approvalRequired && discountEffectiveRate > maximumDiscountRate;

  if (!Number.isFinite(totalPrice) || total <= 0)
    errors.push("Total price must be greater than zero.");
  if (!Number.isFinite(downpaymentValue) || downpaymentValue < 0) {
    errors.push("Down payment cannot be negative.");
  }
  if (downpaymentMode === "percentage" && downpaymentValue > 100) {
    errors.push("Down payment percentage must be between 0 and 100.");
  }
  if (downpayment >= total) errors.push("Down payment must be less than the total price.");
  if (!Number.isFinite(discountValue) || discountValue < 0) {
    errors.push("Discount cannot be negative.");
  }
  if (discountMode === "percentage" && discountValue > 100) {
    errors.push("Discount percentage must be between 0 and 100.");
  }
  if (discountAmount > downpayment) errors.push("Discount cannot exceed the down payment.");
  if (money(downpayment - discountAmount) < 0) {
    errors.push("Net down payment cannot be negative.");
  }
  if (
    !Number.isFinite(maximumDiscountRate) ||
    maximumDiscountRate < 0 ||
    maximumDiscountRate > 100
  ) {
    errors.push("The configured discount approval limit must be between 0 and 100%.");
  }

  return {
    downpayment,
    discountAmount,
    discountEffectiveRate,
    netDownpayment: money(downpayment - discountAmount),
    financedAmount: money(total - downpayment),
    requiresApproval,
    errors,
  };
}
