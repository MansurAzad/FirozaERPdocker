import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SaleLine = {
  saleId: string;
  date: string;
  branch: string;
  salesman: string | null;
  customer: string;
  brand: string;
  product: string;
  category: string;
  qty: number;
  devices: number;
  revenue: number;
  cost: number;
};

/** Item-level sales in a date range; revenue is net of each invoice's discount share (tax excluded). */
export function useSaleLines(bizId: string, from: string, to: string) {
  return useQuery({
    queryKey: ["sale-lines", bizId, from, to],
    queryFn: async (): Promise<SaleLine[]> => {
      const { data, error } = await supabase
        .from("sale_items")
        .select(
          "qty, line_total, unit_cost, imei_id, sales!inner(id, sale_date, status, subtotal, discount, created_by, branches(name), customers(name)), product_variants(ram,storage,products(model, brands(name), categories(name)))",
        )
        .eq("business_id", bizId)
        .eq("sales.status", "posted")
        .gte("sales.sale_date", from)
        .lte("sales.sale_date", to)
        .limit(10000);
      if (error) throw error;
      return data.map((r) => {
        const s = r.sales;
        const factor =
          Number(s.subtotal) > 0
            ? (Number(s.subtotal) - Number(s.discount)) / Number(s.subtotal)
            : 1;
        const p = r.product_variants?.products;
        return {
          saleId: s.id,
          date: s.sale_date,
          branch: s.branches?.name ?? "—",
          salesman: s.created_by,
          customer: s.customers?.name ?? "Walk-in",
          brand: p?.brands?.name ?? "—",
          product:
            `${p?.brands?.name ?? ""} ${p?.model ?? ""} ${[r.product_variants?.ram, r.product_variants?.storage].filter(Boolean).join("/")}`.trim(),
          category: p?.categories?.name ?? "—",
          qty: r.qty,
          devices: r.imei_id ? r.qty : 0,
          revenue: Math.round(Number(r.line_total) * factor * 100) / 100,
          cost: Math.round(r.qty * Number(r.unit_cost) * 100) / 100,
        };
      });
    },
  });
}

export function useMembers(bizId: string) {
  return useQuery({
    queryKey: ["members-lite", bizId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_members")
        .select("user_id, display_name, role")
        .eq("business_id", bizId);
      if (error) throw error;
      return data;
    },
  });
}

export function groupBy(lines: SaleLine[], key: (l: SaleLine) => string) {
  const m = new Map<
    string,
    { key: string; qty: number; revenue: number; cost: number; invoices: Set<string> }
  >();
  for (const l of lines) {
    const k = key(l);
    const g = m.get(k) ?? { key: k, qty: 0, revenue: 0, cost: 0, invoices: new Set<string>() };
    g.qty += l.qty;
    g.revenue += l.revenue;
    g.cost += l.cost;
    g.invoices.add(l.saleId);
    m.set(k, g);
  }
  return [...m.values()]
    .map((g) => ({ ...g, profit: g.revenue - g.cost, count: g.invoices.size }))
    .sort((a, b) => b.revenue - a.revenue);
}
