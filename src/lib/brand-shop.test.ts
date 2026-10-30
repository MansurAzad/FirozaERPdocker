import { describe, expect, it } from "vitest";
import { shopDashboardSchema } from "./brand-shop";

describe("shopDashboardSchema", () => {
  it("parses a permission-filtered shop dashboard snapshot", () => {
    const dashboard = shopDashboardSchema.parse({
      date: "2026-10-31",
      branch_id: "shop-1",
      sales: { count: 2, total: "1250.00", paid: "1000.00", due: "250.00" },
      returns: { count: 1, total: "100", refund: "80" },
      cash_balance: "920",
      bank_balance: null,
      stock: {
        low_stock_count: 1,
        low_stock: [
          {
            variant_id: "variant-1",
            sku: "SKU-1",
            product: "Device",
            qty: 1,
            reorder_level: 2,
          },
        ],
      },
    });

    expect(dashboard.sales?.total).toBe(1250);
    expect(dashboard.bank_balance).toBeNull();
    expect(dashboard.stock?.low_stock[0]?.qty).toBe(1);
  });

  it("rejects malformed or incomplete snapshots rather than showing success-shaped data", () => {
    expect(() =>
      shopDashboardSchema.parse({
        date: "2026-10-31",
        branch_id: "shop-1",
        sales: { count: "not-a-number" },
        returns: null,
        cash_balance: null,
        bank_balance: null,
        stock: null,
      }),
    ).toThrow();
  });
});
