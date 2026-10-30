import { describe, expect, it } from "vitest";
import { closingCollectionTotals, closingOutflowTotals } from "./closing";

describe("daily closing transaction summaries", () => {
  it("separates cash, card, bank/cheque, and mobile tenders", () => {
    const totals = closingCollectionTotals([
      { amount: 100, direction: "in", kind: "sale_receipt", method: "cash", reversed_at: null },
      { amount: 200, direction: "in", kind: "sale_receipt", method: "card", reversed_at: null },
      { amount: 300, direction: "in", kind: "sale_receipt", method: "bank", reversed_at: null },
      { amount: 40, direction: "in", kind: "sale_receipt", method: "cheque", reversed_at: null },
      { amount: 50, direction: "in", kind: "sale_receipt", method: "bkash", reversed_at: null },
      { amount: 60, direction: "in", kind: "sale_receipt", method: "nagad", reversed_at: null },
      { amount: 70, direction: "in", kind: "sale_receipt", method: "rocket", reversed_at: null },
      { amount: 999, direction: "out", kind: "expense", method: "cash", reversed_at: null },
      { amount: 500, direction: "in", kind: "sale_receipt", method: "cash", reversed_at: "now" },
    ]);

    expect(totals).toEqual({ cash: 100, card: 200, bank: 340, mobile: 180 });
  });

  it("uses the account type for legacy transactions without a payment method", () => {
    const totals = closingCollectionTotals([
      {
        amount: 100,
        direction: "in",
        kind: "sale_receipt",
        method: null,
        account_kind: "cash",
        reversed_at: null,
      },
      {
        amount: 200,
        direction: "in",
        kind: "sale_receipt",
        method: null,
        account_kind: "bank",
        reversed_at: null,
      },
      {
        amount: 300,
        direction: "in",
        kind: "sale_receipt",
        method: null,
        account_kind: "mfs",
        reversed_at: null,
      },
    ]);

    expect(totals).toEqual({ cash: 100, card: 0, bank: 200, mobile: 300 });
  });

  it("includes sales and partner finance refunds without counting reversals or cancelled expenses", () => {
    const totals = closingOutflowTotals([
      { amount: 100, direction: "out", kind: "sales_refund", method: "cash", reversed_at: null },
      {
        amount: 200,
        direction: "out",
        kind: "partner_finance_refund",
        method: "cash",
        reversed_at: null,
      },
      {
        amount: 50,
        direction: "out",
        kind: "partner_finance_settlement_reversal",
        method: null,
        reversed_at: null,
      },
      { amount: 30, direction: "out", kind: "expense", method: "cash", reversed_at: null },
      { amount: 500, direction: "out", kind: "reversal", method: null, reversed_at: null },
      { amount: 40, direction: "out", kind: "expense", method: "cash", reversed_at: "now" },
    ]);

    expect(totals).toEqual({ expenses: 30, refunds: 350 });
  });
});
