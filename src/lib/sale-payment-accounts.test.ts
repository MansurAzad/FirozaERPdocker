import { describe, expect, it } from "vitest";
import { defaultSaleCashAccount, salePaymentAccounts } from "./sale-payment-accounts";

const accounts = [
  { id: "shop-cash", branch_id: "shop", kind: "cash", name: "Shop Cash", status: "active" },
  { id: "main-cash", branch_id: null, kind: "cash", name: "Main Cash", status: "active" },
  { id: "other-cash", branch_id: "other", kind: "cash", name: "Other Shop", status: "active" },
  { id: "shop-bank", branch_id: "shop", kind: "bank", name: "Shop Bank", status: "active" },
  { id: "inactive", branch_id: "shop", kind: "cash", name: "Inactive", status: "inactive" },
] as const;

describe("sale payment account scope", () => {
  it("only offers active accounts assigned to the selected shop", () => {
    expect(salePaymentAccounts(accounts, "shop").map((account) => account.id)).toEqual([
      "shop-cash",
      "shop-bank",
    ]);
  });

  it("prefers the selected shop's cash account over an unassigned cash account", () => {
    expect(defaultSaleCashAccount(salePaymentAccounts(accounts, "shop"), "shop")?.id).toBe(
      "shop-cash",
    );
  });

  it("does not use another shop's or unassigned cash account as a fallback", () => {
    const available = salePaymentAccounts(
      accounts.filter((account) => account.id !== "shop-cash"),
      "shop",
    );
    expect(defaultSaleCashAccount(available, "shop")).toBeUndefined();
  });
});
