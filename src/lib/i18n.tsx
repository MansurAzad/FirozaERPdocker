import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "bn";
export type TKey = keyof typeof dict;

export const dict = {
  dashboard: { en: "Dashboard", bn: "ড্যাশবোর্ড" },
  sales: { en: "Sales", bn: "বিক্রয়" },
  purchase: { en: "Purchase", bn: "ক্রয়" },
  inventory: { en: "Inventory", bn: "স্টক" },
  imei: { en: "IMEI Search", bn: "IMEI খুঁজুন" },
  supplierPayments: { en: "Supplier Payments", bn: "সাপ্লায়ার পেমেন্ট" },
  newSale: { en: "New Sale", bn: "নতুন বিক্রি" },
  salesHistory: { en: "Sales History", bn: "বিক্রির তালিকা" },
  dueCollection: { en: "Due Collection", bn: "বাকি আদায়" },
  ledger: { en: "Party Ledger", bn: "লেজার" },
  transfers: { en: "Stock Transfer", bn: "স্টক ট্রান্সফার" },
  warranty: { en: "Warranty Claims", bn: "ওয়ারেন্টি" },
  commission: { en: "Commission", bn: "কমিশন" },
  salesmen: { en: "Salesmen", bn: "সেলসম্যান" },
  dealers: { en: "Dealers", bn: "ডিলার" },
  cashBank: { en: "Cash & Bank", bn: "ক্যাশ ও ব্যাংক" },
  bankReconciliation: { en: "Bank Reconciliation", bn: "ব্যাংক মিলকরণ" },
  closing: { en: "Daily Closing", bn: "দৈনিক ক্লোজিং" },
  products: { en: "Products", bn: "পণ্য" },
  brands: { en: "Brands", bn: "ব্র্যান্ড" },
  categories: { en: "Categories", bn: "ক্যাটাগরি" },
  customers: { en: "Customers", bn: "কাস্টমার" },
  suppliers: { en: "Suppliers", bn: "সাপ্লায়ার" },
  branches: { en: "Branches", bn: "শাখা" },
  brandShops: { en: "Brand Shops", bn: "ব্র্যান্ডশপ" },
  team: { en: "Users & Roles", bn: "ইউজার ও রোল" },
  audit: { en: "Audit Log", bn: "অডিট লগ" },
  backup: { en: "Backup & Reset", bn: "ব্যাকআপ ও রিসেট" },
  guardian: { en: "Owner Guardian", bn: "মালিক গার্ডিয়ান" },
  guide: { en: "User Guide", bn: "ব্যবহার নির্দেশিকা" },
  settings: { en: "Settings", bn: "সেটিংস" },
  syncHistory: { en: "Offline sync history", bn: "অফলাইন সিঙ্ক ইতিহাস" },
  usage: { en: "Visitors & usage log", bn: "ভিজিটর ও ব্যবহার লগ" },
  dailyReports: { en: "Daily reports", bn: "দৈনিক রিপোর্ট" },
  cash: { en: "Cash", bn: "ক্যাশ" },
  bank: { en: "Banking", bn: "ব্যাংক" },
  expenses: { en: "Expenses", bn: "খরচ" },
  accounting: { en: "Accounting", bn: "হিসাব" },
  tagline: { en: "Business management and accounting", bn: "ব্যবসা ব্যবস্থাপনা ও হিসাব" },
  loadDemo: { en: "Load demo data", bn: "ডেমো ডেটা লোড করুন" },
  reports: { en: "Reports", bn: "রিপোর্ট" },
  comingSoon: { en: "Next phase", bn: "পরবর্তী ধাপ" },
  quotation: { en: "Quotation", bn: "কোটেশন" },
  quotations: { en: "Quotations", bn: "কোটেশন তালিকা" },
  order: { en: "Order", bn: "অর্ডার" },
  orders: { en: "Orders", bn: "অর্ডার তালিকা" },
  courier: { en: "Courier", bn: "কুরিয়ার" },
  emi: { en: "EMI / Installments", bn: "কিস্তি (EMI)" },
  partnerFinance: { en: "Partner Finance", bn: "পার্টনার ফাইন্যান্স" },
  emiNew: { en: "New Installment Sale", bn: "নতুন কিস্তি বিক্রি" },
  emiContracts: { en: "EMI Contracts", bn: "কিস্তি চুক্তি" },
  purchaseOrders: { en: "Purchase Orders", bn: "ক্রয় অর্ডার" },
  purchaseReturns: { en: "Purchase Returns", bn: "ক্রয় ফেরত" },
  stockAdjustments: { en: "Stock Adjustments", bn: "স্টক সমন্বয়" },
  reorder: { en: "Reorder List", bn: "রিঅর্ডার তালিকা" },
  labels: { en: "Price Labels", bn: "প্রাইস লেবেল" },
  bulkPrice: { en: "Bulk Price Update", bn: "বাল্ক প্রাইস আপডেট" },
  service: { en: "Service", bn: "সার্ভিস" },
  tasks: { en: "Tasks", bn: "টাস্ক" },
  supplierAging: { en: "Supplier Aging", bn: "সাপ্লায়ার এজিং" },
  deadSlowStock: { en: "Dead/Slow Stock", bn: "ডেড/স্লো স্টক" },
  customerPortal: { en: "Customer Portal", bn: "কাস্টমার পোর্টাল" },
  dailyReport: { en: "Daily Report", bn: "দৈনিক রিপোর্ট" },
  signOut: { en: "Sign out", bn: "সাইন আউট" },
  search: { en: "Search", bn: "খুঁজুন" },
  print: { en: "Print", bn: "প্রিন্ট" },
  export: { en: "Export", bn: "এক্সপোর্ট" },
  save: { en: "Save", bn: "সংরক্ষণ" },
  cancel: { en: "Cancel", bn: "বাতিল" },
  submit: { en: "Submit", bn: "জমা দিন" },
  back: { en: "Back", bn: "পেছনে" },
  edit: { en: "Edit", bn: "সম্পাদনা" },
  add: { en: "Add", bn: "যোগ করুন" },
  delete: { en: "Delete", bn: "মুছুন" },
  empty: { en: "No records found", bn: "কোনো রেকর্ড পাওয়া যায়নি" },
  remove: { en: "Remove", bn: "সরান" },
  view: { en: "View", bn: "দেখুন" },
  total: { en: "Total", bn: "মোট" },
  due: { en: "Due", bn: "বাকি" },
  customerDue: { en: "Customer due", bn: "গ্রাহকের বাকি" },
  supplierDue: { en: "Supplier due", bn: "সরবরাহকারীর বাকি" },
  stockValue: { en: "Stock value", bn: "স্টকের মূল্য" },
  todayPurchase: { en: "Today's purchases", bn: "আজকের ক্রয়" },
  todaySales: { en: "Today's sales", bn: "আজকের বিক্রি" },
  cashBalance: { en: "Cash balance", bn: "নগদ ব্যালেন্স" },
  bankBalance: { en: "Bank balance", bn: "ব্যাংক ব্যালেন্স" },
  paid: { en: "Paid", bn: "পরিশোধিত" },
  date: { en: "Date", bn: "তারিখ" },
  amount: { en: "Amount", bn: "পরিমাণ" },
  mobile: { en: "Mobile", bn: "মোবাইল" },
  name: { en: "Name", bn: "নাম" },
  status: { en: "Status", bn: "স্ট্যাটাস" },
  details: { en: "Details", bn: "বিস্তারিত" },
  yes: { en: "Yes", bn: "হ্যাঁ" },
  no: { en: "No", bn: "না" },
  confirm: { en: "Confirm", bn: "নিশ্চিত করুন" },
  ok: { en: "OK", bn: "ঠিক আছে" },
} as const;

type I18nValue = {
  t: (key: TKey) => string;
  lang: Lang;
  setLang: (lang: Lang) => void;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>("bn");
  useEffect(() => {
    const l = localStorage.getItem("derp.lang") as Lang | null;
    if (l === "en" || l === "bn") setLang(l);
    else {
      const b = navigator.language?.startsWith("bn");
      setLang(b ? "bn" : "en");
    }
  }, []);
  const set = (l: Lang) => {
    setLang(l);
    localStorage.setItem("derp.lang", l);
  };
  const t = (k: TKey) => dict[k]?.[lang] ?? dict[k]?.en ?? k;
  return <I18nContext.Provider value={{ t, lang, setLang: set }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}
