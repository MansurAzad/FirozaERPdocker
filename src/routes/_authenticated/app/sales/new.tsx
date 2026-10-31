import { matchedCompany } from "@/lib/branding";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useMemo, useRef, useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, ScanLine, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { bdt, friendlyError } from "@/lib/format";
import { useBranches, useMoneyAccounts } from "@/lib/finance";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, METHODS, methodLabel, selectCls, today, type Method } from "@/components/erp/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScanButton } from "@/components/erp/ScanButton";
import { defaultSaleCashAccount, salePaymentAccounts } from "@/lib/sale-payment-accounts";
import { getSaleExceptionTypes, type SaleExceptionType } from "@/lib/sale-exceptions";
import { imeiCandidatesFromBarcode } from "@/lib/barcode";

import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/app/sales/new")({
  validateSearch: z.object({
    customer: z.string().optional(),
    imei: z.string().optional(),
    branch: z.string().optional(),
    quote: z.string().optional(),
    order: z.string().optional(),
  }),
  head: ({ matches }) => ({
    meta: [
      { title: `New Sale — ${matchedCompany(matches)}` },
      {
        name: "description",
        content:
          "Complete POS sales with IMEI scanning, customer due, split payments and live stock.",
      },
      { property: "og:title", content: `New Sale — ${matchedCompany(matches)}` },
      {
        property: "og:description",
        content: "Complete mobile retail sales with IMEI and payment tracking.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NewSale,
});

type Line = {
  key: number;
  variant_id: string;
  qty: number;
  price: string;
  imeis: { id: string; imei1: string }[];
};
type Pay = { key: number; account_id: string; method: Method; amount: string; txn_ref: string };
let seq = 1;
const n = (v: string) => (v.trim() === "" ? 0 : Number(v));
const LEVEL_LABEL: Record<string, string> = {
  retail: "Retail",
  wholesale: "Wholesale",
  dealer: "Dealer",
  special: "Special",
};

function NewSale() {
  const { business, role } = useBusiness();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const branches = useBranches(business.id);
  const accounts = useMoneyAccounts(business.id);
  const [branch, setBranch] = useState(Route.useSearch().branch ?? "");
  const [customer, setCustomer] = useState(Route.useSearch().customer ?? "");
  const [date, setDate] = useState(today());
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState("");
  const [tax, setTax] = useState("");
  const [pays, setPays] = useState<Pay[]>([
    { key: 0, account_id: "", method: "cash", amount: "", txn_ref: "" },
  ]);
  const [scan, setScan] = useState(Route.useSearch().imei ?? "");
  const [search, setSearch] = useState("");
  const [creditMsg, setCreditMsg] = useState<string | null>(null);
  const [requestDialog, setRequestDialog] = useState(false);
  const [requestReason, setRequestReason] = useState("");
  const isMgr = role === "owner" || role === "manager";
  const isBranchManager = role === "branch_manager";
  const br =
    branch ||
    branches.data?.find((b) => b.kind !== "warehouse")?.id ||
    branches.data?.[0]?.id ||
    "";

  const custs = useQuery({
    queryKey: ["customer_branch_balances", business.id, br],
    enabled: Boolean(br),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_branch_balances")
        .select("*")
        .eq("business_id", business.id)
        .eq("branch_id", br)
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const cust = custs.data?.find((c) => c.customer_id === customer);
  const level = cust?.price_level ?? "retail";
  const paymentAccounts = salePaymentAccounts(accounts.data, br);
  const defaultCashAccount = defaultSaleCashAccount(paymentAccounts, br);

  const stock = useQuery({
    enabled: !!br,
    queryKey: ["sale-stock", br],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock")
        .select(
          "qty, variant_id, product_variants(id,sku,ram,storage,color,retail_price,wholesale_price,dealer_price,min_price,warranty_months,products(model,brands(name),categories(is_serialized)))",
        )
        .eq("business_id", business.id)
        .eq("branch_id", br)
        .gt("qty", 0);
      if (error) throw error;
      return data;
    },
  });
  const vmap = useMemo(
    () => new Map((stock.data ?? []).map((s) => [s.variant_id, s])),
    [stock.data],
  );
  const priceFor = (v: NonNullable<ReturnType<typeof vmap.get>>["product_variants"]) =>
    !v
      ? 0
      : level === "dealer" || level === "special"
        ? Number(v.dealer_price || v.retail_price)
        : level === "wholesale"
          ? Number(v.wholesale_price || v.retail_price)
          : Number(v.retail_price);

  const imeiPool = useQuery({
    enabled: !!br,
    queryKey: ["sale-imeis", br],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_imeis")
        .select("id,imei1,imei2,variant_id")
        .eq("business_id", business.id)
        .eq("branch_id", br)
        .eq("status", "IN_STOCK")
        .limit(5000);
      if (error) throw error;
      return data;
    },
  });

  // "Convert to sale" from a quotation/estimate/proforma pre-fills this form.
  const quoteId = Route.useSearch().quote;
  const quote = useQuery({
    enabled: !!quoteId,
    queryKey: ["quote-prefill", quoteId],
    queryFn: async () => {
      const [h, items] = await Promise.all([
        supabase
          .from("quotations")
          .select("*")
          .eq("id", quoteId!)
          .eq("business_id", business.id)
          .single(),
        supabase
          .from("quotation_items")
          .select("variant_id,qty,price")
          .eq("quotation_id", quoteId!)
          .order("sort_order"),
      ]);
      if (h.error) throw h.error;
      if (items.error) throw items.error;
      return { h: h.data, items: items.data };
    },
  });
  // "Convert to sale" from an order / booking / layaway pre-fills this form.
  const orderId = Route.useSearch().order;
  const order = useQuery({
    enabled: !!orderId,
    queryKey: ["order-prefill", orderId],
    queryFn: async () => {
      const [h, items] = await Promise.all([
        supabase
          .from("orders")
          .select("*")
          .eq("id", orderId!)
          .eq("business_id", business.id)
          .single(),
        supabase
          .from("order_items")
          .select("variant_id,qty,price,discount")
          .eq("order_id", orderId!)
          .order("sort_order"),
      ]);
      if (h.error) throw h.error;
      if (items.error) throw items.error;
      return { h: h.data, items: items.data };
    },
  });

  const prefilled = useRef(false);
  useEffect(() => {
    const od = order.data;
    if (!od || prefilled.current) return;
    prefilled.current = true;
    setBranch(od.h.branch_id);
    if (od.h.customer_id) setCustomer(od.h.customer_id);
    setDate(today());
    setDiscount(Number(od.h.discount) ? String(od.h.discount) : "");
    setTax(Number(od.h.tax) ? String(od.h.tax) : "");
    setLines(
      od.items.map((it) => ({
        key: seq++,
        variant_id: it.variant_id,
        qty: it.qty,
        price: String(it.price),
        imeis: [],
      })),
    );
    if (Number(od.h.deposit) > 0) {
      setPays([
        { key: 0, account_id: "", method: "cash", amount: String(od.h.deposit), txn_ref: "" },
      ]);
    }
  }, [order.data]);

  useEffect(() => {
    const qd = quote.data;
    if (!qd || prefilled.current) return;
    prefilled.current = true;
    setBranch(qd.h.branch_id);
    if (qd.h.customer_id) setCustomer(qd.h.customer_id);
    setDate(qd.h.quote_date);
    setDiscount(Number(qd.h.discount) ? String(qd.h.discount) : "");
    setTax(Number(qd.h.tax) ? String(qd.h.tax) : "");
    setLines(
      qd.items.map((it) => ({
        key: seq++,
        variant_id: it.variant_id,
        qty: it.qty,
        price: String(it.price),
        imeis: [],
      })),
    );
  }, [quote.data]);

  const addVariant = (variant_id: string, imei?: { id: string; imei1: string }) => {
    const s = vmap.get(variant_id);
    if (!s) {
      toast.error("Product not in stock at this branch.");
      return;
    }
    const serial = s.product_variants?.products?.categories?.is_serialized;
    setLines((ls) => {
      const ex = ls.find((l) => l.variant_id === variant_id);
      if (ex) {
        if (imei && ex.imeis.some((i) => i.id === imei.id)) {
          toast.info("IMEI already added.");
          return ls;
        }
        const qty = serial ? ex.imeis.length + (imei ? 1 : 0) : ex.qty + 1;
        if (qty > s.qty) {
          toast.error(`Insufficient stock (available ${s.qty}).`);
          return ls;
        }
        return ls.map((l) =>
          l === ex
            ? { ...l, qty: serial ? qty : qty, imeis: imei ? [...l.imeis, imei] : l.imeis }
            : l,
        );
      }
      return [
        ...ls,
        {
          key: seq++,
          variant_id,
          qty: serial ? (imei ? 1 : 0) : 1,
          price: String(priceFor(s.product_variants)),
          imeis: imei ? [imei] : [],
        },
      ];
    });
  };

  function addCodes(codes: string[]) {
    let ok = 0;
    const miss: string[] = [];
    for (const raw of codes) {
      const candidates = imeiCandidatesFromBarcode(raw);
      const hit = imeiPool.data?.find(
        (i) => candidates.includes(i.imei1) || (i.imei2 && candidates.includes(i.imei2)),
      );
      if (hit) {
        addVariant(hit.variant_id, { id: hit.id, imei1: hit.imei1 });
        ok++;
      } else miss.push(raw);
    }
    if (ok) toast.success(`${ok} device(s) added`);
    if (miss.length)
      toast.error(
        `Not in stock at this branch: ${miss.slice(0, 5).join(", ")}${miss.length > 5 ? "…" : ""}`,
      );
  }
  function onScan(e: React.FormEvent) {
    e.preventDefault();
    const candidates = imeiCandidatesFromBarcode(scan);
    const hit = imeiPool.data?.find(
      (i) => candidates.includes(i.imei1) || (i.imei2 && candidates.includes(i.imei2)),
    );
    if (!hit) return void toast.error("IMEI not found in stock at this branch.");
    addVariant(hit.variant_id, { id: hit.id, imei1: hit.imei1 });
    setScan("");
  }

  const sub = lines.reduce((s, l) => s + l.qty * n(l.price), 0);
  const total = Math.round((sub - n(discount) + n(tax)) * 100) / 100;
  const paid = pays.reduce((s, p) => s + n(p.amount), 0);
  const due = Math.round((total - paid) * 100) / 100;
  const profit = sub - n(discount) - lines.reduce((s, l) => s + l.qty * 0, 0);
  void profit;

  const exceptionTypes = getSaleExceptionTypes({
    lines: lines.map((line) => ({
      price: n(line.price),
      minPrice: Number(vmap.get(line.variant_id)?.product_variants?.min_price ?? 0),
    })),
    subtotal: sub,
    discount: n(discount),
    due,
    customerDue: Number(cust?.current_due ?? 0),
    creditLimit: Number(cust?.credit_limit ?? 0),
  });
  const exceptionLabels: Record<SaleExceptionType, string> = {
    minimum_price: "below minimum price",
    discount_limit: "discount over 10%",
    credit_limit: "over customer credit limit",
  };

  function getSalePayload(overrideCredit: boolean) {
    if (!lines.length) throw new Error("Add at least one product.");
    if (!br) throw new Error("Select a shop before completing the sale.");
    for (const line of lines) {
      const stockItem = vmap.get(line.variant_id);
      if (!stockItem) throw new Error("This product is no longer in stock at the selected branch.");
      if (line.qty <= 0)
        throw new Error(`${stockItem.product_variants?.products?.model}: select IMEIs / quantity.`);
    }
    if (due < 0) throw new Error("Payment is more than the invoice total.");
    if (due > 0 && !customer)
      throw new Error("Walk-in sales must be fully paid. Select a customer to sell on credit.");

    const defaultAccountId = defaultCashAccount?.id ?? "";
    const paymentLines = pays.filter((payment) => n(payment.amount) > 0);
    const selectedPaymentIds = new Set(
      paymentAccounts.map((account) => account.id).filter((id): id is string => Boolean(id)),
    );
    if (paymentLines.length) {
      if (accounts.isPending)
        throw new Error("Wait for this shop's payment accounts to finish loading, then retry.");
      if (accounts.error)
        throw new Error(
          "Could not load this shop's payment accounts. Retry before completing the sale.",
        );
      if (paymentAccounts.length === 0)
        throw new Error(
          "No payment account is available for this shop. Ask an owner or manager to create a cash account for this shop and grant this role Cash & Bank view access.",
        );
      if (paymentLines.some((payment) => !(payment.account_id || defaultAccountId)))
        throw new Error(
          "Select a payment account. Ask an owner or manager to create a cash account for this shop if none is available.",
        );
      if (
        paymentLines.some(
          (payment) => !selectedPaymentIds.has(payment.account_id || defaultAccountId),
        )
      )
        throw new Error("Select an active payment account assigned to this shop.");
    }

    return {
      branch_id: br,
      customer_id: customer,
      sale_date: date,
      discount: n(discount),
      tax: n(tax),
      override_credit: overrideCredit,
      quote_id: quoteId ?? null,
      order_id: orderId ?? null,
      items: lines.map((line) => ({
        variant_id: line.variant_id,
        qty: line.qty,
        price: n(line.price),
        imei_ids: line.imeis.map((imei) => imei.id),
      })),
      payments: paymentLines.map((payment) => ({
        account_id: payment.account_id || defaultAccountId,
        method: payment.method,
        amount: n(payment.amount),
        txn_ref: payment.txn_ref,
      })),
    };
  }

  const save = useMutation({
    networkMode: "always",
    mutationFn: async (override: boolean) => {
      const { data, error } = await supabase.rpc("create_sale", {
        _biz: business.id,
        _data: getSalePayload(override),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: async (id) => {
      if (quoteId) {
        const { error: linkErr } = await supabase.rpc("mark_quotation_converted", {
          _biz: business.id,
          _id: quoteId,
          _sale: id,
        });
        if (linkErr) toast.error(friendlyError(linkErr));
      }
      if (orderId) {
        const { error: linkErr } = await supabase.rpc("mark_order_converted", {
          _biz: business.id,
          _id: orderId,
          _sale: id,
        });
        if (linkErr) toast.error(friendlyError(linkErr));
      }
      toast.success(
        quoteId
          ? "Sale completed from quotation"
          : orderId
            ? "Sale completed from order"
            : "Sale completed",
      );
      setLines([]);
      qc.invalidateQueries();
      navigate({ to: "/app/sales/$id", params: { id } });
    },
    onError: (e) => {
      const msg = (e as { message?: string }).message ?? "";
      if (msg.startsWith("CREDIT_LIMIT:")) return setCreditMsg(msg.replace("CREDIT_LIMIT: ", ""));
      toast.error(friendlyError(e));
    },
  });
  const requestApproval = useMutation({
    networkMode: "always",
    mutationFn: async (reason: string) => {
      const { data, error } = await supabase.rpc("request_sale_exception", {
        _biz: business.id,
        _data: getSalePayload(false),
        _reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Sale approval request sent to an owner or manager.");
      setRequestDialog(false);
      setRequestReason("");
      qc.invalidateQueries({ queryKey: ["sale-exception-requests", business.id] });
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const filtered = (stock.data ?? [])
    .filter((s) => {
      const q = search.toLowerCase().trim();
      const v = s.product_variants;
      return (
        !q ||
        [v?.sku, v?.products?.model, v?.products?.brands?.name].some((x) =>
          (x ?? "").toLowerCase().includes(q),
        )
      );
    })
    .slice(0, 30);

  return (
    <div>
      <PageHeader
        title="New Sale"
        sub="Stock, IMEI, customer due, cash and accounts update together."
      />
      {quote.data && (
        <p className="mb-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          Converting quotation <b className="num">{quote.data.h.quote_no}</b> into a sale. Pick the
          IMEI(s) for tracked devices, then complete the sale.
        </p>
      )}
      {order.data && (
        <p className="mb-4 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          Converting order <b className="num">{order.data.h.order_no}</b> into a sale.
          {Number(order.data.h.deposit) > 0 && (
            <>
              {" "}
              The {bdt(order.data.h.deposit)} deposit is pre-filled as a payment — confirm or change
              it.
            </>
          )}{" "}
          Pick the IMEI(s) for tracked devices, then complete the sale.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <section className="grid gap-3 rounded-lg border bg-card p-4 shadow-sm sm:grid-cols-3">
            <F label="Customer">
              <select
                className={selectCls}
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
              >
                <option value="">Walk-in customer (cash)</option>
                {custs.data?.map((c) => (
                  <option key={c.customer_id!} value={c.customer_id!}>
                    {c.name}
                    {c.business_name ? ` — ${c.business_name}` : ""} · {c.mobile}
                  </option>
                ))}
              </select>
            </F>
            <F label="Branch">
              <select
                className={selectCls}
                value={br}
                onChange={(e) => {
                  setBranch(e.target.value);
                  setLines([]);
                  setPays((current) => current.map((payment) => ({ ...payment, account_id: "" })));
                }}
              >
                {branches.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </F>
            <F label="Date">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </F>
            {cust && (
              <div className="num flex flex-wrap gap-x-6 gap-y-1 rounded-md bg-muted px-3 py-2 text-xs sm:col-span-3">
                <span>
                  Price level: <b>{LEVEL_LABEL[level]}</b>
                </span>
                <span>
                  Current due:{" "}
                  <b className={Number(cust.current_due) > 0 ? "text-destructive" : ""}>
                    {bdt(cust.current_due)}
                  </b>
                </span>
                <span>
                  Credit limit: <b>{bdt(cust.credit_limit)}</b>
                </span>
                <span>
                  Available credit:{" "}
                  <b>{bdt(Math.max(0, Number(cust.credit_limit) - Number(cust.current_due)))}</b>
                </span>
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="grid gap-2 border-b p-3 sm:grid-cols-2">
              <form onSubmit={onScan} className="flex gap-2">
                <Input
                  autoFocus
                  placeholder="Scan / type IMEI"
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  className="num font-mono"
                />
                <Button variant="secondary" aria-label="Add by IMEI">
                  <ScanLine className="h-4 w-4" />
                </Button>
                <ScanButton onCodes={addCodes} />
              </form>
              <Input
                placeholder="Search product in stock…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {search && (
              <div className="max-h-56 divide-y overflow-y-auto border-b">
                {filtered.map((s) => (
                  <Button
                    key={s.variant_id}
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      addVariant(s.variant_id);
                      setSearch("");
                    }}
                    className="grid h-auto w-full grid-cols-[minmax(0,1fr)_auto] items-center rounded-none px-3 py-3 text-left text-sm font-normal"
                  >
                    <span className="min-w-0 truncate">
                      {s.product_variants?.products?.brands?.name}{" "}
                      {s.product_variants?.products?.model}{" "}
                      <span className="text-muted-foreground">
                        {[
                          s.product_variants?.ram,
                          s.product_variants?.storage,
                          s.product_variants?.color,
                        ]
                          .filter(Boolean)
                          .join("/")}
                      </span>
                    </span>
                    <span className="num shrink-0 text-xs text-muted-foreground">
                      {s.qty} in stock · {bdt(priceFor(s.product_variants))}
                    </span>
                  </Button>
                ))}
                {!filtered.length && (
                  <p className="p-3 text-sm text-muted-foreground">
                    No matching products in stock.
                  </p>
                )}
              </div>
            )}
            {!lines.length ? (
              <p className="p-10 text-center text-sm text-muted-foreground">
                Scan an IMEI or search a product to begin.
              </p>
            ) : (
              <div className="divide-y">
                {lines.map((l) => {
                  const s = vmap.get(l.variant_id);
                  if (!s)
                    return (
                      <div
                        key={l.key}
                        className="flex items-center justify-between gap-3 p-3 text-sm"
                      >
                        <span className="text-destructive">
                          This product is no longer in stock at the selected branch.
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                        >
                          Remove
                        </Button>
                      </div>
                    );
                  const v = s.product_variants;
                  const serial = v?.products?.categories?.is_serialized;
                  const avail = (imeiPool.data ?? []).filter(
                    (i) => i.variant_id === l.variant_id && !l.imeis.some((x) => x.id === i.id),
                  );
                  const below = n(l.price) < Number(v?.min_price ?? 0);
                  return (
                    <div key={l.key} className="space-y-2 p-3">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">
                            {v?.products?.brands?.name} {v?.products?.model}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {[v?.ram, v?.storage, v?.color].filter(Boolean).join(" / ")} · {s.qty}{" "}
                            in stock · warranty {v?.warranty_months} mo
                          </div>
                        </div>
                        {!serial && (
                          <Input
                            type="number"
                            min={1}
                            max={s.qty}
                            className="w-20"
                            value={l.qty}
                            onChange={(e) =>
                              setLines(
                                lines.map((x) =>
                                  x.key === l.key
                                    ? {
                                        ...x,
                                        qty: Math.min(
                                          s.qty,
                                          Math.max(1, Math.trunc(Number(e.target.value) || 1)),
                                        ),
                                      }
                                    : x,
                                ),
                              )
                            }
                          />
                        )}
                        {serial && (
                          <Badge variant="secondary" className="num">
                            Qty {l.qty}
                          </Badge>
                        )}
                        <div className="w-32">
                          <Input
                            type="number"
                            step="0.01"
                            value={l.price}
                            onChange={(e) =>
                              setLines(
                                lines.map((x) =>
                                  x.key === l.key ? { ...x, price: e.target.value } : x,
                                ),
                              )
                            }
                            className={below ? "border-destructive" : ""}
                          />
                        </div>
                        <div className="num w-28 text-right font-semibold">
                          {bdt(l.qty * n(l.price))}
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Remove"
                          onClick={() => setLines(lines.filter((x) => x.key !== l.key))}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                      {below && (
                        <p className="text-xs text-destructive">
                          Below minimum selling price {bdt(v?.min_price)}{" "}
                          {isMgr ? "(allowed for managers)" : "— manager approval required"}
                        </p>
                      )}
                      {serial && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {l.imeis.map((i) => (
                            <Badge
                              key={i.id}
                              variant="outline"
                              className="num gap-1 font-mono text-[11px]"
                            >
                              {i.imei1}
                              <button
                                type="button"
                                aria-label="Remove IMEI"
                                onClick={() =>
                                  setLines(
                                    lines.map((x) =>
                                      x.key === l.key
                                        ? {
                                            ...x,
                                            imeis: x.imeis.filter((y) => y.id !== i.id),
                                            qty: x.qty - 1,
                                          }
                                        : x,
                                    ),
                                  )
                                }
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                          {avail.length > 0 && (
                            <select
                              className="h-7 rounded border border-input bg-background px-2 text-xs"
                              value=""
                              onChange={(e) => {
                                const i = avail.find((a) => a.id === e.target.value);
                                if (i) addVariant(l.variant_id, { id: i.id, imei1: i.imei1 });
                              }}
                            >
                              <option value="">+ pick IMEI ({avail.length} available)</option>
                              {avail.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.imei1}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="h-fit space-y-4 rounded-lg border bg-card p-4 shadow-sm lg:sticky lg:top-24">
          <dl className="num space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd>{bdt(sub)}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Discount</dt>
              <dd>
                <Input
                  type="number"
                  step="0.01"
                  className="h-8 w-28 text-right"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">VAT / Tax</dt>
              <dd>
                <Input
                  type="number"
                  step="0.01"
                  className="h-8 w-28 text-right"
                  value={tax}
                  onChange={(e) => setTax(e.target.value)}
                />
              </dd>
            </div>
            <div className="flex justify-between border-t pt-2 font-display text-xl font-semibold">
              <dt>Total</dt>
              <dd>{bdt(total)}</dd>
            </div>
          </dl>
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Payment</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setPays([
                    ...pays,
                    { key: seq++, account_id: "", method: "bkash", amount: "", txn_ref: "" },
                  ])
                }
              >
                <Plus className="mr-1 h-3 w-3" />
                Split
              </Button>
            </div>
            {accounts.error ? (
              <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                Could not load this shop&apos;s payment accounts: {friendlyError(accounts.error)}
              </p>
            ) : (
              !accounts.isPending &&
              !defaultCashAccount && (
                <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
                  <p>
                    No cash account is configured for this shop. Paid sales need an account to
                    record where the money was received.
                  </p>
                  {role === "owner" || role === "manager" ? (
                    <Button asChild size="sm" variant="outline">
                      <Link to="/app/money" search={{ kind: "cash" }}>
                        Set up shop cash account
                      </Link>
                    </Button>
                  ) : (
                    <p>Ask an owner or manager to create this shop&apos;s cash account.</p>
                  )}
                  {role !== "owner" && role !== "manager" && (
                    <p>
                      Cash &amp; Bank or Daily Closing view access is also required to select it.
                    </p>
                  )}
                </div>
              )
            )}
            {pays.map((p) => (
              <div key={p.key} className="space-y-1.5 rounded-md border p-2">
                <div className="flex gap-2">
                  <select
                    className={selectCls + " h-8"}
                    value={p.method}
                    onChange={(e) =>
                      setPays(
                        pays.map((x) =>
                          x.key === p.key ? { ...x, method: e.target.value as Method } : x,
                        ),
                      )
                    }
                  >
                    {METHODS.map((m) => (
                      <option key={m} value={m}>
                        {methodLabel(m)}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    step="0.01"
                    className="h-8"
                    placeholder="Amount"
                    value={p.amount}
                    onChange={(e) =>
                      setPays(
                        pays.map((x) => (x.key === p.key ? { ...x, amount: e.target.value } : x)),
                      )
                    }
                  />
                  {pays.length > 1 && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => setPays(pays.filter((x) => x.key !== p.key))}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                <select
                  className={selectCls + " h-8 text-xs"}
                  value={p.account_id}
                  onChange={(e) =>
                    setPays(
                      pays.map((x) => (x.key === p.key ? { ...x, account_id: e.target.value } : x)),
                    )
                  }
                >
                  <option value="">
                    {defaultCashAccount?.name
                      ? `Default: ${defaultCashAccount.name}`
                      : "Select payment account"}
                  </option>
                  {paymentAccounts.map((a) => (
                    <option key={a.id!} value={a.id!}>
                      {a.name}
                    </option>
                  ))}
                </select>
                {p.method !== "cash" && (
                  <Input
                    className="h-8 text-xs"
                    placeholder="Transaction ID"
                    value={p.txn_ref}
                    onChange={(e) =>
                      setPays(
                        pays.map((x) => (x.key === p.key ? { ...x, txn_ref: e.target.value } : x)),
                      )
                    }
                  />
                )}
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() =>
                setPays(
                  pays.map((x, i) =>
                    i === 0
                      ? {
                          ...x,
                          amount: String(
                            Math.max(0, total - pays.slice(1).reduce((s, y) => s + n(y.amount), 0)),
                          ),
                        }
                      : x,
                  ),
                )
              }
            >
              Paid in full
            </Button>
            <div className="num flex justify-between pt-1 text-sm font-semibold">
              <span>{due > 0 ? "Customer due" : due < 0 ? "Overpaid" : "Fully paid"}</span>
              <span className={due !== 0 ? "text-destructive" : "text-success"}>{bdt(due)}</span>
            </div>
          </div>
          <Button
            className="w-full"
            size="lg"
            disabled={
              save.isPending ||
              requestApproval.isPending ||
              !lines.length ||
              (paid > 0 && accounts.isPending)
            }
            onClick={() => save.mutate(false)}
          >
            {save.isPending ? "Saving…" : "Complete sale"}
          </Button>
          {isBranchManager && exceptionTypes.length > 0 && (
            <Button
              className="w-full"
              variant="outline"
              disabled={
                save.isPending ||
                requestApproval.isPending ||
                !lines.length ||
                stock.isPending ||
                (paid > 0 && accounts.isPending)
              }
              onClick={() => setRequestDialog(true)}
            >
              Request approval: {exceptionTypes.map((type) => exceptionLabels[type]).join(", ")}
            </Button>
          )}
        </aside>
      </div>

      <AlertDialog open={!!creditMsg} onOpenChange={(o) => !o && setCreditMsg(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Credit limit exceeded</AlertDialogTitle>
            <AlertDialogDescription>{creditMsg}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            {isMgr ? (
              <AlertDialogAction onClick={() => save.mutate(true)}>
                Approve & complete sale
              </AlertDialogAction>
            ) : isBranchManager ? (
              <AlertDialogAction
                onClick={() => {
                  setCreditMsg(null);
                  setRequestDialog(true);
                }}
              >
                Request manager approval
              </AlertDialogAction>
            ) : (
              <p className="text-sm text-muted-foreground">
                Ask a manager to approve, or take more payment.
              </p>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={requestDialog}
        onOpenChange={(open) => {
          setRequestDialog(open);
          if (!open) setRequestReason("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Request sale approval</AlertDialogTitle>
            <AlertDialogDescription>
              This sale will not post until a different owner or manager approves it. Stock,
              customer credit, and payment accounts will be checked again at approval time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {exceptionTypes.length > 0 && (
            <p className="text-sm">
              Exceptions: {exceptionTypes.map((type) => exceptionLabels[type]).join(", ")}
            </p>
          )}
          <Input
            aria-label="Reason for approval request"
            maxLength={1000}
            placeholder="Reason for this exception"
            value={requestReason}
            onChange={(event) => setRequestReason(event.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={requestApproval.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!requestReason.trim() || requestApproval.isPending}
              onClick={(event) => {
                event.preventDefault();
                requestApproval.mutate(requestReason.trim());
              }}
            >
              {requestApproval.isPending ? "Sending…" : "Send for approval"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
