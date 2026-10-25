import { generateId } from "./uuid";

export type LegacyArchiveRecord = Record<string, string>;

export type LegacyArchiveFile = {
  source_file: string;
  sha256: string;
  source_bytes: number;
  columns: string[];
  row_count: number;
  records: LegacyArchiveRecord[];
};

export type LegacyArchive = {
  format: "legacy-csv-json-archive";
  format_version: 1;
  restore_compatible: false;
  source_file_count: number;
  total_record_count: number;
  files: LegacyArchiveFile[];
};

export type LegacyArchiveManifestFile = {
  source_file: string;
  sha256: string;
  row_count: number;
  source_bytes: number;
};

export type LegacyArchiveManifest = LegacyArchiveManifestFile[];

export type LegacyArchiveSourcePreview = {
  fileCount: number;
  sourceRecordCount: number;
  voucherReferences: number;
  balancedVoucherReferences: number;
  unbalancedVoucherReferences: number;
  duplicateBillRows: number;
  missingPartyMobile: number;
  productsWithoutCategory: number;
  productsWithoutManufacturer: number;
  placeholderOpeningRows: number;
  negativeClosingRows: number;
  unusableFiles: string[];
};

export type LegacyOperationalPreview = {
  branches: number;
  accounts: number;
  customers: number;
  suppliers: number;
  products: number;
  sales: number;
  saleItems: number;
  purchases: number;
  purchaseItems: number;
  vouchers: number;
  inventoryMovements: number;
  unlinkedSalesReturns: number;
  inventorySnapshotMismatches: number;
};

export type CurrentDataPreview = {
  customers: number;
  dealers: number;
  suppliers: number;
  products: number;
  stockItems: number;
  customerDue: number;
  supplierPayable: number;
  openingJournals: number;
  imeis: number;
};

type LegacyJson = string | number | boolean | null | LegacyJson[] | { [key: string]: LegacyJson };

export type LegacyOperationalBackup = {
  app: "MOBILE D-ERP";
  version: 1;
  business_id: string;
  legacy_csv_import: true;
  exported_at: string;
  tables: LegacyOperationalTables;
};

const MAX_FILES = 54;
const MAX_RECORDS = 50_000;
const SHA256 = /^[0-9a-f]{64}$/;
const UNUSABLE_FILES = new Set([
  "03_Ledger_Groups.csv",
  "17_Trial_Balance.csv",
  "27_Monthly_Summary.csv",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseLegacyArchive(value: unknown): LegacyArchive {
  if (
    !isRecord(value) ||
    value["format"] !== "legacy-csv-json-archive" ||
    value["format_version"] !== 1 ||
    value["restore_compatible"] !== false ||
    !Array.isArray(value["files"]) ||
    value["files"].length < 1 ||
    value["files"].length > MAX_FILES
  ) {
    throw new Error("Choose the prepared company data archive, not an app backup.");
  }

  const files: LegacyArchiveFile[] = [];
  const names = new Set<string>();
  let total = 0;

  for (const candidate of value["files"]) {
    if (!isRecord(candidate)) {
      throw new Error("The archive contains an invalid or duplicate CSV file entry.");
    }
    const sourceFile = candidate["source_file"];
    const sourceHash = candidate["sha256"];
    const sourceBytes = candidate["source_bytes"];
    const candidateColumns = candidate["columns"];
    const candidateRecords = candidate["records"];
    const rowCount = candidate["row_count"];
    if (
      typeof sourceFile !== "string" ||
      !sourceFile ||
      names.has(sourceFile) ||
      typeof sourceHash !== "string" ||
      !SHA256.test(sourceHash) ||
      typeof sourceBytes !== "number" ||
      !Number.isSafeInteger(sourceBytes) ||
      sourceBytes < 0 ||
      !Array.isArray(candidateColumns) ||
      !candidateColumns.every((column) => typeof column === "string") ||
      !Array.isArray(candidateRecords) ||
      typeof rowCount !== "number" ||
      !Number.isSafeInteger(rowCount) ||
      rowCount !== candidateRecords.length
    ) {
      throw new Error("The archive contains an invalid or duplicate CSV file entry.");
    }

    const columns = candidateColumns as string[];
    const records: LegacyArchiveRecord[] = candidateRecords.map((row) => {
      if (
        !isRecord(row) ||
        !columns.every((column) => typeof row[column] === "string") ||
        Object.keys(row).some((key) => !columns.includes(key))
      ) {
        throw new Error(`A row in ${sourceFile} does not match its CSV columns.`);
      }
      return row as LegacyArchiveRecord;
    });

    names.add(sourceFile);
    total += records.length;
    if (total > MAX_RECORDS) throw new Error("The archive exceeds the 50,000-row safety limit.");
    files.push({
      source_file: sourceFile,
      sha256: sourceHash,
      source_bytes: sourceBytes,
      columns,
      row_count: records.length,
      records,
    });
  }

  if (value["source_file_count"] !== files.length || value["total_record_count"] !== total) {
    throw new Error("The archive totals do not match its contents.");
  }

  return {
    format: "legacy-csv-json-archive",
    format_version: 1,
    restore_compatible: false,
    source_file_count: files.length,
    total_record_count: total,
    files,
  };
}

async function sha256(text: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createLegacyArchiveManifest(
  archive: LegacyArchive,
): Promise<{ digest: string; files: LegacyArchiveManifest }> {
  const files: LegacyArchiveManifest = [];
  for (const file of archive.files) {
    const encodedRows = file.records
      .map((record) => file.columns.map((column) => record[column] ?? "").join("\u001f"))
      .join("\n");
    files.push({
      source_file: file.source_file,
      sha256: await sha256(encodedRows),
      row_count: file.row_count,
      source_bytes: file.source_bytes,
    });
  }
  const digestSource = files
    .map((file) => `${file.source_file}\u001f${file.sha256}\u001f${file.row_count}`)
    .sort()
    .join("\n");
  return { digest: await sha256(digestSource), files };
}

function amountInCents(value: string | undefined): number {
  const normalized = (value ?? "").trim().replace(/,/g, "");
  if (!normalized || normalized === "NULL" || normalized === ".00") return 0;
  const match = /^(-?)(\d+)?(?:\.(\d{0,}))?$/.exec(normalized);
  if (!match) return Number.NaN;
  const whole = Number(match[2] || "0");
  const fraction = (match[3] || "").padEnd(2, "0");
  if (fraction.length > 2 && Number(fraction[2]) >= 5) {
    return (match[1] ? -1 : 1) * (whole * 100 + Number(fraction.slice(0, 2)) + 1);
  }
  return (match[1] ? -1 : 1) * (whole * 100 + Number(fraction.slice(0, 2) || "0"));
}

function fileByName(archive: LegacyArchive, name: string): LegacyArchiveFile | undefined {
  return archive.files.find((file) => file.source_file === name);
}

function rowsByName(archive: LegacyArchive, name: string): LegacyArchiveRecord[] {
  const file = fileByName(archive, name);
  if (!file) throw new Error(`The archive is missing required source file ${name}.`);
  return file.records;
}

function cents(value: string | undefined, field: string): number {
  const result = amountInCents(value);
  if (!Number.isSafeInteger(result)) throw new Error(`Invalid amount in ${field}.`);
  return result;
}

function quantity(value: string | undefined, field: string): number {
  const normalized = (value ?? "").trim().replace(/,/g, "");
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive whole-number quantity in ${field}.`);
  }
  return parsed;
}

function movementQuantity(value: string | undefined): number {
  const normalized = (value ?? "").trim().replace(/,/g, "");
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed === 0) {
    throw new Error("Invalid non-zero whole-number quantity in inventory movement.");
  }
  return Math.abs(parsed);
}

function sourceDate(value: string | undefined, field: string): string {
  const date = (value ?? "").trim().slice(0, 10);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`Invalid date in ${field}.`);
  }
  return date;
}

function generatedMobile(index: number, used: Set<string>): string {
  let sequence = index;
  while (sequence <= 99_999_999) {
    const mobile = `013${String(sequence).padStart(8, "0")}`;
    if (!used.has(mobile)) {
      used.add(mobile);
      return mobile;
    }
    sequence += 1;
  }
  throw new Error("Could not generate a unique placeholder mobile number.");
}

function sourceMobile(value: string | undefined, index: number, used: Set<string>): string {
  const normalized = (value ?? "").trim();
  if (/^01[3-9]\d{8}$/.test(normalized) && !used.has(normalized)) {
    used.add(normalized);
    return normalized;
  }
  return generatedMobile(index, used);
}

function accountType(group: string): "asset" | "liability" | "equity" | "revenue" | "expense" {
  const normalized = group.toLowerCase();
  if (
    normalized.includes("creditor") ||
    normalized.includes("liabilit") ||
    normalized.includes("loan")
  )
    return "liability";
  if (normalized.includes("income") || normalized.includes("sales account")) return "revenue";
  if (normalized.includes("expense") || normalized.includes("purchase account")) return "expense";
  if (
    normalized.includes("profit") ||
    normalized.includes("capital") ||
    normalized.includes("equity")
  )
    return "equity";
  return "asset";
}

function clean(value: string | undefined): string {
  const normalized = (value ?? "").trim();
  return !normalized || normalized.toUpperCase() === "NULL" ? "" : normalized;
}

function id(): string {
  return generateId();
}

const SYSTEM_ACCOUNTS = [
  ["1010", "Cash", "asset"],
  ["1020", "Bank", "asset"],
  ["1030", "Mobile Banking (bKash/Nagad/Rocket)", "asset"],
  ["1100", "Customer Due (Receivable)", "asset"],
  ["1200", "Inventory", "asset"],
  ["2010", "Supplier Due (Payable)", "liability"],
  ["2100", "VAT / Tax Payable", "liability"],
  ["3020", "Opening Balance Equity", "equity"],
  ["4010", "Mobile Sales", "revenue"],
  ["4020", "Accessories Sales", "revenue"],
  ["4090", "Sales Discount", "revenue"],
  ["5010", "Cost of Goods Sold", "expense"],
] as const;

const OPERATIONAL_TABLE_NAMES = [
  "branches",
  "brands",
  "categories",
  "accounts",
  "products",
  "product_variants",
  "customers",
  "suppliers",
  "money_accounts",
  "expense_categories",
  "commission_rules",
  "journal_entries",
  "journal_lines",
  "money_transactions",
  "purchases",
  "purchase_items",
  "product_imeis",
  "sales",
  "sale_items",
  "customer_payments",
  "supplier_payments",
  "expenses",
  "sales_returns",
  "sales_return_items",
  "purchase_returns",
  "purchase_return_items",
  "stock",
  "stock_movements",
  "stock_transfers",
  "stock_transfer_items",
  "warranty_claims",
  "daily_closings",
  "guardian_alerts",
  "guardian_runs",
  "salesmen",
] as const;

type OperationalTableName = (typeof OPERATIONAL_TABLE_NAMES)[number];
type LegacyOperationalRow = { [key: string]: LegacyJson };
type LegacyOperationalTables = Record<OperationalTableName, LegacyOperationalRow[]>;

function emptyOperationalTables(): LegacyOperationalTables {
  return {
    branches: [],
    brands: [],
    categories: [],
    accounts: [],
    products: [],
    product_variants: [],
    customers: [],
    suppliers: [],
    money_accounts: [],
    expense_categories: [],
    commission_rules: [],
    journal_entries: [],
    journal_lines: [],
    money_transactions: [],
    purchases: [],
    purchase_items: [],
    product_imeis: [],
    sales: [],
    sale_items: [],
    customer_payments: [],
    supplier_payments: [],
    expenses: [],
    sales_returns: [],
    sales_return_items: [],
    purchase_returns: [],
    purchase_return_items: [],
    stock: [],
    stock_movements: [],
    stock_transfers: [],
    stock_transfer_items: [],
    warranty_claims: [],
    daily_closings: [],
    guardian_alerts: [],
    guardian_runs: [],
    salesmen: [],
  };
}

export function createLegacyOperationalBackup(
  archive: LegacyArchive,
  businessId: string,
  createdBy: string,
): { backup: LegacyOperationalBackup; preview: LegacyOperationalPreview } {
  if (
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(businessId) ||
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(createdBy)
  ) {
    throw new Error("A valid target business and signed-in owner are required.");
  }

  const tables = emptyOperationalTables();
  const branchId = id();
  tables["branches"].push({
    id: branchId,
    business_id: businessId,
    name: "Head Office",
    kind: "head",
    status: "active",
  });

  const systemAccountIds = new Map<string, string>();
  for (const [code, name, type] of SYSTEM_ACCOUNTS) {
    const accountId = id();
    systemAccountIds.set(code, accountId);
    tables["accounts"].push({
      id: accountId,
      business_id: businessId,
      code,
      name,
      type,
      is_system: true,
    });
  }

  const parties = rowsByName(archive, "02_Ledger_Party.csv");
  const partyAccountIds = new Map<string, string>();
  const customerIds = new Map<string, string>();
  const supplierIds = new Map<string, string>();
  const usedCustomerMobiles = new Set<string>();
  const usedSupplierMobiles = new Set<string>();
  const uniquePartyNames = new Set<string>();
  let placeholderMobileIndex = 1;
  let placeholderSupplierMobileIndex = 50_001;

  for (const party of parties) {
    const name = clean(party["LEDGER_NAME"]);
    const parent = clean(party["LEDGER_PARENT_GROUP"]);
    if (!name || uniquePartyNames.has(name.toLocaleLowerCase())) {
      throw new Error("The ledger export contains a blank or duplicate party name.");
    }
    uniquePartyNames.add(name.toLocaleLowerCase());
    const accountId = id();
    const isCustomer = parent === "Sundry Debtors";
    const isSupplier = parent === "Sundry Creditors";
    const isCashLedger = parent === "Cash in Hand";
    const isBankLedger = parent === "Bank Accounts";
    const isMobileLedger = /mobile|bkash|nagad|rocket/i.test(name);
    const isControlAccount =
      isCustomer || isSupplier || isCashLedger || isBankLedger || isMobileLedger;
    const mobileSet = isSupplier ? usedSupplierMobiles : usedCustomerMobiles;
    const mobile = isSupplier
      ? sourceMobile(party["LEDGER_MOBILE"], placeholderSupplierMobileIndex++, mobileSet)
      : sourceMobile(party["LEDGER_MOBILE"], placeholderMobileIndex++, mobileSet);
    const entityId = isCustomer || isSupplier ? id() : undefined;
    const sourceAccountId = isCustomer
      ? systemAccountIds.get("1100")!
      : isSupplier
        ? systemAccountIds.get("2010")!
        : isCashLedger
          ? systemAccountIds.get("1010")!
          : isBankLedger
            ? systemAccountIds.get("1020")!
            : isMobileLedger
              ? systemAccountIds.get("1030")!
              : accountId;

    partyAccountIds.set(name.toLocaleLowerCase(), sourceAccountId);
    if (!isControlAccount) {
      tables["accounts"].push({
        id: accountId,
        business_id: businessId,
        code: `LEG-${String(tables["accounts"].length).padStart(5, "0")}`,
        name: name.slice(0, 120),
        type: accountType(parent || clean(party["LEDGER_PRIMARY_GROUP"])),
        is_system: false,
      });
    }
    if (isCustomer && entityId) {
      customerIds.set(name.toLocaleLowerCase(), entityId);
      tables["customers"].push({
        id: entityId,
        business_id: businessId,
        name: name.slice(0, 120),
        mobile,
        address: [party["LEDGER_ADDRESS1"], party["LEDGER_ADDRESS2"], party["LEDGER_CITY"]]
          .map(clean)
          .filter(Boolean)
          .join(", ")
          .slice(0, 500),
        opening_balance: cents(party["LEDGER_OPENING_BALANCE"], "LEDGER_OPENING_BALANCE") / 100,
        credit_limit: Math.max(0, cents(party["LEDGER_CREDIT_LIMIT"], "LEDGER_CREDIT_LIMIT") / 100),
        status: "active",
        notes:
          "Imported from legacy CSV. Generated mobile is a placeholder where source mobile was missing or invalid.",
      });
    }
    if (isSupplier && entityId) {
      supplierIds.set(name.toLocaleLowerCase(), entityId);
      tables["suppliers"].push({
        id: entityId,
        business_id: businessId,
        name: name.slice(0, 120),
        mobile,
        address: [party["LEDGER_ADDRESS1"], party["LEDGER_ADDRESS2"], party["LEDGER_CITY"]]
          .map(clean)
          .filter(Boolean)
          .join(", ")
          .slice(0, 500),
        opening_payable: Math.abs(
          cents(party["LEDGER_OPENING_BALANCE"], "LEDGER_OPENING_BALANCE") / 100,
        ),
        status: "active",
        notes:
          "Imported from legacy CSV. Generated mobile is a placeholder where source mobile was missing or invalid.",
      });
    }
  }

  const stockItems = rowsByName(archive, "09_Stock_Items.csv");
  const inventoryRows = rowsByName(archive, "13_Inventory_Transactions.csv");
  const inboundCosts = new Map<string, { valueCents: number; qty: number }>();
  for (const row of inventoryRows) {
    if (clean(row["INV_VOUCHER_TYPE"]) === "0" || clean(row["INV_INOUT_FLAG"]) !== "I") continue;
    const itemKey = clean(row["STOCKITEM_NAME"]).toLocaleLowerCase();
    const qty = movementQuantity(row["INV_TRAN_QUANTITY"]);
    const valueCents = cents(row["INV_TRAN_RATE"], "INV_TRAN_RATE") * qty;
    const current = inboundCosts.get(itemKey) ?? { valueCents: 0, qty: 0 };
    current.valueCents += valueCents;
    current.qty += qty;
    inboundCosts.set(itemKey, current);
  }
  const categoryId = id();
  tables["categories"].push({
    id: categoryId,
    business_id: businessId,
    name: "Legacy import - category not provided",
    is_serialized: false,
  });
  const brandIds = new Map<string, string>();
  const productIds = new Map<string, string>();
  const variantIds = new Map<string, string>();
  for (const [index, item] of stockItems.entries()) {
    const name = clean(item["STOCKITEM_NAME"]);
    if (!name || productIds.has(name.toLocaleLowerCase())) {
      throw new Error("The stock export contains a blank or duplicate item name.");
    }
    const manufacturer = clean(item["STOCKITEM_MANUFACTURER"]);
    const sourceGroup = clean(item["STOCKGROUP_NAME"]) || "unclassified";
    const brandName = manufacturer || `Legacy source group: ${sourceGroup}`;
    let brandId = brandIds.get(brandName.toLocaleLowerCase());
    if (!brandId) {
      brandId = id();
      brandIds.set(brandName.toLocaleLowerCase(), brandId);
      tables["brands"].push({
        id: brandId,
        business_id: businessId,
        name: brandName.slice(0, 120),
      });
    }
    const productId = id();
    const variantId = id();
    productIds.set(name.toLocaleLowerCase(), productId);
    variantIds.set(name.toLocaleLowerCase(), variantId);
    tables["products"].push({
      id: productId,
      business_id: businessId,
      brand_id: brandId,
      category_id: categoryId,
      model: name.slice(0, 120),
      status: "inactive",
    });
    const openingRateCents = Math.max(
      0,
      cents(item["STOCKITEM_OPENING_RATE"], "STOCKITEM_OPENING_RATE"),
    );
    const openingQty = Number(clean(item["STOCKITEM_OPENING_BALANCE"]).replace(/,/g, "") || "0");
    const inbound = inboundCosts.get(name.toLocaleLowerCase()) ?? { valueCents: 0, qty: 0 };
    const averageCost =
      inbound.qty + Math.max(0, openingQty) > 0
        ? Math.round(
            (inbound.valueCents + openingRateCents * Math.max(0, openingQty)) /
              (inbound.qty + Math.max(0, openingQty)),
          ) / 100
        : openingRateCents / 100;
    tables["product_variants"].push({
      id: variantId,
      business_id: businessId,
      product_id: productId,
      sku: `LEGACY-${String(index + 1).padStart(5, "0")}`,
      purchase_price: averageCost,
      wholesale_price: 0,
      dealer_price: 0,
      retail_price: 0,
      min_price: 0,
      reorder_level: Math.max(0, Math.trunc(Number(item["STOCKITEM_REORDER_LEVEL"]) || 0)),
      warranty_months: 0,
      status: "inactive",
    });
    const sourceClosing = Number(clean(item["STOCKITEM_CLOSING_BALANCE"]).replace(/,/g, "") || "0");
    if (!Number.isFinite(sourceClosing)) throw new Error(`Invalid closing quantity for ${name}.`);
    tables["stock"].push({
      business_id: businessId,
      branch_id: branchId,
      variant_id: variantId,
      qty: sourceClosing < 0 ? 0 : Math.trunc(sourceClosing),
      avg_cost: averageCost,
    });
  }

  const headers = rowsByName(archive, "05_Company_Voucher.csv");
  const headerByRef = new Map<string, LegacyArchiveRecord>();
  for (const header of headers) {
    const ref = clean(header["COMP_REF_NO"]);
    if (!ref || headerByRef.has(ref))
      throw new Error("Voucher headers contain a blank or duplicate reference.");
    headerByRef.set(ref, header);
  }

  const voucherLines = rowsByName(archive, "04_All_Vouchers.csv");
  const voucherGroups = new Map<string, LegacyArchiveRecord[]>();
  const voucherTypes = new Map<string, string>();
  for (const line of voucherLines) {
    const ref = clean(line["COMP_REF_NO"]);
    const type = clean(line["COMP_VOUCHER_TYPE"]);
    if (!ref || !headerByRef.has(ref))
      throw new Error("A voucher line has no matching source voucher header.");
    const knownType = voucherTypes.get(ref);
    if (knownType && knownType !== type) throw new Error(`Voucher ${ref} has inconsistent types.`);
    voucherTypes.set(ref, type);
    const group = voucherGroups.get(ref) ?? [];
    group.push(line);
    voucherGroups.set(ref, group);
  }
  if (headerByRef.size !== voucherGroups.size)
    throw new Error("Voucher headers and ledger lines do not reconcile.");

  const openingReference = id();
  const moneyAccountKind = new Map<string, "cash" | "bank" | "mfs">();
  for (const party of parties) {
    const name = clean(party["LEDGER_NAME"]).toLocaleLowerCase();
    const parent = clean(party["LEDGER_PARENT_GROUP"]);
    if (parent === "Cash in Hand") moneyAccountKind.set(name, "cash");
    if (parent === "Bank Accounts") {
      moneyAccountKind.set(name, /mobile|bkash|nagad|rocket/i.test(name) ? "mfs" : "bank");
    }
  }
  const cashVoucherLines = (ref: string, amountField: string) =>
    (voucherGroups.get(ref) ?? []).filter(
      (line) =>
        moneyAccountKind.has(clean(line["LEDGER_NAME"]).toLocaleLowerCase()) &&
        cents(line[amountField], amountField) > 0,
    );

  for (const party of parties.filter(
    (row) => clean(row["LEDGER_PARENT_GROUP"]) === "Sales Representative",
  )) {
    const name = clean(party["LEDGER_NAME"]);
    tables["salesmen"].push({
      id: id(),
      business_id: businessId,
      name: name.slice(0, 120),
      mobile: clean(party["LEDGER_MOBILE"]) || null,
      address:
        [party["LEDGER_ADDRESS1"], party["LEDGER_ADDRESS2"], party["LEDGER_CITY"]]
          .map(clean)
          .filter(Boolean)
          .join(", ")
          .slice(0, 500) || null,
      join_date: "2025-07-01",
      status: "active",
      created_by: createdBy,
    });
  }

  const saleRows = rowsByName(archive, "06_Bill_Transactions.csv");
  const saleBills = new Map<string, LegacyArchiveRecord[]>();
  const purchaseBills = new Map<string, LegacyArchiveRecord[]>();
  for (const bill of saleRows) {
    const ref = clean(bill["COMP_REF_NO"]);
    const type = clean(bill["COMP_VOUCHER_TYPE"]);
    if (!headerByRef.has(ref)) throw new Error("A bill row has no matching source voucher header.");
    if (type !== "16" && type !== "33") continue;
    if (!variantIds.has(clean(bill["STOCKITEM_NAME"]).toLocaleLowerCase())) {
      throw new Error("A bill row references a stock item missing from the stock export.");
    }
    const target = type === "16" ? saleBills : purchaseBills;
    const group = target.get(ref) ?? [];
    group.push(bill);
    target.set(ref, group);
  }

  const saleIds = new Map<string, string>();
  const purchaseIds = new Map<string, string>();
  const saleCustomerNames = new Map<string, string>();
  const salesTotalByCustomer = new Map<string, number>();
  const purchaseTotalBySupplier = new Map<string, number>();
  const inventoryCostByRefItem = new Map<string, number>();
  for (const row of inventoryRows) {
    const ref = clean(row["INV_REF_NO"]);
    const item = clean(row["STOCKITEM_NAME"]).toLocaleLowerCase();
    const costs = cents(row["OUTWARD_COST_AMOUNT"], "OUTWARD_COST_AMOUNT");
    const key = `${ref}\u001f${item}`;
    inventoryCostByRefItem.set(key, (inventoryCostByRefItem.get(key) ?? 0) + costs);
  }

  for (const [ref, bills] of saleBills) {
    const header = headerByRef.get(ref)!;
    let customerName = clean(
      header["COMP_VOUCHER_PARTY_NAME"] || header["LEDGER_NAME"],
    ).toLocaleLowerCase();
    let customerId = customerIds.get(customerName) ?? null;
    if (!customerId) {
      const voucherPartyLine = voucherGroups
        .get(ref)
        ?.find((line) => customerIds.has(clean(line["LEDGER_NAME"]).toLocaleLowerCase()));
      if (voucherPartyLine) {
        customerName = clean(voucherPartyLine["LEDGER_NAME"]).toLocaleLowerCase();
        customerId = customerIds.get(customerName) ?? null;
      }
    }
    if (customerId) saleCustomerNames.set(ref, customerName);
    const saleId = id();
    saleIds.set(ref, saleId);
    const paidCents = cashVoucherLines(ref, "VOUCHER_DEBIT_AMOUNT").reduce(
      (sum, line) => sum + cents(line["VOUCHER_DEBIT_AMOUNT"], "VOUCHER_DEBIT_AMOUNT"),
      0,
    );
    let subtotalCents = 0;
    let cogsCents = 0;
    const items = bills.map((bill) => {
      const itemName = clean(bill["STOCKITEM_NAME"]);
      const itemKey = itemName.toLocaleLowerCase();
      const qty = quantity(bill["BILL_QUANTITY"], "BILL_QUANTITY");
      const lineCents = cents(bill["BILL_NET_AMOUNT"], "BILL_NET_AMOUNT");
      const rateCents = cents(bill["BILL_RATE"], "BILL_RATE");
      const costCents = Math.abs(inventoryCostByRefItem.get(`${ref}\u001f${itemKey}`) ?? 0);
      subtotalCents += lineCents;
      cogsCents += costCents;
      return {
        id: id(),
        business_id: businessId,
        sale_id: saleId,
        variant_id: variantIds.get(itemKey)!,
        qty,
        price: rateCents / 100,
        line_total: lineCents / 100,
        unit_cost: qty ? costCents / 100 / qty : 0,
        warranty_months: 0,
      };
    });
    const total = subtotalCents / 100;
    if (paidCents > subtotalCents) {
      throw new Error(`Sale ${ref} has cash settlement greater than its bill total.`);
    }
    tables["sales"].push({
      id: saleId,
      business_id: businessId,
      branch_id: branchId,
      customer_id: customerId,
      invoice_no: ref.slice(0, 120),
      sale_date: sourceDate(header["COMP_VOUCHER_DATE"], "COMP_VOUCHER_DATE"),
      price_level: "retail",
      subtotal: total,
      discount: 0,
      tax: 0,
      total,
      paid: paidCents / 100,
      due: (subtotalCents - paidCents) / 100,
      cogs: cogsCents / 100,
      status: "posted",
      notes: "Imported from legacy CSV; original voucher journal is retained.",
    });
    tables["sale_items"].push(...items);
    if (customerId)
      salesTotalByCustomer.set(
        customerName,
        (salesTotalByCustomer.get(customerName) ?? 0) + subtotalCents,
      );
  }

  for (const [ref, bills] of purchaseBills) {
    const header = headerByRef.get(ref)!;
    const supplierName = clean(
      header["COMP_VOUCHER_PARTY_NAME"] || header["LEDGER_NAME"],
    ).toLocaleLowerCase();
    const supplierId = supplierIds.get(supplierName);
    if (!supplierId) throw new Error(`Purchase ${ref} does not map to an exported supplier.`);
    const purchaseId = id();
    purchaseIds.set(ref, purchaseId);
    const paidCents = cashVoucherLines(ref, "VOUCHER_CREDIT_AMOUNT").reduce(
      (sum, line) => sum + cents(line["VOUCHER_CREDIT_AMOUNT"], "VOUCHER_CREDIT_AMOUNT"),
      0,
    );
    let subtotalCents = 0;
    const items = bills.map((bill) => {
      const itemKey = clean(bill["STOCKITEM_NAME"]).toLocaleLowerCase();
      const qty = quantity(bill["BILL_QUANTITY"], "BILL_QUANTITY");
      const lineCents = cents(bill["BILL_NET_AMOUNT"], "BILL_NET_AMOUNT");
      const rateCents = cents(bill["BILL_RATE"], "BILL_RATE");
      subtotalCents += lineCents;
      return {
        id: id(),
        business_id: businessId,
        purchase_id: purchaseId,
        variant_id: variantIds.get(itemKey)!,
        qty,
        rate: rateCents / 100,
        line_total: lineCents / 100,
        landed_unit_cost: rateCents / 100,
      };
    });
    const total = subtotalCents / 100;
    if (paidCents > subtotalCents) {
      throw new Error(`Purchase ${ref} has cash settlement greater than its bill total.`);
    }
    tables["purchases"].push({
      id: purchaseId,
      business_id: businessId,
      branch_id: branchId,
      supplier_id: supplierId,
      invoice_no: ref.slice(0, 120),
      supplier_invoice_no: ref.slice(0, 120),
      purchase_date: sourceDate(header["COMP_VOUCHER_DATE"], "COMP_VOUCHER_DATE"),
      subtotal: total,
      discount: 0,
      tax: 0,
      total,
      paid: paidCents / 100,
      due: (subtotalCents - paidCents) / 100,
      status: "posted",
      notes: "Imported from legacy CSV; original voucher journal is retained.",
    });
    tables["purchase_items"].push(...items);
    purchaseTotalBySupplier.set(
      supplierName,
      (purchaseTotalBySupplier.get(supplierName) ?? 0) + subtotalCents,
    );
  }

  const journalIds = new Map<string, string>();
  for (const [ref, lines] of voucherGroups) {
    const header = headerByRef.get(ref)!;
    const journalId = id();
    journalIds.set(ref, journalId);
    const sourceType = voucherTypes.get(ref)!;
    tables["journal_entries"].push({
      id: journalId,
      business_id: businessId,
      entry_date: sourceDate(header["COMP_VOUCHER_DATE"], "COMP_VOUCHER_DATE"),
      ref_type: `legacy_voucher_${sourceType}`,
      ref_id: saleIds.get(ref) ?? purchaseIds.get(ref) ?? journalId,
      memo: clean(header["COMP_VOUCHER_NARRATION"]).slice(0, 500) || `Legacy voucher ${ref}`,
    });

    let debitCents = 0;
    let creditCents = 0;
    for (const line of lines) {
      const debit = cents(line["VOUCHER_DEBIT_AMOUNT"], "VOUCHER_DEBIT_AMOUNT");
      const credit = cents(line["VOUCHER_CREDIT_AMOUNT"], "VOUCHER_CREDIT_AMOUNT");
      if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
        if (debit === 0 && credit === 0) continue;
        throw new Error(`Voucher ${ref} contains a line with both debit and credit.`);
      }
      const ledgerName = clean(line["LEDGER_NAME"]).toLocaleLowerCase();
      const accountId = partyAccountIds.get(ledgerName);
      if (!accountId)
        throw new Error(`Voucher ${ref} references a ledger absent from the party export.`);
      debitCents += debit;
      creditCents += credit;
      tables["journal_lines"].push({
        business_id: businessId,
        entry_id: journalId,
        account_id: accountId,
        debit: debit / 100,
        credit: credit / 100,
      });
    }
    if (Math.abs(debitCents - creditCents) > 1) throw new Error(`Voucher ${ref} does not balance.`);
  }

  let openingDebits = 0;
  let openingCredits = 0;
  const openingLines: LegacyOperationalRow[] = [];
  for (const party of parties) {
    const ledgerName = clean(party["LEDGER_NAME"]).toLocaleLowerCase();
    const accountId = partyAccountIds.get(ledgerName);
    if (!accountId) throw new Error(`Opening balance has no mapped account for ${ledgerName}.`);
    const openingCents = cents(party["LEDGER_OPENING_BALANCE"], "LEDGER_OPENING_BALANCE");
    if (openingCents === 0) continue;
    const debit = openingCents < 0 ? Math.abs(openingCents) : 0;
    const credit = openingCents > 0 ? openingCents : 0;
    openingDebits += debit;
    openingCredits += credit;
    openingLines.push({
      business_id: businessId,
      entry_id: "",
      account_id: accountId,
      debit: debit / 100,
      credit: credit / 100,
    });
  }
  if (openingLines.length > 0) {
    const openingEquityId = systemAccountIds.get("3020")!;
    if (openingDebits > openingCredits) {
      openingLines.push({
        business_id: businessId,
        entry_id: "",
        account_id: openingEquityId,
        debit: 0,
        credit: (openingDebits - openingCredits) / 100,
      });
    } else if (openingCredits > openingDebits) {
      openingLines.push({
        business_id: businessId,
        entry_id: "",
        account_id: openingEquityId,
        debit: (openingCredits - openingDebits) / 100,
        credit: 0,
      });
    }
    const openingJournalId = id();
    tables["journal_entries"].push({
      id: openingJournalId,
      business_id: businessId,
      entry_date: "2025-07-01",
      ref_type: "legacy_opening",
      ref_id: openingReference,
      memo: "Opening balances imported from legacy ledger export",
    });
    tables["journal_lines"].push(
      ...openingLines.map((line) => ({ ...line, entry_id: openingJournalId })),
    );
  }

  const cashAccountId = id();
  const bankAccountId = id();
  const mobileAccountId = id();
  const cashLedgerId = systemAccountIds.get("1010")!;
  const bankLedgerId = systemAccountIds.get("1020")!;
  const mobileLedgerId = systemAccountIds.get("1030")!;
  const openingMoneyBalance = { cash: 0, bank: 0, mfs: 0 };
  for (const party of parties) {
    const kind = moneyAccountKind.get(clean(party["LEDGER_NAME"]).toLocaleLowerCase());
    if (kind) {
      openingMoneyBalance[kind] -= cents(party["LEDGER_OPENING_BALANCE"], "LEDGER_OPENING_BALANCE");
    }
  }
  tables["money_accounts"].push(
    {
      id: cashAccountId,
      business_id: businessId,
      kind: "cash",
      name: "Main Cash",
      branch_id: branchId,
      ledger_account_id: cashLedgerId,
      opening_balance: openingMoneyBalance.cash / 100,
    },
    {
      id: bankAccountId,
      business_id: businessId,
      kind: "bank",
      name: "Legacy Bank",
      branch_id: branchId,
      ledger_account_id: bankLedgerId,
      opening_balance: openingMoneyBalance.bank / 100,
    },
    {
      id: mobileAccountId,
      business_id: businessId,
      kind: "mfs",
      name: "Legacy Mobile Banking",
      branch_id: branchId,
      ledger_account_id: mobileLedgerId,
      opening_balance: openingMoneyBalance.mfs / 100,
    },
  );

  const paymentsByCustomer = new Map<string, number>();
  const paymentsBySupplier = new Map<string, number>();
  const moneyAccountByLedger = new Map<string, string>();
  for (const [ledgerName, kind] of moneyAccountKind) {
    moneyAccountByLedger.set(
      ledgerName,
      kind === "cash" ? cashAccountId : kind === "mfs" ? mobileAccountId : bankAccountId,
    );
  }
  const moneyTransactionsByVoucher = new Map<
    string,
    { id: string; accountId: string; amountCents: number; direction: "in" | "out" }[]
  >();
  for (const [ref, lines] of voucherGroups) {
    const journalId = journalIds.get(ref)!;
    const date = sourceDate(headerByRef.get(ref)?.["COMP_VOUCHER_DATE"], "COMP_VOUCHER_DATE");
    for (const line of lines) {
      const ledgerName = clean(line["LEDGER_NAME"]).toLocaleLowerCase();
      const accountId = moneyAccountByLedger.get(ledgerName);
      if (!accountId) continue;
      const debit = cents(line["VOUCHER_DEBIT_AMOUNT"], "VOUCHER_DEBIT_AMOUNT");
      const credit = cents(line["VOUCHER_CREDIT_AMOUNT"], "VOUCHER_CREDIT_AMOUNT");
      if (debit === 0 && credit === 0) continue;
      const direction = debit > 0 ? "in" : "out";
      const amountCents = debit > 0 ? debit : credit;
      const transactionId = id();
      tables["money_transactions"].push({
        id: transactionId,
        business_id: businessId,
        account_id: accountId,
        txn_date: date,
        direction,
        amount: amountCents / 100,
        kind: `legacy_voucher_${voucherTypes.get(ref)}`,
        method: "cash",
        txn_ref: ref.slice(0, 120),
        note: `Legacy voucher ${ref}`,
        ref_type: "legacy_voucher",
        ref_id: journalId,
        journal_entry_id: journalId,
      });
      const entries = moneyTransactionsByVoucher.get(ref) ?? [];
      entries.push({ id: transactionId, accountId, amountCents, direction });
      moneyTransactionsByVoucher.set(ref, entries);
    }
  }

  for (const [ref, lines] of voucherGroups) {
    const type = voucherTypes.get(ref);
    if (type !== "1" && type !== "2") continue;
    const journalId = journalIds.get(ref)!;
    const paymentPartyIds = type === "1" ? customerIds : supplierIds;
    const partySide = type === "1" ? "VOUCHER_CREDIT_AMOUNT" : "VOUCHER_DEBIT_AMOUNT";
    const customerLines = lines.filter(
      (line) =>
        paymentPartyIds.has(clean(line["LEDGER_NAME"]).toLocaleLowerCase()) &&
        cents(line[partySide], "payment amount") > 0,
    );
    const counterpartDirection = type === "1" ? "in" : "out";
    const counterpart = moneyTransactionsByVoucher
      .get(ref)
      ?.find((entry) => entry.direction === counterpartDirection);
    if (customerLines.length > 0 && !counterpart) {
      throw new Error(`Payment voucher ${ref} has no mapped cash or bank movement.`);
    }
    for (const line of customerLines) {
      const partyName = clean(line["LEDGER_NAME"]).toLocaleLowerCase();
      const amount = cents(
        line[type === "1" ? "VOUCHER_CREDIT_AMOUNT" : "VOUCHER_DEBIT_AMOUNT"],
        "payment amount",
      );
      const paymentId = id();
      const date = sourceDate(
        line["COMP_VOUCHER_DATE"] || headerByRef.get(ref)?.["COMP_VOUCHER_DATE"],
        "COMP_VOUCHER_DATE",
      );
      if (type === "1") {
        const customerId = customerIds.get(partyName);
        if (!customerId) continue;
        tables["customer_payments"].push({
          id: paymentId,
          business_id: businessId,
          customer_id: customerId,
          account_id: counterpart!.accountId,
          amount: amount / 100,
          method: "cash",
          txn_ref: ref.slice(0, 120),
          paid_on: date,
          notes: `Legacy voucher ${ref}`,
          money_txn_id: counterpart!.id,
          journal_entry_id: journalId,
        });
        paymentsByCustomer.set(partyName, (paymentsByCustomer.get(partyName) ?? 0) + amount);
      } else {
        const supplierId = supplierIds.get(partyName);
        if (!supplierId) continue;
        tables["supplier_payments"].push({
          id: paymentId,
          business_id: businessId,
          supplier_id: supplierId,
          amount: amount / 100,
          method: "cash",
          txn_ref: ref.slice(0, 120),
          paid_on: date,
          notes: `Legacy voucher ${ref}`,
          money_txn_id: counterpart!.id,
          journal_entry_id: journalId,
        });
        paymentsBySupplier.set(partyName, (paymentsBySupplier.get(partyName) ?? 0) + amount);
      }
    }
  }

  for (const [ref, saleId] of saleIds) {
    const sale = tables["sales"].find((row) => row["id"] === saleId);
    const customerId = sale?.["customer_id"];
    if (typeof customerId !== "string") continue;
    const header = headerByRef.get(ref)!;
    const partyName = saleCustomerNames.get(ref) ?? "";
    for (const movement of moneyTransactionsByVoucher.get(ref) ?? []) {
      if (movement.direction !== "in") continue;
      const paymentId = id();
      tables["customer_payments"].push({
        id: paymentId,
        business_id: businessId,
        customer_id: customerId,
        sale_id: saleId,
        account_id: movement.accountId,
        amount: movement.amountCents / 100,
        method: "cash",
        txn_ref: ref.slice(0, 120),
        paid_on: sourceDate(header["COMP_VOUCHER_DATE"], "COMP_VOUCHER_DATE"),
        notes: `Cash settlement imported from sale voucher ${ref}`,
        money_txn_id: movement.id,
        journal_entry_id: journalIds.get(ref)!,
      });
      paymentsByCustomer.set(
        partyName,
        (paymentsByCustomer.get(partyName) ?? 0) + movement.amountCents,
      );
    }
  }

  for (const [ref, purchaseId] of purchaseIds) {
    const purchase = tables["purchases"].find((row) => row["id"] === purchaseId);
    const supplierId = purchase?.["supplier_id"];
    if (typeof supplierId !== "string") continue;
    const header = headerByRef.get(ref)!;
    const partyName = clean(
      header["COMP_VOUCHER_PARTY_NAME"] || header["LEDGER_NAME"],
    ).toLocaleLowerCase();
    for (const movement of moneyTransactionsByVoucher.get(ref) ?? []) {
      if (movement.direction !== "out") continue;
      tables["supplier_payments"].push({
        id: id(),
        business_id: businessId,
        supplier_id: supplierId,
        purchase_id: purchaseId,
        branch_id: branchId,
        amount: movement.amountCents / 100,
        method: "cash",
        txn_ref: ref.slice(0, 120),
        paid_on: sourceDate(header["COMP_VOUCHER_DATE"], "COMP_VOUCHER_DATE"),
        notes: `Cash settlement imported from purchase voucher ${ref}`,
        money_txn_id: movement.id,
        journal_entry_id: journalIds.get(ref)!,
      });
      paymentsBySupplier.set(
        partyName,
        (paymentsBySupplier.get(partyName) ?? 0) + movement.amountCents,
      );
    }
  }

  const movementRows = inventoryRows.filter((row) => clean(row["INV_VOUCHER_TYPE"]) !== "0");
  const netMovementByItem = new Map<string, number>();
  for (const row of movementRows) {
    const itemKey = clean(row["STOCKITEM_NAME"]).toLocaleLowerCase();
    const movementQty = movementQuantity(row["INV_TRAN_QUANTITY"]);
    const flag = clean(row["INV_INOUT_FLAG"]);
    if (flag !== "I" && flag !== "O")
      throw new Error("An inventory movement has an unsupported direction.");
    const signedQty = flag === "I" ? movementQty : -movementQty;
    netMovementByItem.set(itemKey, (netMovementByItem.get(itemKey) ?? 0) + signedQty);
    const ref = clean(row["INV_REF_NO"]);
    const date = sourceDate(row["INV_DATE"], "INV_DATE");
    tables["stock_movements"].push({
      business_id: businessId,
      branch_id: branchId,
      variant_id: variantIds.get(itemKey)!,
      qty_change: signedQty,
      unit_cost: Math.abs(cents(row["INV_TRAN_RATE"], "INV_TRAN_RATE") / 100),
      ref_type: "legacy_inventory",
      ref_id: saleIds.get(ref) ?? purchaseIds.get(ref) ?? journalIds.get(ref) ?? openingReference,
      created_at: `${date}T00:00:00.000Z`,
    });
  }
  for (const item of stockItems) {
    const openingQty = Number(clean(item["STOCKITEM_OPENING_BALANCE"]).replace(/,/g, "") || "0");
    if (!Number.isFinite(openingQty) || !Number.isInteger(openingQty)) {
      throw new Error(`Invalid opening quantity for ${clean(item["STOCKITEM_NAME"])}.`);
    }
    const itemKey = clean(item["STOCKITEM_NAME"]).toLocaleLowerCase();
    netMovementByItem.set(itemKey, (netMovementByItem.get(itemKey) ?? 0) + openingQty);
    if (openingQty < 0) continue;
    if (openingQty === 0) continue;
    tables["stock_movements"].push({
      business_id: businessId,
      branch_id: branchId,
      variant_id: variantIds.get(clean(item["STOCKITEM_NAME"]).toLocaleLowerCase())!,
      qty_change: openingQty,
      unit_cost: Math.max(0, cents(item["STOCKITEM_OPENING_RATE"], "STOCKITEM_OPENING_RATE") / 100),
      ref_type: "legacy_opening",
      ref_id: openingReference,
      created_at: "2025-07-01T00:00:00.000Z",
    });
  }

  for (const party of parties) {
    const name = clean(party["LEDGER_NAME"]).toLocaleLowerCase();
    const closingCents = Math.abs(cents(party["LEDGER_CLOSING_BALANCE"], "LEDGER_CLOSING_BALANCE"));
    if (customerIds.has(name)) {
      const closingBalance = closingCents / 100;
      const openingBalance =
        closingBalance -
        (salesTotalByCustomer.get(name) ?? 0) / 100 +
        (paymentsByCustomer.get(name) ?? 0) / 100;
      const customer = tables["customers"].find((row) => row["id"] === customerIds.get(name));
      if (customer) {
        customer["opening_balance"] = openingBalance;
        customer["notes"] =
          "Legacy closing balance reconciled as the migration opening amount; original ledger transactions remain in journals.";
      }
    }
    if (supplierIds.has(name)) {
      const closingPayable = closingCents / 100;
      const openingPayable =
        closingPayable -
        (purchaseTotalBySupplier.get(name) ?? 0) / 100 +
        (paymentsBySupplier.get(name) ?? 0) / 100;
      const supplier = tables["suppliers"].find((row) => row["id"] === supplierIds.get(name));
      if (supplier) {
        supplier["opening_payable"] = openingPayable;
        supplier["notes"] =
          "Legacy closing balance reconciled as the migration opening amount; original ledger transactions remain in journals.";
      }
    }
  }

  const unlinkedSalesReturns = headers.filter(
    (header) => clean(header["COMP_VOUCHER_TYPE"]) === "13",
  ).length;
  const inventorySnapshotMismatches = stockItems.filter((item) => {
    const itemKey = clean(item["STOCKITEM_NAME"]).toLocaleLowerCase();
    const closing = Number(clean(item["STOCKITEM_CLOSING_BALANCE"]).replace(/,/g, "") || "0");
    if (!Number.isFinite(closing)) return true;
    return Math.abs((netMovementByItem.get(itemKey) ?? 0) - closing) > 0.001;
  }).length;
  const exportedAt = new Date().toISOString();
  const rowDefaults: Partial<Record<OperationalTableName, Record<string, LegacyJson>>> = {
    customers: { payment_terms_days: 0, price_level: "retail", type: "retail" },
    suppliers: { credit_terms_days: 0 },
    money_accounts: { status: "active" },
    purchases: {
      courier_cost: 0,
      insurance_cost: 0,
      loading_cost: 0,
      other_cost: 0,
      transport_cost: 0,
    },
    sales: { finance_charge: 0, partner_financed: false },
  };
  for (const rows of Object.values(tables)) {
    for (const row of rows) {
      row["created_at"] ??= exportedAt;
      row["updated_at"] ??= exportedAt;
    }
  }
  for (const [table, defaults] of Object.entries(rowDefaults) as [
    OperationalTableName,
    Record<string, LegacyJson>,
  ][]) {
    for (const row of tables[table]) {
      for (const [column, value] of Object.entries(defaults)) {
        row[column] ??= value;
      }
    }
  }

  const backup: LegacyOperationalBackup = {
    app: "MOBILE D-ERP",
    version: 1,
    business_id: businessId,
    legacy_csv_import: true,
    exported_at: exportedAt,
    tables,
  };
  return {
    backup,
    preview: {
      branches: tables["branches"].length,
      accounts: tables["accounts"].length,
      customers: tables["customers"].length,
      suppliers: tables["suppliers"].length,
      products: tables["products"].length,
      sales: tables["sales"].length,
      saleItems: tables["sale_items"].length,
      purchases: tables["purchases"].length,
      purchaseItems: tables["purchase_items"].length,
      vouchers: tables["journal_entries"].length,
      inventoryMovements: tables["stock_movements"].length,
      unlinkedSalesReturns,
      inventorySnapshotMismatches,
    },
  };
}

export function createCurrentDataBackup(
  archive: LegacyArchive,
  businessId: string,
  createdBy: string,
): { backup: LegacyOperationalBackup; preview: CurrentDataPreview } {
  if (
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(businessId) ||
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(createdBy)
  ) {
    throw new Error("A valid target business and signed-in owner are required.");
  }

  const tables = emptyOperationalTables();
  const branchId = id();
  const now = new Date().toISOString();
  tables["branches"].push({
    id: branchId,
    business_id: businessId,
    name: "Head Office",
    kind: "head",
    status: "active",
    created_at: now,
    updated_at: now,
  });

  const accountIds = new Map<string, string>();
  for (const [code, name, type] of SYSTEM_ACCOUNTS) {
    const accountId = id();
    accountIds.set(code, accountId);
    tables["accounts"].push({
      id: accountId,
      business_id: businessId,
      code,
      name,
      type,
      is_system: true,
      created_at: now,
    });
  }

  let customerMobileIndex = 1;
  let supplierMobileIndex = 50_001;
  const customerMobiles = new Set<string>();
  const supplierMobiles = new Set<string>();
  const customerNames = new Set<string>();
  const supplierNames = new Set<string>();
  let customerDueCents = 0;
  let supplierPayableCents = 0;
  const parties = rowsByName(archive, "02_Ledger_Party.csv");
  const customerAccountId = accountIds.get("1100")!;
  const supplierAccountId = accountIds.get("2010")!;
  const equityAccountId = accountIds.get("3020")!;

  const addOpeningJournal = (
    partyId: string,
    name: string,
    isSupplier: boolean,
    amount: number,
  ) => {
    if (!amount) return;
    const entryId = id();
    tables["journal_entries"].push({
      id: entryId,
      business_id: businessId,
      entry_date: now.slice(0, 10),
      ref_type: isSupplier ? "supplier_opening" : "customer_opening",
      ref_id: partyId,
      memo: `Opening balance - ${name}`,
      created_by: createdBy,
      created_at: now,
    });
    const dueAccountId = isSupplier ? supplierAccountId : customerAccountId;
    tables["journal_lines"].push(
      {
        business_id: businessId,
        entry_id: entryId,
        account_id: isSupplier ? equityAccountId : dueAccountId,
        debit: amount,
        credit: 0,
      },
      {
        business_id: businessId,
        entry_id: entryId,
        account_id: isSupplier ? dueAccountId : equityAccountId,
        debit: 0,
        credit: amount,
      },
    );
  };

  for (const party of parties) {
    const name = clean(party["LEDGER_NAME"]);
    const key = name.toLocaleLowerCase();
    const group =
      `${clean(party["LEDGER_PARENT_GROUP"])} ${clean(party["LEDGER_PRIMARY_GROUP"])}`.toLowerCase();
    const isCustomer = clean(party["LEDGER_PARENT_GROUP"]) === "Sundry Debtors";
    const isSupplier = clean(party["LEDGER_PARENT_GROUP"]) === "Sundry Creditors";
    if (!isCustomer && !isSupplier) continue;
    const seenNames = isSupplier ? supplierNames : customerNames;
    if (!name || seenNames.has(key)) {
      throw new Error("The party list contains a blank or duplicate name.");
    }
    seenNames.add(key);

    const closingCents = Math.abs(cents(party["LEDGER_CLOSING_BALANCE"], "LEDGER_CLOSING_BALANCE"));
    const address = [party["LEDGER_ADDRESS1"], party["LEDGER_ADDRESS2"], party["LEDGER_CITY"]]
      .map(clean)
      .filter(Boolean)
      .join(", ")
      .slice(0, 500);
    if (isCustomer) {
      const customerId = id();
      const mobile = sourceMobile(party["LEDGER_MOBILE"], customerMobileIndex++, customerMobiles);
      const type = group.includes("sub dealer")
        ? "sub_dealer"
        : group.includes("dealer")
          ? "wholesale_dealer"
          : "retail";
      tables["customers"].push({
        id: customerId,
        business_id: businessId,
        name: name.slice(0, 120),
        mobile,
        address,
        type,
        price_level: type === "wholesale_dealer" || type === "sub_dealer" ? "dealer" : "retail",
        payment_terms_days: 0,
        opening_balance: closingCents / 100,
        credit_limit: Math.max(0, cents(party["LEDGER_CREDIT_LIMIT"], "LEDGER_CREDIT_LIMIT") / 100),
        status: "active",
        created_at: now,
      });
      customerDueCents += closingCents;
      addOpeningJournal(customerId, name, false, closingCents / 100);
    } else {
      const supplierId = id();
      const mobile = sourceMobile(party["LEDGER_MOBILE"], supplierMobileIndex++, supplierMobiles);
      tables["suppliers"].push({
        id: supplierId,
        business_id: businessId,
        name: name.slice(0, 120),
        mobile,
        address,
        credit_terms_days: 0,
        opening_payable: closingCents / 100,
        status: "active",
        created_at: now,
      });
      supplierPayableCents += closingCents;
      addOpeningJournal(supplierId, name, true, closingCents / 100);
    }
  }

  const stockItems = rowsByName(archive, "09_Stock_Items.csv");
  const categoryIds = new Map<string, string>();
  const brandIds = new Map<string, string>();
  const productNames = new Set<string>();
  for (const [index, item] of stockItems.entries()) {
    const name = clean(item["STOCKITEM_NAME"]);
    const key = name.toLocaleLowerCase();
    if (!name || productNames.has(key)) {
      throw new Error("The product list contains a blank or duplicate name.");
    }
    productNames.add(key);

    const sourceGroup = clean(item["STOCKGROUP_NAME"]) || "Uncategorized";
    const categoryKey = sourceGroup.toLocaleLowerCase();
    let categoryId = categoryIds.get(categoryKey);
    if (!categoryId) {
      categoryId = id();
      categoryIds.set(categoryKey, categoryId);
      tables["categories"].push({
        id: categoryId,
        business_id: businessId,
        name: sourceGroup.slice(0, 120),
        is_serialized: false,
        created_at: now,
      });
    }
    const brandName = clean(item["STOCKITEM_MANUFACTURER"]) || "Unspecified";
    const brandKey = brandName.toLocaleLowerCase();
    let brandId = brandIds.get(brandKey);
    if (!brandId) {
      brandId = id();
      brandIds.set(brandKey, brandId);
      tables["brands"].push({
        id: brandId,
        business_id: businessId,
        name: brandName.slice(0, 120),
        created_at: now,
      });
    }

    const openingRate = Math.max(
      0,
      cents(item["STOCKITEM_OPENING_RATE"], "STOCKITEM_OPENING_RATE"),
    );
    const quantityValue = Number(clean(item["STOCKITEM_CLOSING_BALANCE"]).replace(/,/g, "") || "0");
    if (!Number.isFinite(quantityValue) || !Number.isInteger(quantityValue)) {
      throw new Error(`Invalid stock quantity for ${name}.`);
    }
    const productId = id();
    const variantId = id();
    tables["products"].push({
      id: productId,
      business_id: businessId,
      brand_id: brandId,
      category_id: categoryId,
      model: name.slice(0, 120),
      status: "inactive",
      created_at: now,
    });
    tables["product_variants"].push({
      id: variantId,
      business_id: businessId,
      product_id: productId,
      sku: `PRD-${String(index + 1).padStart(5, "0")}`,
      purchase_price: openingRate / 100,
      wholesale_price: 0,
      dealer_price: 0,
      retail_price: 0,
      min_price: 0,
      reorder_level: Math.max(0, Math.trunc(Number(item["STOCKITEM_REORDER_LEVEL"]) || 0)),
      warranty_months: 0,
      status: "inactive",
      created_at: now,
    });
    tables["stock"].push({
      business_id: businessId,
      branch_id: branchId,
      variant_id: variantId,
      qty: Math.max(0, quantityValue),
      avg_cost: openingRate / 100,
      updated_at: now,
    });
  }

  const backup: LegacyOperationalBackup = {
    app: "MOBILE D-ERP",
    version: 1,
    business_id: businessId,
    legacy_csv_import: true,
    exported_at: now,
    tables,
  };
  return {
    backup,
    preview: {
      customers: tables["customers"].filter((row) => row["type"] === "retail").length,
      dealers: tables["customers"].filter((row) => row["type"] !== "retail").length,
      suppliers: tables["suppliers"].length,
      products: tables["products"].length,
      stockItems: tables["stock"].length,
      customerDue: customerDueCents / 100,
      supplierPayable: supplierPayableCents / 100,
      openingJournals: tables["journal_entries"].length,
      imeis: 0,
    },
  };
}

export function summarizeLegacyArchive(archive: LegacyArchive): LegacyArchiveSourcePreview {
  const voucherRows = fileByName(archive, "04_All_Vouchers.csv")?.records ?? [];
  const vouchers = new Map<string, { debit: number; credit: number; valid: boolean }>();
  for (const row of voucherRows) {
    const ref = row["COMP_REF_NO"] ?? "";
    const voucher = vouchers.get(ref) ?? { debit: 0, credit: 0, valid: true };
    const debit = amountInCents(row["VOUCHER_DEBIT_AMOUNT"]);
    const credit = amountInCents(row["VOUCHER_CREDIT_AMOUNT"]);
    if (!ref || !Number.isFinite(debit) || !Number.isFinite(credit)) voucher.valid = false;
    voucher.debit += debit;
    voucher.credit += credit;
    vouchers.set(ref, voucher);
  }
  const balanced = [...vouchers.values()].filter(
    (voucher) => voucher.valid && Math.abs(voucher.debit - voucher.credit) <= 1,
  ).length;

  const sharedBillColumns = [
    "COMP_REF_NO",
    "COMP_VOUCHER_DATE",
    "STOCKITEM_NAME",
    "GODOWNS_NAME",
    "BILL_QUANTITY",
    "BILL_RATE",
    "BILL_UOM",
    "BILL_AMOUNT",
    "BILL_NET_AMOUNT",
    "VAT_AMOUNT",
  ];
  const billRows = (name: string) => fileByName(archive, name)?.records ?? [];
  const billKey = (row: LegacyArchiveRecord) =>
    sharedBillColumns.map((column) => row[column] ?? "").join("\u001f");
  const baseBills = billRows("05_Bill_Transactions.csv");
  const variantBills = billRows("06_Bill_Transactions.csv");
  const baseBillKeys = new Set(baseBills.map(billKey));
  const duplicateBillRows = variantBills.filter((row) => baseBillKeys.has(billKey(row))).length;

  const parties = fileByName(archive, "02_Ledger_Party.csv")?.records ?? [];
  const stockItems = fileByName(archive, "09_Stock_Items.csv")?.records ?? [];
  const inventory = fileByName(archive, "13_Inventory_Transactions.csv")?.records ?? [];
  const mobileMissing = (value: string | undefined) =>
    !value?.trim() || value.trim().toUpperCase() === "NULL";

  return {
    fileCount: archive.files.length,
    sourceRecordCount: archive.total_record_count,
    voucherReferences: vouchers.size,
    balancedVoucherReferences: balanced,
    unbalancedVoucherReferences: vouchers.size - balanced,
    duplicateBillRows,
    missingPartyMobile: parties.filter((row) => mobileMissing(row["LEDGER_MOBILE"])).length,
    productsWithoutCategory: stockItems.filter((row) => mobileMissing(row["STOCKCATEGORY_NAME"]))
      .length,
    productsWithoutManufacturer: stockItems.filter((row) =>
      mobileMissing(row["STOCKITEM_MANUFACTURER"]),
    ).length,
    placeholderOpeningRows: inventory.filter((row) => row["INV_DATE"]?.startsWith("1900-01-01"))
      .length,
    negativeClosingRows: stockItems.filter(
      (row) => amountInCents(row["STOCKITEM_CLOSING_BALANCE"]) < 0,
    ).length,
    unusableFiles: archive.files
      .filter((file) => UNUSABLE_FILES.has(file.source_file))
      .map((file) => file.source_file),
  };
}

export function legacyArchiveUploadRows(
  archive: LegacyArchive,
  manifest: LegacyArchiveManifest,
): { source_file: string; source_hash: string; row_number: number; record: LegacyArchiveRecord }[] {
  const hashes = new Map(manifest.map((file) => [file.source_file, file.sha256]));
  return archive.files.flatMap((file) => {
    const sourceHash = hashes.get(file.source_file);
    if (!sourceHash) throw new Error(`Missing manifest entry for ${file.source_file}.`);
    return file.records.map((record, index) => ({
      source_file: file.source_file,
      source_hash: sourceHash,
      row_number: index + 1,
      record,
    }));
  });
}
