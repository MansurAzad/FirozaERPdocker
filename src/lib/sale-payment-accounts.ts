export type SalePaymentAccount = {
  id: string | null;
  branch_id: string | null;
  kind: string | null;
  name: string | null;
  status: string | null;
};

export function salePaymentAccounts(
  accounts: readonly SalePaymentAccount[] | undefined,
  branchId: string,
) {
  return (accounts ?? []).filter(
    (account) => account.status === "active" && account.branch_id === branchId,
  );
}

export function defaultSaleCashAccount(accounts: readonly SalePaymentAccount[], branchId: string) {
  return accounts.find((account) => account.kind === "cash" && account.branch_id === branchId);
}
