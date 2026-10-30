import { z } from "zod";
export const shopReportPageSchema = z.object({
  metrics: z.record(z.number()),
  rows: z.array(z.unknown()),
  total: z.number().int().nonnegative(),
});

export const shopReportSchema = z.object({
  metrics: z.record(z.number()),
  sales: z.array(
    z.object({
      id: z.string(),
      invoice_no: z.string(),
      sale_date: z.string(),
      total: z.number(),
      paid: z.number(),
      due: z.number(),
    }),
  ),
  purchases: z.array(
    z.object({
      id: z.string(),
      invoice_no: z.string(),
      purchase_date: z.string(),
      total: z.number(),
      paid: z.number(),
      due: z.number(),
    }),
  ),
  stock: z.array(
    z.object({
      variant_id: z.string(),
      sku: z.string(),
      product: z.string(),
      qty: z.number(),
      avg_cost: z.number(),
      reorder_level: z.number(),
      value: z.number(),
    }),
  ),
  expenses: z.array(
    z.object({
      id: z.string(),
      date: z.string(),
      category: z.string(),
      description: z.string().nullable(),
      amount: z.number(),
    }),
  ),
  returns: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      number: z.string(),
      date: z.string(),
      total: z.number(),
      refund: z.number(),
    }),
  ),
  payments: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      date: z.string(),
      method: z.string(),
      amount: z.number(),
      invoice: z.string(),
    }),
  ),
});

export const shopDashboardSchema = z.object({
  date: z.string(),
  branch_id: z.string(),
  sales: z
    .object({
      count: z.coerce.number(),
      total: z.coerce.number(),
      paid: z.coerce.number(),
      due: z.coerce.number(),
    })
    .nullable(),
  returns: z
    .object({
      count: z.coerce.number(),
      total: z.coerce.number(),
      refund: z.coerce.number(),
    })
    .nullable(),
  cash_balance: z.coerce.number().nullable(),
  bank_balance: z.coerce.number().nullable(),
  stock: z
    .object({
      low_stock_count: z.coerce.number(),
      low_stock: z.array(
        z.object({
          variant_id: z.string(),
          sku: z.string(),
          product: z.string(),
          qty: z.coerce.number(),
          reorder_level: z.coerce.number(),
        }),
      ),
    })
    .nullable(),
});
export type ShopDashboard = z.infer<typeof shopDashboardSchema>;

export type ShopReport = z.infer<typeof shopReportSchema>;
