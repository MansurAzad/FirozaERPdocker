import { describe, expect, it } from "vitest";
import { splitSummary, totals, type BranchSummary } from "./daily-summary";

const row = (kind: BranchSummary["kind"], sales: number, ret = 0, exp = 0): BranchSummary => ({
  id: kind + sales,
  name: kind,
  kind,
  sales_count: 1,
  sales_total: sales,
  gross_profit: 100,
  sales_due: 0,
  returns_total: ret,
  purchases_total: 0,
  expenses_total: exp,
  stock_units: 0,
  stock_value: 0,
});

describe("daily summary", () => {
  it("keeps dealer house and brand shops separate", () => {
    const s = splitSummary({
      date: "2026-10-12",
      due_collected: 0,
      supplier_paid: 0,
      branches: [row("head", 1000), row("warehouse", 50), row("branch", 700)],
    });
    expect(s.house.map((b) => b.kind)).toEqual(["head", "warehouse"]);
    expect(s.shops.map((b) => b.kind)).toEqual(["branch"]);
  });
  it("deducts returns from sales and expenses from profit", () => {
    const t = totals([row("branch", 1000, 200, 30)]);
    expect(t.sales).toBe(800);
    expect(t.netResult).toBe(70);
  });
});

import { dhakaDate } from "./daily-report.server";
describe("midnight schedule date", () => {
  it("reports the Dhaka day that just ended when run at 00:00 Dhaka (18:00 UTC)", () => {
    expect(dhakaDate(-1, Date.parse("2026-10-12T18:00:00Z"))).toBe("2026-10-12");
  });
});
