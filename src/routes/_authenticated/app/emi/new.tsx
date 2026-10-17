import { matchedCompany } from "@/lib/branding";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { useBranches, useMoneyAccounts } from "@/lib/finance";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, selectCls, today } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hasAccess } from "@/lib/access-control";

const schema = z.object({
  branch: z.string().optional(),
  customer: z.string().optional(),
  quote: z.string().optional(),
  order: z.string().optional(),
  imei: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/app/emi/new")({
  validateSearch: schema,
  head: ({ matches }) => ({
    meta: [{ title: `New Installment Sale — ${matchedCompany(matches)}` }],
  }),
  component: EmiNew,
});

type EmiLine = {
  key: number;
  variant_id: string;
  qty: number;
  price: string;
  imeis: string[];
};

type EmiCustomer = {
  customer_id: string;
  name: string;
  mobile?: string | null;
  current_due?: number | null;
};

type EmiBranch = {
  id: string;
  kind?: string | null;
  name?: string | null;
};

type EmiAccount = {
  id: string | null;
  kind?: string | null;
  name?: string | null;
  status?: string | null;
};

type EmiPlan = {
  id: string;
  name: string;
  downpayment_percent: number;
  interest_rate: number;
  processing_fee: number;
  tenure_months: number;
};

type EmiStockRow = {
  variant_id: string;
  qty: number;
  product_variants?: {
    ram?: string | null;
    storage?: string | null;
    color?: string | null;
    retail_price?: number | string | null;
    products?: {
      model?: string | null;
      brands?: { name?: string | null } | null;
    } | null;
  } | null;
};

function EmiNew() {
  const { business, access } = useBusiness();
  const nav = useNavigate();
  const branches = useBranches(business.id);
  const accounts = useMoneyAccounts(business.id);
  const allowed = hasAccess(access, "emi", "create");
  const [branch, setBranch] = useState(Route.useSearch().branch ?? "");
  const [customer, setCustomer] = useState(Route.useSearch().customer ?? "");
  const [date, setDate] = useState(today());
  const [lines, setLines] = useState<EmiLine[]>([]);
  const [discount, setDiscount] = useState("");
  const [plan, setPlan] = useState("");
  const [downpayment, setDownpayment] = useState("");
  const [start, setStart] = useState(today());
  const [dueDay, setDueDay] = useState("5");

  const br =
    branch ||
    branches.data?.find((b: EmiBranch) => b.kind === "branch")?.id ||
    branches.data?.[0]?.id ||
    "";

  const custs = useQuery({
    queryKey: ["customer_balances", business.id],
    queryFn: async () => {
      const bq = await supabase
        .from("customer_balances")
        .select("*")
        .eq("business_id", business.id)
        .order("name");
      if (bq.error) throw bq.error;
      const cq = await supabase
        .from("customers")
        .select("id,status")
        .eq("business_id", business.id);
      if (cq.error) throw cq.error;
      const cm = new Map(
        (cq.data || []).map((x: { id: string; status?: string | null }) => [x.id, x]),
      );
      return (bq.data || []).flatMap((x) => {
        if (!x.customer_id || cm.get(x.customer_id)?.status !== "active") return [];
        return [
          {
            customer_id: x.customer_id,
            name: x.name ?? "",
            mobile: x.mobile,
            current_due: x.current_due,
          },
        ];
      });
    },
  });

  const plans = useQuery({
    queryKey: ["emi-plans", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("emi_plans")
        .select("*")
        .eq("business_id", business.id)
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data as EmiPlan[];
    },
  });

  const stock = useQuery({
    enabled: !!br,
    queryKey: ["sale-stock-emi", br],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock")
        .select(
          "qty, variant_id, product_variants(id,sku,ram,storage,color,retail_price,min_price,products(model,brands(name),categories(is_serialized)))",
        )
        .eq("business_id", business.id)
        .eq("branch_id", br)
        .gt("qty", 0);
      if (error) throw error;
      return data as EmiStockRow[];
    },
  });
  const vmap = useMemo(
    () => new Map((stock.data || []).map((s: EmiStockRow) => [s.variant_id, s])),
    [stock.data],
  );

  const sub = lines.reduce((s: number, l: EmiLine) => s + l.qty * Number(l.price || 0), 0);
  const totalGoods = Math.round((sub - Number(discount || 0)) * 100) / 100;
  const sel = plans.data?.find((p: EmiPlan) => p.id === plan);
  const dpPct = Number(sel?.downpayment_percent || 0);
  const dp = Number(downpayment || 0);
  const dpMin = sel ? Math.round(((totalGoods * dpPct) / 100) * 100) / 100 : 0;
  const financed = totalGoods - dp;
  const rate = Number(sel?.interest_rate || 0);
  const fee = Number(sel?.processing_fee || 0);
  const tenure = Number(sel?.tenure_months || 0);
  const interest = sel ? Math.round(((financed * rate) / 100) * (tenure / 12) * 100) / 100 : 0;
  const schedTotal = financed + interest + fee;
  const monthly = tenure > 0 ? Math.round((schedTotal / tenure) * 100) / 100 : 0;
  const last = tenure > 0 ? Math.round((schedTotal - monthly * (tenure - 1)) * 100) / 100 : 0;

  const [payAcc, setPayAcc] = useState("");
  const defAcc = accounts.data?.find((a: EmiAccount) => a.kind === "cash")?.id || payAcc;
  useEffect(() => {
    if (accounts.data && accounts.data.length > 0 && !payAcc) {
      const cash = accounts.data.find((a: EmiAccount) => a.kind === "cash");
      setPayAcc(cash?.id || accounts.data[0]?.id || "");
    }
  }, [accounts.data, payAcc]);

  const create = useMutation({
    mutationFn: async () => {
      if (!allowed) throw new Error("No permission.");
      if (!br) throw new Error("Select a brand shop branch.");
      if (!customer) throw new Error("Select a customer.");
      if (!plan) throw new Error("Select an EMI plan.");
      if (lines.length === 0) throw new Error("Add at least one product.");
      if (sel && dp < dpMin - 0.01) throw new Error("Downpayment less than minimum.");
      if (financed <= 0) throw new Error("Nothing left to finance.");
      if (tenure <= 0) throw new Error("Invalid tenure.");
      const downpay = dp;
      const def = defAcc || "";
      const items = lines.map((l: EmiLine) => ({
        variant_id: l.variant_id,
        qty: l.qty,
        price: Number(l.price),
        imei_ids: l.imeis || [],
      }));
      const payments =
        downpay > 0
          ? [{ account_id: def, method: "cash" as const, amount: downpay, txn_ref: "" }]
          : [];
      const saleData = {
        branch_id: br,
        customer_id: customer,
        sale_date: date,
        discount: Number(discount || 0),
        tax: 0,
        items,
        payments,
      };
      const emiData = {
        plan_id: plan,
        downpayment: downpay,
        start_date: start,
        due_day: Number(dueDay || 5),
        tenure,
        interest_rate: rate,
        processing_fee: fee,
      };
      const { data, error } = await supabase.rpc("create_emi_sale_full", {
        _biz: business.id,
        _data: saleData,
        _emi: emiData,
      });
      if (error) throw error;
      return data as { sale_id: string; emi_id: string };
    },
    onSuccess: (d) => {
      toast.success("Installment sale created");
      nav({ to: "/app/emi/$id", params: { id: d.emi_id } });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  useEffect(() => {
    if (sel && totalGoods > 0 && dp === 0) {
      const m = Math.round(((totalGoods * dpPct) / 100) * 100) / 100;
      setDownpayment(String(m));
    }
  }, [sel, totalGoods, dpPct, dp]);

  if (!allowed) {
    return (
      <div>
        <PageHeader title="New Installment Sale (EMI)" />
        <p className="text-sm text-destructive">No permission.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="New Installment Sale (EMI)"
        sub="Brand shop only — mobile phone sale on installments."
      />
      <section className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-4">
        <F label="Customer">
          <select
            className={selectCls}
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
          >
            <option value="">Select customer...</option>
            {custs.data?.map((c: EmiCustomer) => (
              <option key={c.customer_id} value={c.customer_id}>
                {c.name}
                {c.mobile ? ` · ${c.mobile}` : ""} — due {bdt(c.current_due)}
              </option>
            ))}
          </select>
        </F>
        <F label="Branch (Brand shop)">
          <select className={selectCls} value={br} onChange={(e) => setBranch(e.target.value)}>
            {branches.data
              ?.filter((b: EmiBranch) => b.kind === "branch")
              .map((b: EmiBranch) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </F>
        <F label="Sale date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </F>
        <F label="Receive into (downpayment)">
          <select className={selectCls} value={payAcc} onChange={(e) => setPayAcc(e.target.value)}>
            <option value="">Default cash</option>
            {accounts.data
              ?.filter((a: EmiAccount) => a.status === "active" && a.id)
              .map((a: EmiAccount) => (
                <option key={a.id} value={a.id ?? ""}>
                  {a.name}
                </option>
              ))}
          </select>
        </F>
      </section>

      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-2 font-semibold">Products</div>
        <p className="text-sm text-muted-foreground mb-3">
          Search and add from stock (IMEI tracked devices supported via existing sales flow; this UI
          is simplified).
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(stock.data || []).slice(0, 30).map((s: EmiStockRow) => {
            const v = s.product_variants;
            const inCart = lines.find((l: EmiLine) => l.variant_id === s.variant_id);
            return (
              <div
                key={s.variant_id}
                className="flex items-center justify-between rounded-md border p-2 text-sm"
              >
                <div>
                  <div>
                    {v?.products?.brands?.name} {v?.products?.model}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {[v?.ram, v?.storage, v?.color].filter(Boolean).join("/")} · {s.qty} in stock ·{" "}
                    {bdt(v?.retail_price)}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={inCart ? "secondary" : "outline"}
                  onClick={() => {
                    if (inCart) return;
                    setLines([
                      ...lines,
                      {
                        key: lines.length + 1,
                        variant_id: s.variant_id,
                        qty: 1,
                        price: String(v?.retail_price || 0),
                        imeis: [],
                      },
                    ]);
                  }}
                >
                  {inCart ? "Added" : "Add"}
                </Button>
              </div>
            );
          })}
        </div>
        {lines.length > 0 && (
          <div className="mt-4 divide-y">
            {lines.map((l: EmiLine) => {
              const s = vmap.get(l.variant_id);
              const v = s?.product_variants;
              return (
                <div key={l.key} className="flex items-center justify-between py-2 text-sm">
                  <div className="flex-1">
                    <div>
                      {v?.products?.brands?.name} {v?.products?.model}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[v?.ram, v?.storage, v?.color].filter(Boolean).join("/")}
                    </div>
                  </div>
                  <div className="w-20">
                    <Input
                      type="number"
                      value={l.qty}
                      onChange={(e) =>
                        setLines(
                          lines.map((x: EmiLine) =>
                            x.key === l.key ? { ...x, qty: Number(e.target.value) || 1 } : x,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="w-32 ml-2">
                    <Input
                      type="number"
                      step="0.01"
                      value={l.price}
                      onChange={(e) =>
                        setLines(
                          lines.map((x: EmiLine) =>
                            x.key === l.key ? { ...x, price: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="w-28 text-right num">{bdt(l.qty * Number(l.price || 0))}</div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setLines(lines.filter((x: EmiLine) => x.key !== l.key))}
                  >
                    ×
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-4">
        <F label="EMI Plan">
          <select className={selectCls} value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="">Select plan...</option>
            {plans.data?.map((p: EmiPlan) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.tenure_months}m, {p.interest_rate}% interest, DP{" "}
                {p.downpayment_percent}%
              </option>
            ))}
          </select>
        </F>
        <F label="Downpayment">
          <Input
            type="number"
            step="0.01"
            value={downpayment}
            onChange={(e) => setDownpayment(e.target.value)}
          />
        </F>
        <F label="Start date">
          <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </F>
        <F label="Due day (1-31)">
          <Input
            type="number"
            min="1"
            max="31"
            value={dueDay}
            onChange={(e) => setDueDay(e.target.value)}
          />
        </F>
      </section>

      {sel && (
        <section className="rounded-lg border bg-card p-4 shadow-sm text-sm num">
          <div className="font-semibold mb-2">EMI Schedule Preview</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              Goods total: <b>{bdt(totalGoods)}</b>
            </div>
            <div>
              Min DP ({dpPct}%): <b>{bdt(dpMin)}</b>
            </div>
            <div>
              Financed: <b>{bdt(financed)}</b>
            </div>
            <div>
              Interest ({rate}%): <b>{bdt(interest)}</b>
            </div>
            <div>
              Processing fee: <b>{bdt(fee)}</b>
            </div>
            <div>
              Monthly (first {tenure - 1}): <b>{bdt(monthly)}</b>
            </div>
            <div>
              Last installment: <b>{bdt(last)}</b>
            </div>
            <div>
              Total payable: <b>{bdt(schedTotal + dp)}</b>
            </div>
          </div>
        </section>
      )}

      <div className="flex gap-2">
        <Button
          onClick={() => create.mutate()}
          disabled={create.isPending || !plan || lines.length === 0 || !customer || !br}
        >
          Create Installment Sale
        </Button>
        <Button variant="outline" onClick={() => nav({ to: "/app/emi" })}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
