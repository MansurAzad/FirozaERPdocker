export const ACCESS_MODULES = [
  { key: "dashboard", label: "Dashboard" },
  { key: "guardian", label: "Owner Guardian" },
  { key: "branches", label: "Shops & branches" },
  { key: "products", label: "Products" },
  { key: "brands", label: "Brands" },
  { key: "categories", label: "Categories" },
  { key: "sales", label: "Sales" },
  { key: "quotations", label: "Quotations" },
  { key: "orders", label: "Orders" },
  { key: "courier", label: "Courier" },
  { key: "emi", label: "EMI" },
  { key: "due_collection", label: "Due collection" },
  { key: "customers", label: "Customers" },
  { key: "customer_portal", label: "Customer portal" },
  { key: "suppliers", label: "Suppliers" },
  { key: "ledger", label: "Ledgers" },
  { key: "purchases", label: "Purchases" },
  { key: "purchase_orders", label: "Purchase orders" },
  { key: "purchase_returns", label: "Purchase returns" },
  { key: "inventory", label: "Inventory" },
  { key: "stock_adjustments", label: "Stock adjustments" },
  { key: "reorder", label: "Reorder" },
  { key: "labels", label: "Labels" },
  { key: "bulk_price", label: "Bulk pricing" },
  { key: "imei", label: "IMEI" },
  { key: "transfers", label: "Stock transfers" },
  { key: "service", label: "Service" },
  { key: "warranty", label: "Warranty" },
  { key: "supplier_payments", label: "Supplier payments" },
  { key: "cash_bank", label: "Cash & bank" },
  { key: "bank_reconciliation", label: "Bank reconciliation" },
  { key: "expenses", label: "Expenses" },
  { key: "closing", label: "Daily closing" },
  { key: "accounting", label: "Accounting" },
  { key: "reports", label: "Reports" },
  { key: "supplier_aging", label: "Supplier aging" },
  { key: "dead_slow_stock", label: "Dead & slow stock" },
  { key: "tasks", label: "Tasks" },
  { key: "commission", label: "Commission" },
  { key: "dealers", label: "Dealers" },
  { key: "company_profile", label: "Company profile" },
  { key: "daily_reports", label: "Daily reports" },
  { key: "team", label: "Users & access" },
  { key: "audit", label: "Audit log" },
  { key: "attachments", label: "Attachments" },
  { key: "sync_history", label: "Offline sync history" },
  { key: "usage", label: "Usage" },
  { key: "backup", label: "Backup & restore" },
  { key: "guide", label: "Guide" },
] as const;

export const ACCESS_ACTIONS = [
  { key: "view", label: "View" },
  { key: "create", label: "Create" },
  { key: "edit", label: "Edit" },
  { key: "delete", label: "Delete" },
  { key: "approve", label: "Approve" },
  { key: "export", label: "Export" },
] as const;

export type AccessModule = (typeof ACCESS_MODULES)[number]["key"];
export type AccessAction = (typeof ACCESS_ACTIONS)[number]["key"];
export type AccessMatrix = Partial<Record<AccessModule, Partial<Record<AccessAction, boolean>>>>;

const ROUTES: readonly [string, AccessModule][] = [
  ["/app/guardian-anomalies", "guardian"],
  ["/app/guardian-chat", "guardian"],
  ["/app/guardian-owner", "guardian"],
  ["/app/stock-adjustments", "stock_adjustments"],
  ["/app/purchase-returns", "purchase_returns"],
  ["/app/purchase-orders", "purchase_orders"],
  ["/app/supplier-payments", "supplier_payments"],
  ["/app/supplier-aging", "supplier_aging"],
  ["/app/dead-slow-stock", "dead_slow_stock"],
  ["/app/bank-reconciliation", "bank_reconciliation"],
  ["/app/customer-portal", "customer_portal"],
  ["/app/daily-reports", "daily_reports"],
  ["/app/due-collection", "due_collection"],
  ["/app/brand-shops", "branches"],
  ["/app/company-profile", "company_profile"],
  ["/app/sync-history", "sync_history"],
  ["/app/access-control", "team"],
  ["/app/quotations", "quotations"],
  ["/app/purchases", "purchases"],
  ["/app/branches", "branches"],
  ["/app/products", "products"],
  ["/app/categories", "categories"],
  ["/app/customers", "customers"],
  ["/app/suppliers", "suppliers"],
  ["/app/accounting", "accounting"],
  ["/app/money", "cash_bank"],
  ["/app/commission", "commission"],
  ["/app/transfers", "transfers"],
  ["/app/sales", "sales"],
  ["/app/expenses", "expenses"],
  ["/app/reports", "reports"],
  ["/app/guardian", "guardian"],
  ["/app/closing", "closing"],
  ["/app/stock", "inventory"],
  ["/app/reorder", "reorder"],
  ["/app/labels", "labels"],
  ["/app/bulk-price", "bulk_price"],
  ["/app/imei", "imei"],
  ["/app/service", "service"],
  ["/app/warranty", "warranty"],
  ["/app/ledger", "ledger"],
  ["/app/orders", "orders"],
  ["/app/courier", "courier"],
  ["/app/dealers", "dealers"],
  ["/app/backup", "backup"],
  ["/app/audit", "audit"],
  ["/app/usage", "usage"],
  ["/app/tasks", "tasks"],
  ["/app/team", "team"],
  ["/app/emi", "emi"],
  ["/app/brands", "brands"],
  ["/app/guide", "guide"],
];

export function moduleForPath(pathname: string): AccessModule | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/app") return "dashboard";
  return ROUTES.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1] ?? null;
}

export function hasAccess(
  access: AccessMatrix | null | undefined,
  module: AccessModule | null,
  action: AccessAction = "view",
) {
  return module !== null && access?.[module]?.[action] === true;
}

export function fullAccessMatrix(): AccessMatrix {
  return Object.fromEntries(
    ACCESS_MODULES.map(({ key }) => [
      key,
      Object.fromEntries(ACCESS_ACTIONS.map(({ key: action }) => [action, true])),
    ]),
  ) as AccessMatrix;
}
