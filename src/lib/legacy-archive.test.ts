import { describe, expect, it } from "vitest";
import {
  createCurrentDataBackup,
  createLegacyOperationalBackup,
  parseLegacyArchive,
  summarizeLegacyArchive,
  type LegacyArchive,
} from "@/lib/legacy-archive";

const hash = "a".repeat(64);

function archive(files: LegacyArchive["files"]): LegacyArchive {
  return {
    format: "legacy-csv-json-archive",
    format_version: 1,
    restore_compatible: false,
    source_file_count: files.length,
    total_record_count: files.reduce((total, file) => total + file.records.length, 0),
    files,
  };
}

function file(
  source_file: string,
  columns: string[],
  records: Record<string, string>[],
): LegacyArchive["files"][number] {
  return {
    source_file,
    sha256: hash,
    source_bytes: 1,
    columns,
    row_count: records.length,
    records,
  };
}

describe("legacy archive parsing", () => {
  it("accepts the legacy archive format and rejects native backups", () => {
    const input = archive([file("sample.csv", ["NAME"], [{ NAME: "Item" }])]);
    expect(parseLegacyArchive(input)).toEqual(input);
    expect(() => parseLegacyArchive({ app: "MOBILE D-ERP" })).toThrow(
      "Choose the prepared company data archive",
    );
  });

  it("rejects row totals or columns that do not match the archived CSV", () => {
    const invalid = archive([file("sample.csv", ["NAME"], [{ NAME: "Item" }])]);
    invalid.total_record_count = 2;
    expect(() => parseLegacyArchive(invalid)).toThrow("archive totals do not match");

    const wrongColumns = archive([file("sample.csv", ["NAME"], [{ NAME: "Item", EXTRA: "x" }])]);
    expect(() => parseLegacyArchive(wrongColumns)).toThrow("does not match its CSV columns");
  });

  it("summarizes balanced vouchers and unsafe source conditions without exposing row values", () => {
    const source = archive([
      file(
        "04_All_Vouchers.csv",
        ["COMP_REF_NO", "VOUCHER_DEBIT_AMOUNT", "VOUCHER_CREDIT_AMOUNT"],
        [
          { COMP_REF_NO: "A", VOUCHER_DEBIT_AMOUNT: "10.00", VOUCHER_CREDIT_AMOUNT: ".00" },
          { COMP_REF_NO: "A", VOUCHER_DEBIT_AMOUNT: ".00", VOUCHER_CREDIT_AMOUNT: "10.00" },
          { COMP_REF_NO: "B", VOUCHER_DEBIT_AMOUNT: "9.00", VOUCHER_CREDIT_AMOUNT: ".00" },
        ],
      ),
      file(
        "05_Bill_Transactions.csv",
        ["COMP_REF_NO", "STOCKITEM_NAME", "BILL_AMOUNT"],
        [{ COMP_REF_NO: "A", STOCKITEM_NAME: "Phone", BILL_AMOUNT: "100" }],
      ),
      file(
        "06_Bill_Transactions.csv",
        ["COMP_REF_NO", "STOCKITEM_NAME", "BILL_AMOUNT", "COMP_VOUCHER_TYPE"],
        [
          {
            COMP_REF_NO: "A",
            STOCKITEM_NAME: "Phone",
            BILL_AMOUNT: "100",
            COMP_VOUCHER_TYPE: "16",
          },
        ],
      ),
      file("02_Ledger_Party.csv", ["LEDGER_MOBILE"], [{ LEDGER_MOBILE: "NULL" }]),
      file(
        "09_Stock_Items.csv",
        ["STOCKCATEGORY_NAME", "STOCKITEM_MANUFACTURER", "STOCKITEM_CLOSING_BALANCE"],
        [
          {
            STOCKCATEGORY_NAME: "NULL",
            STOCKITEM_MANUFACTURER: "",
            STOCKITEM_CLOSING_BALANCE: "-1",
          },
        ],
      ),
      file(
        "13_Inventory_Transactions.csv",
        ["INV_DATE"],
        [{ INV_DATE: "1900-01-01 00:00:00.000" }],
      ),
      file("17_Trial_Balance.csv", ["ERROR"], [{ ERROR: "Error" }]),
    ]);

    expect(summarizeLegacyArchive(source)).toMatchObject({
      voucherReferences: 2,
      balancedVoucherReferences: 1,
      unbalancedVoucherReferences: 1,
      duplicateBillRows: 1,
      missingPartyMobile: 1,
      productsWithoutCategory: 1,
      productsWithoutManufacturer: 1,
      placeholderOpeningRows: 1,
      negativeClosingRows: 1,
      unusableFiles: ["17_Trial_Balance.csv"],
    });
  });

  it("builds a tenant-scoped ERP backup with journals, invoices, stock and party mappings", () => {
    const source = archive([
      file(
        "02_Ledger_Party.csv",
        [
          "LEDGER_NAME",
          "LEDGER_PARENT_GROUP",
          "LEDGER_PRIMARY_GROUP",
          "LEDGER_MOBILE",
          "LEDGER_ADDRESS1",
          "LEDGER_ADDRESS2",
          "LEDGER_CITY",
          "LEDGER_OPENING_BALANCE",
          "LEDGER_CREDIT_LIMIT",
          "LEDGER_CLOSING_BALANCE",
        ],
        [
          {
            LEDGER_NAME: "Supplier",
            LEDGER_PARENT_GROUP: "Sundry Creditors",
            LEDGER_PRIMARY_GROUP: "Current Liabilities",
            LEDGER_MOBILE: "NULL",
            LEDGER_ADDRESS1: "",
            LEDGER_ADDRESS2: "",
            LEDGER_CITY: "",
            LEDGER_OPENING_BALANCE: ".00",
            LEDGER_CREDIT_LIMIT: ".00",
            LEDGER_CLOSING_BALANCE: "0.00",
          },
          {
            LEDGER_NAME: "Cash",
            LEDGER_PARENT_GROUP: "Cash in Hand",
            LEDGER_PRIMARY_GROUP: "Current Assets",
            LEDGER_MOBILE: "",
            LEDGER_ADDRESS1: "",
            LEDGER_ADDRESS2: "",
            LEDGER_CITY: "",
            LEDGER_OPENING_BALANCE: "-5.00",
            LEDGER_CREDIT_LIMIT: ".00",
            LEDGER_CLOSING_BALANCE: "-55.00",
          },
          {
            LEDGER_NAME: "Customer",
            LEDGER_PARENT_GROUP: "Sundry Debtors",
            LEDGER_PRIMARY_GROUP: "Current Assets",
            LEDGER_MOBILE: "NULL",
            LEDGER_ADDRESS1: "",
            LEDGER_ADDRESS2: "",
            LEDGER_CITY: "",
            LEDGER_OPENING_BALANCE: "-10.00",
            LEDGER_CREDIT_LIMIT: "0.00",
            LEDGER_CLOSING_BALANCE: "-60.00",
          },
          {
            LEDGER_NAME: "Sales",
            LEDGER_PARENT_GROUP: "Sales Accounts",
            LEDGER_PRIMARY_GROUP: "Sales Accounts",
            LEDGER_MOBILE: "",
            LEDGER_ADDRESS1: "",
            LEDGER_ADDRESS2: "",
            LEDGER_CITY: "",
            LEDGER_OPENING_BALANCE: ".00",
            LEDGER_CREDIT_LIMIT: ".00",
            LEDGER_CLOSING_BALANCE: "0.00",
          },
          {
            LEDGER_NAME: "Purchases",
            LEDGER_PARENT_GROUP: "Purchase Accounts",
            LEDGER_PRIMARY_GROUP: "Purchase Accounts",
            LEDGER_MOBILE: "",
            LEDGER_ADDRESS1: "",
            LEDGER_ADDRESS2: "",
            LEDGER_CITY: "",
            LEDGER_OPENING_BALANCE: ".00",
            LEDGER_CREDIT_LIMIT: ".00",
            LEDGER_CLOSING_BALANCE: "0.00",
          },
        ],
      ),
      file(
        "09_Stock_Items.csv",
        [
          "STOCKITEM_NAME",
          "STOCKGROUP_NAME",
          "STOCKCATEGORY_NAME",
          "STOCKITEM_MANUFACTURER",
          "STOCKITEM_OPENING_BALANCE",
          "STOCKITEM_OPENING_RATE",
          "STOCKITEM_CLOSING_BALANCE",
          "STOCKITEM_REORDER_LEVEL",
        ],
        [
          {
            STOCKITEM_NAME: "Phone",
            STOCKGROUP_NAME: "Phones",
            STOCKCATEGORY_NAME: "NULL",
            STOCKITEM_MANUFACTURER: "NULL",
            STOCKITEM_OPENING_BALANCE: "0",
            STOCKITEM_OPENING_RATE: "40.00",
            STOCKITEM_CLOSING_BALANCE: "1",
            STOCKITEM_REORDER_LEVEL: "0",
          },
        ],
      ),
      file(
        "05_Company_Voucher.csv",
        [
          "COMP_REF_NO",
          "COMP_VOUCHER_TYPE",
          "COMP_VOUCHER_DATE",
          "COMP_VOUCHER_PARTY_NAME",
          "COMP_VOUCHER_NARRATION",
        ],
        [
          {
            COMP_REF_NO: "S-1",
            COMP_VOUCHER_TYPE: "16",
            COMP_VOUCHER_DATE: "2025-05-02",
            COMP_VOUCHER_PARTY_NAME: "Customer",
            COMP_VOUCHER_NARRATION: "",
          },
          {
            COMP_REF_NO: "R-1",
            COMP_VOUCHER_TYPE: "1",
            COMP_VOUCHER_DATE: "2025-05-03",
            COMP_VOUCHER_PARTY_NAME: "Customer",
            COMP_VOUCHER_NARRATION: "",
          },
          {
            COMP_REF_NO: "P-1",
            COMP_VOUCHER_TYPE: "33",
            COMP_VOUCHER_DATE: "2025-05-04",
            COMP_VOUCHER_PARTY_NAME: "Supplier",
            COMP_VOUCHER_NARRATION: "",
          },
        ],
      ),
      file(
        "04_All_Vouchers.csv",
        [
          "COMP_REF_NO",
          "COMP_VOUCHER_DATE",
          "COMP_VOUCHER_TYPE",
          "LEDGER_NAME",
          "VOUCHER_DEBIT_AMOUNT",
          "VOUCHER_CREDIT_AMOUNT",
          "COMP_VOUCHER_NARRATION",
        ],
        [
          {
            COMP_REF_NO: "S-1",
            COMP_VOUCHER_DATE: "2025-05-02",
            COMP_VOUCHER_TYPE: "16",
            LEDGER_NAME: "Customer",
            VOUCHER_DEBIT_AMOUNT: "75.00",
            VOUCHER_CREDIT_AMOUNT: ".00",
          },
          {
            COMP_REF_NO: "S-1",
            COMP_VOUCHER_DATE: "2025-05-02",
            COMP_VOUCHER_TYPE: "16",
            LEDGER_NAME: "Cash",
            VOUCHER_DEBIT_AMOUNT: "25.00",
            VOUCHER_CREDIT_AMOUNT: ".00",
          },
          {
            COMP_REF_NO: "S-1",
            COMP_VOUCHER_DATE: "2025-05-02",
            COMP_VOUCHER_TYPE: "16",
            LEDGER_NAME: "Sales",
            VOUCHER_DEBIT_AMOUNT: ".00",
            VOUCHER_CREDIT_AMOUNT: "100.00",
          },
          {
            COMP_REF_NO: "R-1",
            COMP_VOUCHER_DATE: "2025-05-03",
            COMP_VOUCHER_TYPE: "1",
            LEDGER_NAME: "Cash",
            VOUCHER_DEBIT_AMOUNT: "25.00",
            VOUCHER_CREDIT_AMOUNT: ".00",
          },
          {
            COMP_REF_NO: "R-1",
            COMP_VOUCHER_DATE: "2025-05-03",
            COMP_VOUCHER_TYPE: "1",
            LEDGER_NAME: "Customer",
            VOUCHER_DEBIT_AMOUNT: ".00",
            VOUCHER_CREDIT_AMOUNT: "25.00",
          },
          {
            COMP_REF_NO: "P-1",
            COMP_VOUCHER_DATE: "2025-05-04",
            COMP_VOUCHER_TYPE: "33",
            LEDGER_NAME: "Purchases",
            VOUCHER_DEBIT_AMOUNT: "40.00",
            VOUCHER_CREDIT_AMOUNT: ".00",
          },
          {
            COMP_REF_NO: "P-1",
            COMP_VOUCHER_DATE: "2025-05-04",
            COMP_VOUCHER_TYPE: "33",
            LEDGER_NAME: "Supplier",
            VOUCHER_DEBIT_AMOUNT: ".00",
            VOUCHER_CREDIT_AMOUNT: "40.00",
          },
        ],
      ),
      file(
        "06_Bill_Transactions.csv",
        [
          "COMP_REF_NO",
          "COMP_VOUCHER_DATE",
          "COMP_VOUCHER_TYPE",
          "STOCKITEM_NAME",
          "BILL_QUANTITY",
          "BILL_RATE",
          "BILL_NET_AMOUNT",
        ],
        [
          {
            COMP_REF_NO: "S-1",
            COMP_VOUCHER_DATE: "2025-05-02",
            COMP_VOUCHER_TYPE: "16",
            STOCKITEM_NAME: "Phone",
            BILL_QUANTITY: "1",
            BILL_RATE: "100.00",
            BILL_NET_AMOUNT: "100.00",
          },
          {
            COMP_REF_NO: "P-1",
            COMP_VOUCHER_DATE: "2025-05-04",
            COMP_VOUCHER_TYPE: "33",
            STOCKITEM_NAME: "Phone",
            BILL_QUANTITY: "1",
            BILL_RATE: "40.00",
            BILL_NET_AMOUNT: "40.00",
          },
        ],
      ),
      file(
        "13_Inventory_Transactions.csv",
        [
          "INV_REF_NO",
          "INV_DATE",
          "STOCKITEM_NAME",
          "INV_VOUCHER_TYPE",
          "INV_INOUT_FLAG",
          "INV_TRAN_QUANTITY",
          "INV_TRAN_RATE",
          "OUTWARD_COST_AMOUNT",
        ],
        [
          {
            INV_REF_NO: "S-1",
            INV_DATE: "2025-05-02",
            STOCKITEM_NAME: "Phone",
            INV_VOUCHER_TYPE: "16",
            INV_INOUT_FLAG: "O",
            INV_TRAN_QUANTITY: "1",
            INV_TRAN_RATE: "40.00",
            OUTWARD_COST_AMOUNT: "40.00",
          },
          {
            INV_REF_NO: "P-1",
            INV_DATE: "2025-05-04",
            STOCKITEM_NAME: "Phone",
            INV_VOUCHER_TYPE: "33",
            INV_INOUT_FLAG: "I",
            INV_TRAN_QUANTITY: "1",
            INV_TRAN_RATE: "40.00",
            OUTWARD_COST_AMOUNT: ".00",
          },
        ],
      ),
    ]);

    const { backup, preview } = createLegacyOperationalBackup(
      source,
      "f9bb67e7-d730-4a7f-9ccd-a497b5c8a4db",
      "f0f0f0f0-d730-4a7f-9ccd-a497b5c8a4db",
    );
    expect(preview).toMatchObject({
      branches: 1,
      customers: 1,
      suppliers: 1,
      products: 1,
      sales: 1,
      saleItems: 1,
      purchases: 1,
      purchaseItems: 1,
      vouchers: 4,
      inventoryMovements: 2,
    });
    expect(backup.tables["sales"]?.[0]).toMatchObject({
      invoice_no: "S-1",
      total: 100,
      paid: 25,
      due: 75,
      customer_id: expect.any(String),
      finance_charge: 0,
      partner_financed: false,
      created_at: expect.any(String),
    });
    expect(backup.tables["purchases"]?.[0]).toMatchObject({ invoice_no: "P-1", total: 40 });
    expect(backup.tables["branches"]?.[0]).toMatchObject({
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
    expect(backup.tables["customers"]?.[0]).toMatchObject({
      payment_terms_days: 0,
      price_level: "retail",
      type: "retail",
    });
    expect(backup.tables["money_accounts"]?.[0]).toMatchObject({ status: "active" });
    expect(backup.tables["journal_lines"]).toHaveLength(10);
    expect(backup.tables["customer_payments"]).toHaveLength(2);
    expect(backup.tables["money_transactions"]).toHaveLength(2);
    expect(backup.tables["customer_payments"]?.[0]).toMatchObject({ amount: 25, method: "cash" });
    expect(backup.tables["customers"]?.[0]).toMatchObject({ opening_balance: 10 });
    expect(backup.tables["money_accounts"]?.[0]).toMatchObject({ opening_balance: 5 });
    expect(backup.tables["customers"]?.[0]?.["mobile"]).toMatch(/^01[3-9]\d{8}$/);

    const currentData = createCurrentDataBackup(
      source,
      "f9bb67e7-d730-4a7f-9ccd-a497b5c8a4db",
      "f0f0f0f0-d730-4a7f-9ccd-a497b5c8a4db",
    );
    expect(currentData.preview).toMatchObject({
      customers: 1,
      dealers: 0,
      suppliers: 1,
      products: 1,
      stockItems: 1,
      customerDue: 60,
      supplierPayable: 0,
      openingJournals: 1,
      imeis: 0,
    });
    expect(currentData.backup.tables["sales"]).toHaveLength(0);
    expect(currentData.backup.tables["purchases"]).toHaveLength(0);
    expect(currentData.backup.tables["customer_payments"]).toHaveLength(0);
    expect(currentData.backup.tables["supplier_payments"]).toHaveLength(0);
    expect(currentData.backup.tables["money_transactions"]).toHaveLength(0);
    expect(currentData.backup.tables["stock_movements"]).toHaveLength(0);
    expect(currentData.backup.tables["product_imeis"]).toHaveLength(0);
    expect(currentData.backup.tables["customers"]?.[0]).toMatchObject({
      opening_balance: 60,
    });
    expect(currentData.backup.tables["customers"]?.[0]).not.toHaveProperty("notes");
    expect(currentData.backup.tables["product_variants"]?.[0]?.["sku"]).toBe("PRD-00001");
    const searchableData = JSON.stringify(currentData.backup.tables).toLowerCase();
    expect(searchableData).not.toContain("legacy");
  });
});
