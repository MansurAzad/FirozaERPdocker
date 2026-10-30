import { matchedCompany } from "@/lib/branding";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBusiness } from "@/lib/business";
import { useI18n } from "@/lib/i18n";
import { hasAccess } from "@/lib/access-control";
import { bdt, friendlyError } from "@/lib/format";
import {
  fieldSalesRemainingQty,
  fieldSalesReturnCountMatches,
  matchesFieldSalesImei,
} from "@/lib/field-sales";
import { PageHeader } from "@/components/erp/EntityManager";
import { F, selectCls, today } from "@/components/erp/ui";
import { ScanButton } from "@/components/erp/ScanButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/app/field-sales")({
  head: ({ matches }) => ({
    meta: [
      { title: `Field Sales — ${matchedCompany(matches)}` },
      {
        name: "description",
        content: "Issue stock to salesmen, record retailer sales and settle trips.",
      },
    ],
  }),
  component: FieldSales,
});

type IssueLine = {
  variant_id: string;
  label: string;
  serialized: boolean;
  qty: number;
  imei_ids: string[];
};
type ReturnLine = { good: string; damaged: string; goodIds: string[]; damagedIds: string[] };
type ImeiRecord = { id: string; imei1: string; imei2: string | null; variant_id: string };
const ISSUE_ROLES = ["owner", "manager", "store_keeper"];
const APPROVAL_ROLES = ["owner", "manager", "accountant", "branch_manager"];

function FieldSales() {
  const { business, role, userId, access } = useBusiness();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const text = (en: string, bn: string) => (lang === "bn" ? bn : en);
  const canIssue = ISSUE_ROLES.includes(role) && hasAccess(access, "transfers", "create");
  const canApprove = APPROVAL_ROLES.includes(role) && hasAccess(access, "sales", "approve");

  const [stockBranch, setStockBranch] = useState("");
  const [salesBranch, setSalesBranch] = useState("");
  const [salesmanUser, setSalesmanUser] = useState("");
  const [issueVariant, setIssueVariant] = useState("");
  const [issueQty, setIssueQty] = useState("1");
  const [issueLines, setIssueLines] = useState<IssueLine[]>([]);
  const [issueCodes, setIssueCodes] = useState<string[]>([]);
  const [issueCode, setIssueCode] = useState("");
  const [issueFeedback, setIssueFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [activeTripId, setActiveTripId] = useState("");
  const [saleCustomer, setSaleCustomer] = useState("");
  const [saleVariant, setSaleVariant] = useState("");
  const [saleQty, setSaleQty] = useState("1");
  const [salePrice, setSalePrice] = useState("");
  const [saleImeiIds, setSaleImeiIds] = useState<string[]>([]);
  const [salePaid, setSalePaid] = useState("");
  const [saleCode, setSaleCode] = useState("");
  const [saleFeedback, setSaleFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [collectionCustomer, setCollectionCustomer] = useState("");
  const [collectionAmount, setCollectionAmount] = useState("");
  const [collectionNote, setCollectionNote] = useState("");
  const [returnLines, setReturnLines] = useState<Record<string, ReturnLine>>({});
  const [returnMode, setReturnMode] = useState<"good" | "damaged">("good");
  const [returnVariant, setReturnVariant] = useState("");
  const [returnCode, setReturnCode] = useState("");
  const [returnFeedback, setReturnFeedback] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [cashCounted, setCashCounted] = useState("");
  const [depositAccount, setDepositAccount] = useState("");
  const [settlementNote, setSettlementNote] = useState("");
  const [approvalNote, setApprovalNote] = useState<Record<string, string>>({});

  const branches = useQuery({
    queryKey: ["field-sales-branches", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id,name,kind,status")
        .eq("business_id", business.id)
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const members = useQuery({
    queryKey: ["field-sales-salesmen", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("salesmen")
        .select("id,user_id,name,status")
        .eq("business_id", business.id)
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data.filter((item) => item.user_id);
    },
  });
  const variants = useQuery({
    queryKey: ["field-sales-variants", business.id],
    queryFn: async () => {
      const [v, p, c, b] = await Promise.all([
        supabase
          .from("product_variants")
          .select("id,sku,product_id,retail_price,wholesale_price,dealer_price,ram,storage,color")
          .eq("business_id", business.id)
          .eq("status", "active"),
        supabase
          .from("products")
          .select("id,model,category_id,brand_id")
          .eq("business_id", business.id),
        supabase.from("categories").select("id,name,is_serialized").eq("business_id", business.id),
        supabase.from("brands").select("id,name").eq("business_id", business.id),
      ]);
      if (v.error) throw v.error;
      if (p.error) throw p.error;
      if (c.error) throw c.error;
      if (b.error) throw b.error;
      return v.data.map((variant) => {
        const product = p.data.find((item) => item.id === variant.product_id);
        const category = c.data.find((item) => item.id === product?.category_id);
        const brand = b.data.find((item) => item.id === product?.brand_id);
        const label = [
          brand?.name,
          product?.model ?? variant.sku,
          [variant.ram, variant.storage, variant.color].filter(Boolean).join(" / "),
        ]
          .filter(Boolean)
          .join(" — ");
        return {
          ...variant,
          label,
          serialized: category?.is_serialized ?? false,
        };
      });
    },
  });
  const customers = useQuery({
    queryKey: ["field-sales-customers", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id,name,mobile,price_level,status")
        .eq("business_id", business.id)
        .eq("status", "active")
        .order("name");
      if (error) throw error;
      return data;
    },
  });
  const trips = useQuery({
    queryKey: ["field-sales-trips", business.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("field_sales_trips")
        .select("*")
        .eq("business_id", business.id)
        .order("opened_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    refetchInterval: 30_000,
  });
  const openTrip =
    trips.data?.find((trip) => trip.id === activeTripId) ??
    trips.data?.find((trip) => trip.salesman_user_id === userId && trip.status === "open");
  const tripSummary = useQuery({
    enabled: !!openTrip,
    queryKey: ["field-sales-trip-summary", business.id, openTrip?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_field_sales_trip_summary", {
        _biz: business.id,
        _trip: openTrip!.id,
      });
      if (error) throw error;
      return data;
    },
  });
  const accounts = useQuery({
    enabled: !!openTrip,
    queryKey: ["field-sales-deposit-accounts", business.id, openTrip?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_field_sales_deposit_accounts", {
        _biz: business.id,
        _trip: openTrip!.id,
      });
      if (error) throw error;
      return data;
    },
  });
  const tripItems = useQuery({
    enabled: !!openTrip,
    queryKey: ["field-sales-trip-items", business.id, openTrip?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("field_sales_trip_items")
        .select("id,trip_id,variant_id,qty_issued,qty_returned,qty_damaged,unit_cost")
        .eq("business_id", business.id)
        .eq("trip_id", openTrip!.id);
      if (error) throw error;
      return data;
    },
  });
  const tripImeis = useQuery({
    enabled: !!openTrip,
    queryKey: ["field-sales-trip-imeis", business.id, openTrip?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("field_sales_trip_imeis")
        .select("business_id,trip_id,trip_item_id,imei_id,status")
        .eq("business_id", business.id)
        .eq("trip_id", openTrip!.id);
      if (error) throw error;
      return data;
    },
  });
  const tripImeiCodes = useQuery({
    enabled: !!tripImeis.data?.length,
    queryKey: ["field-sales-trip-imei-codes", business.id, openTrip?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product_imeis")
        .select("id,imei1,imei2,variant_id")
        .eq("business_id", business.id)
        .in(
          "id",
          tripImeis.data!.map((item) => item.imei_id),
        );
      if (error) throw error;
      return data;
    },
  });
  const tripSales = useQuery({
    enabled: !!openTrip,
    queryKey: ["field-sales-trip-sales", business.id, openTrip?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id,invoice_no,total,paid,due,customer_id,created_at")
        .eq("business_id", business.id)
        .eq("field_sales_trip_id", openTrip!.id)
        .eq("status", "posted")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const tripSaleItems = useQuery({
    enabled: !!tripSales.data?.length,
    queryKey: ["field-sales-trip-sale-items", business.id, openTrip?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sale_items")
        .select("sale_id,variant_id,qty")
        .eq("business_id", business.id)
        .in(
          "sale_id",
          tripSales.data!.map((sale) => sale.id),
        );
      if (error) throw error;
      return data;
    },
  });
  const warehouseStock = useQuery({
    enabled: !!stockBranch,
    queryKey: ["field-sales-warehouse-stock", business.id, stockBranch],
    queryFn: async () => {
      const [s, im] = await Promise.all([
        supabase
          .from("stock")
          .select("variant_id,qty,avg_cost")
          .eq("business_id", business.id)
          .eq("branch_id", stockBranch)
          .gt("qty", 0),
        supabase
          .from("product_imeis")
          .select("id,imei1,imei2,variant_id")
          .eq("business_id", business.id)
          .eq("branch_id", stockBranch)
          .eq("status", "IN_STOCK"),
      ]);
      if (s.error) throw s.error;
      if (im.error) throw im.error;
      return { stock: s.data, imeis: im.data };
    },
  });
  const pendingTrips = useMemo(
    () => (trips.data ?? []).filter((trip) => trip.status === "settlement_pending"),
    [trips.data],
  );
  const settlements = useQuery({
    enabled: canApprove && pendingTrips.length > 0,
    queryKey: ["field-sales-settlements", business.id, pendingTrips.map((trip) => trip.id)],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("field_sales_settlements")
        .select("*")
        .eq("business_id", business.id)
        .eq("status", "pending")
        .in(
          "trip_id",
          pendingTrips.map((trip) => trip.id),
        );
      if (error) throw error;
      return data;
    },
  });
  const pendingSettlementItems = useQuery({
    enabled: canApprove && (settlements.data?.length ?? 0) > 0,
    queryKey: ["field-sales-settlement-items", business.id, settlements.data?.map((row) => row.id)],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("field_sales_settlement_items")
        .select("business_id,settlement_id,trip_item_id,good_qty,damaged_qty")
        .eq("business_id", business.id)
        .in(
          "settlement_id",
          settlements.data!.map((row) => row.id),
        );
      if (error) throw error;
      return data;
    },
  });
  const pendingTripItems = useQuery({
    enabled: canApprove && pendingTrips.length > 0,
    queryKey: ["field-sales-pending-trip-items", business.id, pendingTrips.map((row) => row.id)],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("field_sales_trip_items")
        .select("id,trip_id,variant_id,qty_issued,qty_returned,qty_damaged,unit_cost")
        .eq("business_id", business.id)
        .in(
          "trip_id",
          pendingTrips.map((row) => row.id),
        );
      if (error) throw error;
      return data;
    },
  });
  const pendingSales = useQuery({
    enabled: canApprove && pendingTrips.length > 0,
    queryKey: ["field-sales-pending-sales", business.id, pendingTrips.map((row) => row.id)],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales")
        .select("id,field_sales_trip_id,total")
        .eq("business_id", business.id)
        .eq("status", "posted")
        .in(
          "field_sales_trip_id",
          pendingTrips.map((row) => row.id),
        );
      if (error) throw error;
      return data;
    },
  });

  const createTrip = useMutation({
    mutationFn: async () => {
      if (!salesmanUser || !stockBranch || !salesBranch || issueLines.length === 0)
        throw new Error(
          text(
            "Choose a salesman, both locations and stock to issue.",
            "সেলসম্যান, দুইটি শাখা ও ইস্যুর স্টক নির্বাচন করুন।",
          ),
        );
      const { data, error } = await supabase.rpc("create_field_sales_trip", {
        _biz: business.id,
        _data: {
          salesman_user_id: salesmanUser,
          stock_branch_id: stockBranch,
          sales_branch_id: salesBranch,
          items: issueLines.map((line) => ({
            variant_id: line.variant_id,
            qty: line.qty,
            imei_ids: line.imei_ids,
          })),
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (id) => {
      toast.success(text("Stock issued and trip opened.", "স্টক ইস্যু করে ট্রিপ খোলা হয়েছে।"));
      setIssueLines([]);
      setIssueCodes([]);
      setActiveTripId(id);
      qc.invalidateQueries();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const createSale = useMutation({
    mutationFn: async () => {
      if (!openTrip || !saleCustomer || !saleVariant)
        throw new Error(
          text(
            "Select an open trip, retailer and product.",
            "খোলা ট্রিপ, খুচরা বিক্রেতা ও পণ্য নির্বাচন করুন।",
          ),
        );
      const variant = variants.data?.find((item) => item.id === saleVariant);
      if (!variant)
        throw new Error(
          text("The selected product is unavailable.", "নির্বাচিত পণ্যটি পাওয়া যাচ্ছে না।"),
        );
      const qty = Number(saleQty);
      const price = Number(salePrice || variant.retail_price);
      if (!Number.isInteger(qty) || qty < 1 || !Number.isFinite(price) || price <= 0)
        throw new Error(text("Enter a valid quantity and price.", "সঠিক পরিমাণ ও দাম লিখুন।"));
      if (variant.serialized && saleImeiIds.length !== qty)
        throw new Error(
          text(`Scan exactly ${qty} issued IMEI(s).`, `ঠিক ${qty}টি ইস্যুকৃত IMEI স্ক্যান করুন।`),
        );
      const paid = Number(salePaid || 0);
      if (!Number.isFinite(paid) || paid < 0 || paid > qty * price)
        throw new Error(text("Enter a valid cash amount.", "সঠিক নগদ টাকার পরিমাণ লিখুন।"));
      const { data, error } = await supabase.rpc("create_field_sales_sale", {
        _biz: business.id,
        _trip: openTrip.id,
        _data: {
          customer_id: saleCustomer,
          sale_date: today(),
          discount: 0,
          tax: 0,
          items: [{ variant_id: saleVariant, qty, price, imei_ids: saleImeiIds }],
          payments:
            paid > 0
              ? [
                  {
                    account_id: openTrip.cash_account_id,
                    method: "cash",
                    amount: paid,
                    txn_ref: "",
                  },
                ]
              : [],
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(text("Retailer sale recorded.", "খুচরা বিক্রি সংরক্ষিত হয়েছে।"));
      setSaleImeiIds([]);
      setSaleCode("");
      setSalePaid("");
      setSaleQty("1");
      qc.invalidateQueries();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const collectPayment = useMutation({
    mutationFn: async () => {
      if (!openTrip || !collectionCustomer)
        throw new Error(text("Select a retailer.", "একজন খুচরা বিক্রেতা নির্বাচন করুন।"));
      const amount = Number(collectionAmount);
      if (!Number.isFinite(amount) || amount <= 0)
        throw new Error(text("Enter a valid amount.", "সঠিক টাকার পরিমাণ লিখুন।"));
      const { data, error } = await supabase.rpc("collect_field_sales_payment", {
        _biz: business.id,
        _trip: openTrip.id,
        _customer: collectionCustomer,
        _amount: amount,
        _date: today(),
        _method: "cash",
        _txn_ref: "",
        _note: collectionNote,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(text("Retailer payment recorded.", "খুচরা বিক্রেতার পেমেন্ট সংরক্ষিত হয়েছে।"));
      setCollectionAmount("");
      setCollectionNote("");
      qc.invalidateQueries();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const submitSettlement = useMutation({
    mutationFn: async () => {
      if (!openTrip) throw new Error(text("No open trip.", "কোনো খোলা ট্রিপ নেই।"));
      if (!cashCounted.trim() || !depositAccount || !settlementNote.trim())
        throw new Error(
          text(
            "Enter the counted cash, a deposit account and a settlement note.",
            "গণনা করা নগদ, জমার অ্যাকাউন্ট ও হিসাবের নোট দিন।",
          ),
        );
      const returns = (tripItems.data ?? []).map((item) => {
        const variant = variants.data?.find((entry) => entry.id === item.variant_id);
        const state = returnLines[item.id] ?? {
          good: "0",
          damaged: "0",
          goodIds: [],
          damagedIds: [],
        };
        const sold = (tripSaleItems.data ?? [])
          .filter((sale) => sale.variant_id === item.variant_id)
          .reduce((sum, sale) => sum + sale.qty, 0);
        const remaining = fieldSalesRemainingQty(
          item.qty_issued,
          item.qty_returned,
          item.qty_damaged,
          sold,
        );
        const good = variant?.serialized ? state.goodIds.length : Number(state.good || 0);
        const damaged = variant?.serialized ? state.damagedIds.length : Number(state.damaged || 0);
        if (!fieldSalesReturnCountMatches(remaining, good, damaged))
          throw new Error(
            text(
              `${variant?.label ?? "Product"}: all ${remaining} remaining unit(s) must be returned or damaged.`,
              `${variant?.label ?? "পণ্য"}: অবশিষ্ট ${remaining}টি পণ্য ফেরত বা ক্ষতিগ্রস্ত হিসেবে দিতে হবে।`,
            ),
          );
        return {
          variant_id: item.variant_id,
          good_qty: good,
          damaged_qty: damaged,
          good_imei_ids: state.goodIds,
          damaged_imei_ids: state.damagedIds,
        };
      });
      const { data, error } = await supabase.rpc("submit_field_sales_settlement", {
        _biz: business.id,
        _trip: openTrip.id,
        _returns: returns,
        _cash_counted: Number(cashCounted),
        _deposit_account: depositAccount,
        _reason: settlementNote.trim(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(
        text(
          "Settlement submitted for manager approval.",
          "ম্যানেজারের অনুমোদনের জন্য হিসাব জমা হয়েছে।",
        ),
      );
      setReturnLines({});
      setSettlementNote("");
      setCashCounted("");
      qc.invalidateQueries();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const approveSettlement = useMutation({
    mutationFn: async (tripId: string) => {
      const { error } = await supabase.rpc("approve_field_sales_settlement", {
        _biz: business.id,
        _trip: tripId,
        _note: approvalNote[tripId] ?? "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(text("Settlement approved and posted.", "হিসাব অনুমোদিত ও পোস্ট হয়েছে।"));
      qc.invalidateQueries();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });
  const rejectSettlement = useMutation({
    mutationFn: async (tripId: string) => {
      const reason = approvalNote[tripId]?.trim() ?? "";
      if (!reason) throw new Error(text("Enter a rejection reason.", "বাতিলের কারণ লিখুন।"));
      const { error } = await supabase.rpc("reject_field_sales_settlement", {
        _biz: business.id,
        _trip: tripId,
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        text(
          "Settlement returned to the salesman for correction.",
          "সংশোধনের জন্য হিসাব সেলসম্যানের কাছে ফেরত পাঠানো হয়েছে।",
        ),
      );
      qc.invalidateQueries();
    },
    onError: (error) => toast.error(friendlyError(error)),
  });

  const issueOptions = (warehouseStock.data?.stock ?? []).flatMap((stock) => {
    const variant = variants.data?.find((item) => item.id === stock.variant_id);
    return variant ? [{ stock, variant }] : [];
  });
  const activeTripItems = tripItems.data ?? [];
  const expectedCash =
    tripSummary.data && typeof tripSummary.data === "object" && !Array.isArray(tripSummary.data)
      ? Number(tripSummary.data["expected_cash"] ?? 0)
      : 0;
  const pendingSettlement = settlements.data ?? [];
  const queryErrors = [
    { label: text("Branches", "শাখা"), error: branches.error },
    { label: text("Salesmen", "সেলসম্যান"), error: members.error },
    { label: text("Products", "পণ্য"), error: variants.error },
    { label: text("Retailers", "খুচরা বিক্রেতা"), error: customers.error },
    { label: text("Trips", "ট্রিপ"), error: trips.error },
    { label: text("Trip stock", "ট্রিপের স্টক"), error: tripItems.error },
    { label: text("IMEIs", "IMEI"), error: tripImeis.error ?? tripImeiCodes.error },
    { label: text("Trip sales", "ট্রিপ বিক্রি"), error: tripSales.error ?? tripSaleItems.error },
    { label: text("Deposit accounts", "জমার অ্যাকাউন্ট"), error: accounts.error },
    {
      label: text("Settlement review", "হিসাব পর্যালোচনা"),
      error:
        settlements.error ??
        pendingSettlementItems.error ??
        pendingTripItems.error ??
        pendingSales.error,
    },
  ].filter((item) => item.error != null);
  function defaultSalePrice(variantId: string, customerId = saleCustomer) {
    const variant = variants.data?.find((item) => item.id === variantId);
    const priceLevel = customers.data?.find((item) => item.id === customerId)?.price_level;
    if (!variant) return "";
    if (priceLevel === "dealer") return String(variant.dealer_price);
    if (priceLevel === "wholesale") return String(variant.wholesale_price);
    return String(variant.retail_price);
  }

  function applyIssueCodes(codes: string[]) {
    const stockImeis = warehouseStock.data?.imeis ?? [];
    for (const code of codes) {
      const found = stockImeis.find((imei) => matchesFieldSalesImei(imei, code, issueVariant));
      const variant = issueOptions.find((option) => option.variant.id === issueVariant)?.variant;
      if (!found || !variant || !variant.serialized) {
        setIssueFeedback({
          ok: false,
          message: text(
            "Unknown IMEI or it does not match the selected stock.",
            "অচেনা IMEI অথবা নির্বাচিত স্টকের সঙ্গে মেলেনি।",
          ),
        });
        navigator.vibrate?.([100, 50, 100]);
        continue;
      }
      if (
        issueCodes.includes(code) ||
        issueLines.some((line) => line.imei_ids.includes(found.id))
      ) {
        setIssueFeedback({
          ok: false,
          message: text(
            "This IMEI is already in the issue list.",
            "এই IMEI ইতিমধ্যে ইস্যু তালিকায় আছে।",
          ),
        });
        navigator.vibrate?.([100, 50, 100]);
        continue;
      }
      setIssueCodes((current) => [...current, found.id]);
      setIssueFeedback({
        ok: true,
        message: text("IMEI verified and added.", "IMEI যাচাই করে যোগ করা হয়েছে।"),
      });
    }
  }
  function addIssueLine() {
    const option = issueOptions.find((item) => item.variant.id === issueVariant);
    if (!option) return;
    const qty = option.variant.serialized ? issueCodes.length : Number(issueQty);
    if (!Number.isInteger(qty) || qty < 1 || qty > option.stock.qty) {
      toast.error(
        text("Quantity must be within available stock.", "পরিমাণ উপলভ্য স্টকের মধ্যে হতে হবে।"),
      );
      return;
    }
    if (option.variant.serialized && issueCodes.length !== qty) {
      toast.error(
        text(
          "Scan each IMEI before adding this phone.",
          "ফোন যোগ করার আগে প্রতিটি IMEI স্ক্যান করুন।",
        ),
      );
      return;
    }
    if (issueLines.some((line) => line.variant_id === issueVariant)) {
      toast.error(text("This product is already in the list.", "এই পণ্যটি তালিকায় রয়েছে।"));
      return;
    }
    setIssueLines((items) => [
      ...items,
      {
        variant_id: issueVariant,
        label: option.variant.label,
        serialized: option.variant.serialized,
        qty,
        imei_ids: issueCodes,
      },
    ]);
    setIssueCodes([]);
    setIssueVariant("");
    setIssueFeedback(null);
  }
  function applySaleCode(code: string) {
    const available = (tripImeis.data ?? []).filter(
      (item) => item.status === "issued" && item.trip_item_id,
    );
    const match = tripImeiCodes.data?.find((item) =>
      matchesFieldSalesImei(item, code, saleVariant),
    );
    if (!match || !available.some((item) => item.imei_id === match.id)) {
      setSaleFeedback({
        ok: false,
        message: text("IMEI is not available on this trip.", "এই IMEI ট্রিপে বিক্রির জন্য নেই।"),
      });
      navigator.vibrate?.([100, 50, 100]);
      return;
    }
    if (saleImeiIds.includes(match.id)) {
      setSaleFeedback({
        ok: false,
        message: text("This IMEI is already selected.", "এই IMEI ইতিমধ্যে নির্বাচিত।"),
      });
      navigator.vibrate?.([100, 50, 100]);
      return;
    }
    setSaleImeiIds((items) => [...items, match.id]);
    setSaleFeedback({ ok: true, message: text("IMEI verified.", "IMEI যাচাই হয়েছে।") });
  }
  function applyReturnCode(code: string) {
    const match = tripImeiCodes.data?.find((item) =>
      matchesFieldSalesImei(item, code, returnVariant),
    );
    const link = tripImeis.data?.find(
      (item) => item.imei_id === match?.id && item.status === "issued",
    );
    const item = tripItems.data?.find((entry) => entry.id === link?.trip_item_id);
    if (!match || !item || item.variant_id !== returnVariant) {
      setReturnFeedback({
        ok: false,
        message: text(
          "Unknown or unavailable trip IMEI.",
          "অচেনা বা ট্রিপে ফেরতযোগ্য নয় এমন IMEI।",
        ),
      });
      navigator.vibrate?.([100, 50, 100]);
      return;
    }
    const state = returnLines[item.id] ?? { good: "0", damaged: "0", goodIds: [], damagedIds: [] };
    if (state.goodIds.includes(match.id) || state.damagedIds.includes(match.id)) {
      setReturnFeedback({
        ok: false,
        message: text("This IMEI is already classified.", "এই IMEI-র অবস্থা ইতিমধ্যে নির্ধারিত।"),
      });
      navigator.vibrate?.([100, 50, 100]);
      return;
    }
    setReturnLines((current) => {
      const previous = current[item.id] ?? { good: "0", damaged: "0", goodIds: [], damagedIds: [] };
      return {
        ...current,
        [item.id]: {
          ...previous,
          goodIds: returnMode === "good" ? [...previous.goodIds, match.id] : previous.goodIds,
          damagedIds:
            returnMode === "damaged" ? [...previous.damagedIds, match.id] : previous.damagedIds,
        },
      };
    });
    setReturnFeedback({
      ok: true,
      message: text("IMEI verified and classified.", "IMEI যাচাই করে শ্রেণিবদ্ধ করা হয়েছে।"),
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={text("Field Sales", "ফিল্ড সেলস")}
        sub={text(
          "Issue warehouse stock to a salesman, record retailer sales and cash, then reconcile every item at trip close.",
          "গুদাম থেকে সেলসম্যানকে স্টক দিন, খুচরা বিক্রি ও নগদ হিসাব রাখুন, ট্রিপ শেষে প্রতিটি পণ্য মিলিয়ে নিন।",
        )}
      />
      {queryErrors.length > 0 && (
        <div
          role="alert"
          className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {queryErrors.map((item) => (
            <p key={item.label}>
              {item.label}: {friendlyError(item.error)}
            </p>
          ))}
        </div>
      )}

      {canIssue && (
        <section className="space-y-4 rounded-lg border bg-card p-4">
          <h2 className="font-semibold">
            {text("Open a salesman trip", "সেলসম্যানের ট্রিপ খুলুন")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <F label={text("Salesman", "সেলসম্যান")}>
              <select
                className={selectCls}
                value={salesmanUser}
                onChange={(e) => setSalesmanUser(e.target.value)}
              >
                <option value="">{text("Choose salesman", "সেলসম্যান বাছুন")}</option>
                {(members.data ?? []).map((person) => (
                  <option key={person.id} value={person.user_id!}>
                    {person.name}
                  </option>
                ))}
              </select>
            </F>
            <F label={text("Stock house", "স্টক হাউস")}>
              <select
                className={selectCls}
                value={stockBranch}
                onChange={(e) => setStockBranch(e.target.value)}
              >
                <option value="">{text("Choose warehouse", "গুদাম বাছুন")}</option>
                {(branches.data ?? [])
                  .filter((branch) => branch.kind === "head" || branch.kind === "warehouse")
                  .map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
              </select>
            </F>
            <F label={text("Sales shop", "বিক্রির দোকান")}>
              <select
                className={selectCls}
                value={salesBranch}
                onChange={(e) => setSalesBranch(e.target.value)}
              >
                <option value="">{text("Choose shop", "দোকান বাছুন")}</option>
                {(branches.data ?? [])
                  .filter((branch) => branch.kind === "branch")
                  .map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
              </select>
            </F>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px_auto]">
            <F label={text("Product available at stock house", "স্টক হাউসে থাকা পণ্য")}>
              <select
                className={selectCls}
                value={issueVariant}
                onChange={(e) => {
                  setIssueVariant(e.target.value);
                  setIssueCodes([]);
                  setIssueFeedback(null);
                }}
              >
                <option value="">{text("Choose product", "পণ্য বাছুন")}</option>
                {issueOptions.map(({ stock, variant }) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.label} · {stock.qty} {text("available", "মজুত")}
                  </option>
                ))}
              </select>
            </F>
            {issueOptions.find((item) => item.variant.id === issueVariant)?.variant.serialized ? (
              <div className="flex items-end gap-2">
                <ScanButton
                  label={text("Scan IMEI", "IMEI স্ক্যান")}
                  multi={false}
                  vibrateSuccess={false}
                  onCodes={applyIssueCodes}
                />
                <Input
                  className="max-w-xs"
                  value={issueCode}
                  onChange={(e) => setIssueCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyIssueCodes([issueCode.trim()]);
                      setIssueCode("");
                    }
                  }}
                  placeholder={text("Or type IMEI + Enter", "অথবা IMEI লিখে Enter")}
                />
                <span className="pb-2 text-sm">
                  {issueCodes.length} {text("scanned", "টি স্ক্যান")}
                </span>
              </div>
            ) : (
              <F label={text("Quantity", "পরিমাণ")}>
                <Input
                  type="number"
                  min="1"
                  value={issueQty}
                  onChange={(e) => setIssueQty(e.target.value)}
                />
              </F>
            )}
            <Button className="self-end" variant="secondary" onClick={addIssueLine}>
              {text("Add stock", "স্টক যোগ")}
            </Button>
          </div>
          {issueFeedback && (
            <p
              className={issueFeedback.ok ? "text-sm text-emerald-600" : "text-sm text-destructive"}
            >
              {issueFeedback.message}
            </p>
          )}
          {issueLines.map((line) => (
            <div
              key={line.variant_id}
              className="flex items-center justify-between rounded border p-2 text-sm"
            >
              <span>
                {line.label} · {line.qty}{" "}
                {line.serialized ? `IMEI (${line.imei_ids.length})` : text("units", "টি")}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setIssueLines((items) =>
                    items.filter((item) => item.variant_id !== line.variant_id),
                  )
                }
              >
                {text("Remove", "সরান")}
              </Button>
            </div>
          ))}
          <Button
            disabled={!issueLines.length || createTrip.isPending}
            onClick={() => createTrip.mutate()}
          >
            {text("Issue stock & open trip", "স্টক ইস্যু করে ট্রিপ খুলুন")}
          </Button>
        </section>
      )}

      <section className="space-y-4 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">{text("Trips", "ট্রিপসমূহ")}</h2>
          <select
            className={`${selectCls} max-w-sm`}
            value={openTrip?.id ?? activeTripId}
            onChange={(e) => setActiveTripId(e.target.value)}
          >
            <option value="">{text("Choose a trip", "ট্রিপ বাছুন")}</option>
            {(trips.data ?? []).map((trip) => (
              <option key={trip.id} value={trip.id}>
                {(members.data ?? []).find((person) => person.user_id === trip.salesman_user_id)
                  ?.name ?? text("Salesman", "সেলসম্যান")}
                {" · "}
                {(branches.data ?? []).find((branch) => branch.id === trip.sales_branch_id)?.name ??
                  ""}
                {" · "}
                {new Date(trip.opened_at).toLocaleDateString()}
                {" · "}
                {trip.status}
              </option>
            ))}
          </select>
        </div>
        {!openTrip ? (
          <p className="text-sm text-muted-foreground">
            {text(
              "No open trip is assigned to you. Select a trip to review it or ask a manager to issue stock.",
              "আপনার নামে খোলা ট্রিপ নেই। ট্রিপ দেখতে বাছুন অথবা ম্যানেজারকে স্টক ইস্যু করতে বলুন।",
            )}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant={openTrip.status === "open" ? "default" : "secondary"}>
                {openTrip.status}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {text("Expected cash in trip account", "ট্রিপ অ্যাকাউন্টের প্রত্যাশিত নগদ")}:{" "}
                {tripSummary.isError
                  ? text("Unavailable", "দেখা যাচ্ছে না")
                  : tripSummary.isPending
                    ? text("Loading…", "লোড হচ্ছে…")
                    : bdt(expectedCash)}
              </span>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3 rounded border p-3">
                <h3 className="font-medium">{text("Retailer sale", "খুচরা বিক্রি")}</h3>
                {openTrip.salesman_user_id !== userId || openTrip.status !== "open" ? (
                  <p className="text-sm text-muted-foreground">
                    {text(
                      "Only the assigned salesman can record sales on an open trip.",
                      "শুধু নির্ধারিত সেলসম্যান খোলা ট্রিপে বিক্রি করতে পারবেন।",
                    )}
                  </p>
                ) : (
                  <>
                    <F label={text("Retailer", "খুচরা বিক্রেতা")}>
                      <select
                        className={selectCls}
                        value={saleCustomer}
                        onChange={(e) => {
                          setSaleCustomer(e.target.value);
                          if (saleVariant)
                            setSalePrice(defaultSalePrice(saleVariant, e.target.value));
                        }}
                      >
                        <option value="">{text("Choose retailer", "খুচরা বিক্রেতা বাছুন")}</option>
                        {(customers.data ?? []).map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.name} · {customer.mobile}
                          </option>
                        ))}
                      </select>
                    </F>
                    <F label={text("Product issued on this trip", "এই ট্রিপে ইস্যু করা পণ্য")}>
                      <select
                        className={selectCls}
                        value={saleVariant}
                        onChange={(e) => {
                          const selected = variants.data?.find(
                            (item) => item.id === e.target.value,
                          );
                          setSaleVariant(e.target.value);
                          setSalePrice(selected ? defaultSalePrice(selected.id) : "");
                          setSaleImeiIds([]);
                          setSaleFeedback(null);
                        }}
                      >
                        <option value="">{text("Choose product", "পণ্য বাছুন")}</option>
                        {activeTripItems.map((item) => {
                          const variant = variants.data?.find(
                            (entry) => entry.id === item.variant_id,
                          );
                          if (!variant) return null;
                          return (
                            <option key={item.id} value={item.variant_id}>
                              {variant.label}
                            </option>
                          );
                        })}
                      </select>
                    </F>
                    <div className="grid grid-cols-2 gap-3">
                      <F label={text("Quantity", "পরিমাণ")}>
                        <Input
                          type="number"
                          min="1"
                          value={saleQty}
                          onChange={(e) => setSaleQty(e.target.value)}
                        />
                      </F>
                      <F label={text("Unit price", "একক দাম")}>
                        <Input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={salePrice}
                          onChange={(e) => setSalePrice(e.target.value)}
                        />
                      </F>
                    </div>
                    {variants.data?.find((item) => item.id === saleVariant)?.serialized && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <ScanButton
                            label={text("Scan sale IMEI", "বিক্রির IMEI স্ক্যান")}
                            multi={false}
                            vibrateSuccess={false}
                            onCodes={(codes) => codes.forEach(applySaleCode)}
                          />
                          <Input
                            className="max-w-xs"
                            value={saleCode}
                            onChange={(e) => setSaleCode(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                applySaleCode(saleCode.trim());
                                setSaleCode("");
                              }
                            }}
                            placeholder={text("Or type IMEI + Enter", "অথবা IMEI লিখে Enter")}
                          />
                          <span className="text-sm">
                            {saleImeiIds.length} / {saleQty}
                          </span>
                        </div>
                        {saleFeedback && (
                          <p
                            className={
                              saleFeedback.ok
                                ? "text-sm text-emerald-600"
                                : "text-sm text-destructive"
                            }
                          >
                            {saleFeedback.message}
                          </p>
                        )}
                      </div>
                    )}
                    <F label={text("Cash received with this sale", "এই বিক্রিতে নগদ আদায়")}>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={salePaid}
                        onChange={(e) => setSalePaid(e.target.value)}
                        placeholder="0.00"
                      />
                    </F>
                    <Button disabled={createSale.isPending} onClick={() => createSale.mutate()}>
                      {text("Save retailer sale", "বিক্রি সংরক্ষণ")}
                    </Button>
                  </>
                )}
              </div>

              <div className="space-y-3 rounded border p-3">
                <h3 className="font-medium">
                  {text("Collect retailer due (cash)", "খুচরা বাকি আদায় (নগদ)")}
                </h3>
                <F label={text("Retailer", "খুচরা বিক্রেতা")}>
                  <select
                    className={selectCls}
                    value={collectionCustomer}
                    onChange={(e) => setCollectionCustomer(e.target.value)}
                  >
                    <option value="">{text("Choose retailer", "খুচরা বিক্রেতা বাছুন")}</option>
                    {(customers.data ?? []).map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name} · {customer.mobile}
                      </option>
                    ))}
                  </select>
                </F>
                <F label={text("Amount", "টাকার পরিমাণ")}>
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={collectionAmount}
                    onChange={(e) => setCollectionAmount(e.target.value)}
                  />
                </F>
                <F label={text("Note (optional)", "নোট (ঐচ্ছিক)")}>
                  <Input
                    value={collectionNote}
                    onChange={(e) => setCollectionNote(e.target.value)}
                  />
                </F>
                <Button
                  variant="secondary"
                  disabled={
                    !openTrip ||
                    openTrip.salesman_user_id !== userId ||
                    openTrip.status !== "open" ||
                    collectPayment.isPending
                  }
                  onClick={() => collectPayment.mutate()}
                >
                  {text("Record cash collection", "নগদ আদায় সংরক্ষণ")}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="font-medium">
                {text("Sales recorded on this trip", "এই ট্রিপের বিক্রিসমূহ")}
              </h3>
              {(tripSales.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {text("No sales recorded yet.", "এখনো কোনো বিক্রি নেই।")}
                </p>
              ) : (
                (tripSales.data ?? []).map((sale) => (
                  <div key={sale.id} className="flex justify-between rounded border p-2 text-sm">
                    <span>
                      {sale.invoice_no} ·{" "}
                      {(customers.data ?? []).find((c) => c.id === sale.customer_id)?.name ?? ""}
                    </span>
                    <span>
                      {bdt(sale.total)} · {text("paid", "পরিশোধ")}: {bdt(sale.paid)} ·{" "}
                      {text("due", "বাকি")}: {bdt(sale.due)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </section>

      {openTrip && openTrip.salesman_user_id === userId && openTrip.status === "open" && (
        <section className="space-y-4 rounded-lg border bg-card p-4">
          <h2 className="font-semibold">
            {text("Return stock and submit trip settlement", "স্টক ফেরত ও ট্রিপের হিসাব জমা")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {text(
              "Every remaining unit must be counted as good return or damaged. Smartphone IMEIs must be scanned individually.",
              "অবশিষ্ট প্রতিটি পণ্য ভালো ফেরত বা ক্ষতিগ্রস্ত হিসেবে দিতে হবে। স্মার্টফোনের IMEI আলাদাভাবে স্ক্যান করুন।",
            )}
          </p>
          {activeTripItems.map((item) => {
            const variant = variants.data?.find((entry) => entry.id === item.variant_id);
            if (!variant) return null;
            const state = returnLines[item.id] ?? {
              good: "0",
              damaged: "0",
              goodIds: [],
              damagedIds: [],
            };
            const sold = (tripSaleItems.data ?? [])
              .filter((line) => line.variant_id === item.variant_id)
              .reduce((sum, line) => sum + line.qty, 0);
            const remaining = fieldSalesRemainingQty(
              item.qty_issued,
              item.qty_returned,
              item.qty_damaged,
              sold,
            );
            return (
              <div key={item.id} className="space-y-2 rounded border p-3">
                <div className="flex flex-wrap justify-between gap-2 text-sm">
                  <strong>{variant.label}</strong>
                  <span>
                    {text("Issued", "ইস্যু")}: {item.qty_issued} · {text("Sold", "বিক্রি")}: {sold}{" "}
                    · {text("Remaining", "অবশিষ্ট")}: {remaining}
                  </span>
                </div>
                {variant.serialized ? (
                  <p className="text-sm">
                    {text("Good IMEIs", "ভালো IMEI")}: {state.goodIds.length} ·{" "}
                    {text("Damaged IMEIs", "ক্ষতিগ্রস্ত IMEI")}: {state.damagedIds.length}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <F label={text("Good return", "ভালো ফেরত")}>
                      <Input
                        type="number"
                        min="0"
                        value={state.good}
                        onChange={(e) =>
                          setReturnLines((current) => ({
                            ...current,
                            [item.id]: { ...state, good: e.target.value },
                          }))
                        }
                      />
                    </F>
                    <F label={text("Damaged", "ক্ষতিগ্রস্ত")}>
                      <Input
                        type="number"
                        min="0"
                        value={state.damaged}
                        onChange={(e) =>
                          setReturnLines((current) => ({
                            ...current,
                            [item.id]: { ...state, damaged: e.target.value },
                          }))
                        }
                      />
                    </F>
                  </div>
                )}
              </div>
            );
          })}
          {(tripImeis.data ?? []).some((imei) => imei.status === "issued") && (
            <div className="space-y-2 rounded border p-3">
              <F label={text("Phone to classify", "ফোনের অবস্থা নির্বাচন")}>
                <select
                  className={selectCls}
                  value={returnVariant}
                  onChange={(e) => setReturnVariant(e.target.value)}
                >
                  <option value="">{text("Choose phone model", "ফোনের মডেল বাছুন")}</option>
                  {activeTripItems
                    .filter(
                      (item) => variants.data?.find((v) => v.id === item.variant_id)?.serialized,
                    )
                    .map((item) => (
                      <option key={item.id} value={item.variant_id}>
                        {variants.data?.find((v) => v.id === item.variant_id)?.label}
                      </option>
                    ))}
                </select>
              </F>
              <div className="flex flex-wrap items-end gap-2">
                <F label={text("Classify as", "অবস্থা")}>
                  <select
                    className={selectCls}
                    value={returnMode}
                    onChange={(e) => setReturnMode(e.target.value as "good" | "damaged")}
                  >
                    <option value="good">{text("Good return", "ভালো ফেরত")}</option>
                    <option value="damaged">{text("Damaged", "ক্ষতিগ্রস্ত")}</option>
                  </select>
                </F>
                <ScanButton
                  label={text("Scan return IMEI", "ফেরতের IMEI স্ক্যান")}
                  multi={false}
                  vibrateSuccess={false}
                  onCodes={(codes) => codes.forEach(applyReturnCode)}
                />
                <Input
                  className="max-w-xs"
                  value={returnCode}
                  onChange={(e) => setReturnCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyReturnCode(returnCode.trim());
                      setReturnCode("");
                    }
                  }}
                  placeholder={text("Or type IMEI and press Enter", "অথবা IMEI লিখে Enter চাপুন")}
                />
              </div>
              {returnFeedback && (
                <p
                  className={
                    returnFeedback.ok ? "text-sm text-emerald-600" : "text-sm text-destructive"
                  }
                >
                  {returnFeedback.message}
                </p>
              )}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <F label={text("Cash physically counted", "গণনা করা নগদ")}>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={cashCounted}
                onChange={(e) => setCashCounted(e.target.value)}
              />
            </F>
            <F label={text("Deposit account", "জমার অ্যাকাউন্ট")}>
              <select
                className={selectCls}
                value={depositAccount}
                onChange={(e) => setDepositAccount(e.target.value)}
              >
                <option value="">{text("Choose account", "অ্যাকাউন্ট বাছুন")}</option>
                {(accounts.data ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} · {account.kind}
                  </option>
                ))}
              </select>
            </F>
          </div>
          <F label={text("Settlement note", "হিসাবের নোট")}>
            <Input value={settlementNote} onChange={(e) => setSettlementNote(e.target.value)} />
          </F>
          <Button disabled={submitSettlement.isPending} onClick={() => submitSettlement.mutate()}>
            {text("Submit for approval", "অনুমোদনের জন্য জমা")}
          </Button>
        </section>
      )}

      {canApprove && pendingTrips.length > 0 && (
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="font-semibold">{text("Settlement approvals", "ট্রিপ হিসাব অনুমোদন")}</h2>
          {pendingTrips.map((trip) => {
            const settlement = pendingSettlement.find((item) => item.trip_id === trip.id);
            return (
              <div key={trip.id} className="space-y-2 rounded border p-3">
                <p className="font-medium">
                  {(members.data ?? []).find((person) => person.user_id === trip.salesman_user_id)
                    ?.name ?? text("Salesman", "সেলসম্যান")}{" "}
                  ·{" "}
                  {(branches.data ?? []).find((branch) => branch.id === trip.sales_branch_id)?.name}
                </p>
                <p className="text-sm">
                  {text("Counted cash", "গণনা করা নগদ")}: {bdt(settlement?.cash_counted ?? 0)} ·{" "}
                  {text("Note", "নোট")}: {settlement?.reason ?? "—"}
                </p>
                <p className="text-sm">
                  {text("Recorded sales", "রেকর্ডকৃত বিক্রি")}:{" "}
                  {bdt(
                    (pendingSales.data ?? [])
                      .filter((sale) => sale.field_sales_trip_id === trip.id)
                      .reduce((sum, sale) => sum + sale.total, 0),
                  )}
                </p>
                {(pendingTripItems.data ?? [])
                  .filter((item) => item.trip_id === trip.id)
                  .map((item) => {
                    const line = (pendingSettlementItems.data ?? []).find(
                      (entry) =>
                        entry.settlement_id === settlement?.id && entry.trip_item_id === item.id,
                    );
                    const variant = variants.data?.find((entry) => entry.id === item.variant_id);
                    return (
                      <p key={item.id} className="text-sm text-muted-foreground">
                        {variant?.label ?? item.variant_id} · {text("issued", "ইস্যু")}:{" "}
                        {item.qty_issued} · {text("good return", "ভালো ফেরত")}:{" "}
                        {line?.good_qty ?? 0} · {text("damaged", "ক্ষতিগ্রস্ত")}:{" "}
                        {line?.damaged_qty ?? 0}
                      </p>
                    );
                  })}
                <F label={text("Approval note / rejection reason", "অনুমোদন নোট / বাতিলের কারণ")}>
                  <Input
                    value={approvalNote[trip.id] ?? ""}
                    onChange={(e) =>
                      setApprovalNote((items) => ({ ...items, [trip.id]: e.target.value }))
                    }
                  />
                </F>
                <div className="flex gap-2">
                  <Button
                    disabled={approveSettlement.isPending}
                    onClick={() => approveSettlement.mutate(trip.id)}
                  >
                    {text("Approve & post", "অনুমোদন ও পোস্ট")}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={rejectSettlement.isPending}
                    onClick={() => rejectSettlement.mutate(trip.id)}
                  >
                    {text("Reject", "বাতিল")}
                  </Button>
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
