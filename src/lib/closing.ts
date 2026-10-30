export type ClosingTransaction = {
  amount: number;
  direction: string;
  kind: string;
  method: string | null;
  account_kind?: string | null;
  reversed_at: string | null;
};

export function closingCollectionTotals(transactions: ClosingTransaction[]) {
  return transactions.reduce(
    (totals, transaction) => {
      if (transaction.reversed_at || transaction.direction !== "in") return totals;
      const amount = Number(transaction.amount);
      if (!Number.isFinite(amount)) return totals;

      const method =
        transaction.method ??
        (transaction.account_kind === "cash"
          ? "cash"
          : transaction.account_kind === "bank"
            ? "bank"
            : transaction.account_kind === "mfs"
              ? "bkash"
              : null);
      switch (method) {
        case "cash":
          totals.cash += amount;
          break;
        case "card":
          totals.card += amount;
          break;
        case "bank":
        case "cheque":
          totals.bank += amount;
          break;
        case "bkash":
        case "nagad":
        case "rocket":
          totals.mobile += amount;
          break;
      }

      return totals;
    },
    { cash: 0, card: 0, bank: 0, mobile: 0 },
  );
}

export function closingOutflowTotals(transactions: ClosingTransaction[]) {
  return transactions.reduce(
    (totals, transaction) => {
      if (transaction.reversed_at || transaction.direction !== "out") return totals;
      const amount = Number(transaction.amount);
      if (!Number.isFinite(amount)) return totals;

      if (transaction.kind === "expense") totals.expenses += amount;
      if (
        transaction.kind === "sales_refund" ||
        transaction.kind === "partner_finance_refund" ||
        transaction.kind === "partner_finance_settlement_reversal"
      ) {
        totals.refunds += amount;
      }
      return totals;
    },
    { expenses: 0, refunds: 0 },
  );
}
