import { z } from "zod";

const num = z.coerce.number();
export const branchSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["head", "branch", "warehouse"]),
  sales_count: num,
  sales_total: num,
  gross_profit: num,
  sales_due: num,
  returns_total: num,
  purchases_total: num,
  expenses_total: num,
  stock_units: num,
  stock_value: num,
});
export const dailySummarySchema = z.object({
  date: z.string(),
  branches: z.array(branchSummarySchema),
  due_collected: num,
  supplier_paid: num,
});
export type BranchSummary = z.infer<typeof branchSummarySchema>;
export type DailySummary = z.infer<typeof dailySummarySchema>;

/** Dealer house = head office + warehouses; brand shops = branches of kind "branch". */
export function splitSummary(s: DailySummary) {
  return {
    house: s.branches.filter((b) => b.kind !== "branch"),
    shops: s.branches.filter((b) => b.kind === "branch"),
  };
}

export function totals(rows: BranchSummary[]) {
  const t = (k: keyof BranchSummary) => rows.reduce((a, r) => a + Number(r[k]), 0);
  const sales = t("sales_total") - t("returns_total");
  const profit = t("gross_profit") - t("expenses_total");
  return {
    salesCount: t("sales_count"),
    sales,
    grossProfit: t("gross_profit"),
    expenses: t("expenses_total"),
    netResult: profit,
    due: t("sales_due"),
    purchases: t("purchases_total"),
    stockUnits: t("stock_units"),
    stockValue: t("stock_value"),
  };
}

const tk = (n: number) =>
  "৳" + n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function summaryText(company: string, title: string, date: string, rows: BranchSummary[]) {
  const t = totals(rows);
  const lines = [
    `*${company}*`,
    `${title} — ${date}`,
    "",
    `বিক্রি (Sales): ${tk(t.sales)} (${t.salesCount} invoice)`,
    `মোট লাভ (Gross profit): ${tk(t.grossProfit)}`,
    `খরচ (Expenses): ${tk(t.expenses)}`,
    `নিট ফলাফল (Net result): ${tk(t.netResult)}`,
    `নতুন বাকি (New due): ${tk(t.due)}`,
    `ক্রয় (Purchases): ${tk(t.purchases)}`,
    `স্টক: ${t.stockUnits} pcs · ${tk(t.stockValue)}`,
  ];
  if (rows.length > 1) {
    lines.push("");
    for (const r of rows)
      lines.push(
        `• ${r.name}: বিক্রি ${tk(r.sales_total - r.returns_total)}, খরচ ${tk(r.expenses_total)}`,
      );
  }
  return lines.join("\n");
}
