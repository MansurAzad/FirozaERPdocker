# FIROZA ENTERPRISE — Product Architecture

> মোবাইল ব্যবসার সম্পূর্ণ ডিজিটাল ব্যবস্থাপনা

## 1. Platform

- Frontend: React 19 + TanStack Start/Router/Query, Tailwind v4, shadcn/ui, React Hook Form, Zod.
- Backend: TanStack server functions (typed RPC) instead of Express; runs on edge workers.
- Database: PostgreSQL (Lovable Cloud) with RLS for tenant isolation, NUMERIC(14,2) for money.
- Critical business transactions (sale, purchase, return, payment, transfer) run as **Postgres functions (RPC)** so every step commits or rolls back together.
- Auth: email/password + Google; per-business roles in `business_members.role`, enforced in RLS and server functions.

## 2. Tenant model

```text
businesses 1─* branches 1─* warehouses
businesses 1─* business_members (user_id, role, branch scope)
every business table: business_id NOT NULL + RLS: is_member(business_id)
```

## 3. Advanced access control

- Custom access-role templates and per-member overrides are scoped to one business.
- Permissions are explicit per module and action (`view`, `create`, `edit`, `delete`, `approve`, `export`); unconfigured access is denied and the business owner always retains full access.
- The authenticated app filters navigation, command-palette entries, dashboard cards, and route rendering using the effective permission map.
- PostgreSQL remains authoritative: restrictive RLS policies, guarded RPCs, and write triggers enforce the same module/action rules for direct API calls and transactional writes. Public views run with invoker security.
- Company identity exposes only the fields needed by the app shell. Detailed company-profile and Guardian runtime data is returned by permission-checked RPCs.
- The access-control schema and policies are installed by `drizzle/migrations/0051_advanced_access_control.sql`. Existing non-owner members remain denied until an owner assigns a role or explicit grants. Apply subsequent corrections with their individual migration; `npm run db:apply-access-view-guard` applies `drizzle/migrations/0052_access_permission_view_prerequisite.sql`, which ensures every non-owner action permission also requires module view access.

## 4. Excel data and responsive pages

- The Products, Inventory, Customers, Dealers, and Suppliers pages expose tenant-scoped Excel exports and validated import templates, gated by each module's export/create permissions. Large lists are paged from Postgres before export so exports are not limited by the API's default row cap.
- Contact and catalog imports create new records only; duplicate mobile numbers, SKUs, or product variants are skipped rather than overwriting existing records. Product imports resolve existing brand and category names and do not create stock.
- Inventory imports are physical-count spreadsheets for one active branch. They create and post a recount through the stock-adjustment RPCs, preserving stock movement history and atomic database updates; they do not write stock rows directly.
- Dealer payment imports require an explicit transaction reference, dealer, date, method, and active receiving account. Each receipt goes through `receive_customer_payment_for_branch`, preserving the ledger and journal trail and enforcing the selected shop's current due.
- Customer and dealer profiles remain shared business-wide identity records (mobile number remains unique per business). `customer_branch_assignments` controls shop membership and stores each shop's opening due; customer balances exclude partner-financed sales, whose receivable is tracked separately. Sales, returns, receipts, EMI, quotations, orders, service records, warranty history, due views, and customer ledgers are scoped to the selected authorized shop. Creating a customer and its first shop assignment is atomic through `create_customer_for_branch`; existing profiles can be assigned to another shop only by an authorized central administrator.
- Migration `0059_customer_branch_assignments.sql` backfills shop assignments from sales history, moves an existing opening balance to the customer's earliest sale shop, and aligns linked payment/ledger branch references. Unresolvable payment-shop mappings abort the migration rather than silently hiding or misattributing history. Profiles without shop-linked sales remain centrally visible until an administrator assigns them. Unscoped customer-portal payment requests and dealer payment history remain central-role-only until they have an explicit shop reference. Dealer payment imports and manual receipts use `receive_customer_payment_for_branch`.
- `supplier_branch_assignments` is the shop-specific supplier allowlist; an audited, business-level default supplier reference and branch trigger assign FIROZA ENTERPRISE to existing and newly created brand shops. If no active FIROZA ENTERPRISE record exists, an administrator must create/activate it and configure it from Supplier Management before another shop can be opened. Purchases, purchase orders, and stock receiving validate the active shop assignment in PostgreSQL; existing purchase and ledger references are not rewritten. Apply `drizzle/migrations/0060_shop_supplier_assignments.sql` after `0059_customer_branch_assignments.sql`.
- Partner Finance discounts post only the net cash as a collection; the discount is separately journaled to the existing Sales Discount account and does not reduce the financed amount twice. Approval is required by default and the configured no-approval allowance starts at 0%; an owner/manager must explicitly set a business limit before smaller discounts can post without approval.
- Supplier assignment changes are available to central administrators in Supplier Management and retain row-level audit history. The Partner Finance form currently posts an agreement atomically through the existing sale/stock/accounting RPC; draft submission and a separate review/approve/reject lifecycle are not exposed because the existing database model has no safe draft workflow or assigned approver/status transition. Do not represent a draft as a posted financial agreement.
- Page-level horizontal overflow is clipped; wide tables retain contained horizontal scrolling so they cannot shift the surrounding application layout.

## 5. Module dependency map

```text
Auth ─► Business ─► Branch/Warehouse ─► Users/Roles/Permissions
                         │
      ┌──────────────────┼───────────────────┐
  Products            Customers           Suppliers
 (Brand→Model→Variant)   │                   │
      │                  │                   │
      └──► Purchase ◄────┼───────────────────┘
              │ (IMEI entry, landed cost)
              ▼
         Inventory / IMEI ◄──── Stock Transfer / Adjustment
              │
              ▼
            Sales ──► Sales Return / Warranty / Commission
              │
              ▼
   Payments (Cash · Bank · bKash · Nagad · Rocket · Card · Cheque)
              │
              ▼
   Accounting engine (auto journal) ─► Ledgers ─► P&L / Balance Sheet
              │
              ▼
        Reports ─► Analytics ─► AI assistant (future)
```

## 6. Core ERD (Phase 1–3)

```text
businesses(id, name, type[retail|wholesale|both], currency, logo_url)
branches(id, business_id, name, kind[head|branch|warehouse])
business_members(id, business_id, user_id, role, branch_id?)
role_permissions(role, module, action)

brands(id, business_id, name)
categories(id, business_id, name, is_serialized)
products(id, business_id, brand_id, category_id, model, sku)
product_variants(id, product_id, ram, storage, color,
  purchase_price, wholesale_price, dealer_price, retail_price,
  min_price, reorder_level, warranty_months, status)
product_imeis(id, business_id, variant_id, imei1 UNIQUE, imei2, serial,
  status[IN_STOCK|RESERVED|SOLD|RETURNED|WARRANTY], branch_id,
  purchase_item_id, sale_item_id, cost)

customers(id, business_id, name, business_name, mobile, nid, trade_license,
  type, price_level, credit_limit, payment_terms_days, opening_balance)
customer_branch_assignments(id, business_id, customer_id, branch_id, opening_balance)
suppliers(id, business_id, name, company, mobile, bank_info, opening_payable, terms_days)

purchases(id, business_id, branch_id, supplier_id, invoice_no, date,
  subtotal, discount, tax, transport, loading, other_cost, total, paid, due, status)
purchase_items(id, purchase_id, variant_id, qty, rate, landed_unit_cost)
sales(id, business_id, branch_id, customer_id, salesman_id, invoice_no, date,
  subtotal, discount, tax, total, paid, due, cogs, status)
sale_items(id, sale_id, variant_id, imei_id?, qty, price, unit_cost)
payments(id, business_id, direction[in|out], party_type, party_id, ref_type, ref_id,
  method, account_id, txn_id, amount, date)

stock(business_id, branch_id, variant_id, qty, avg_cost)  PK(branch, variant)
stock_movements(id, variant_id, branch_id, qty_change, unit_cost, ref_type, ref_id)

money_accounts(id, business_id, kind[cash|bank|mfs], name, bank, acct_no, opening_balance)
expenses(id, business_id, branch_id, category_id, account_id, amount, date, note, attachment)

accounts(id, business_id, code, name, type[asset|liability|equity|revenue|expense])
journal_entries(id, business_id, date, ref_type, ref_id, memo, reversed_by)
journal_lines(id, entry_id, account_id, debit, credit)   CHECK sum(debit)=sum(credit)

customer_ledger / supplier_ledger → SQL views over sales, payments, returns
audit_logs(id, business_id, user_id, module, action, record_id, old, new, at)
```

Audit reports retain the latest 30 days, include the actor, source table and
before/after values, and support numbered pages, full-range CSV export and
printing. A separate tenant-scoped, low-detail Realtime stream drives optional
in-app tones without granting regular members access to the protected audit
snapshots. Expired audit and notification rows are removed in scheduled batches.

## 6. Automatic journal rules

| Event            | Debit               | Credit                   |
| ---------------- | ------------------- | ------------------------ |
| Cash sale        | Cash/Bank           | Sales Revenue            |
| Credit sale      | Customer Due (AR)   | Sales Revenue            |
| Every sale       | COGS                | Inventory                |
| Customer payment | Cash/Bank           | Customer Due             |
| Purchase         | Inventory           | Supplier Due (AP) / Cash |
| Supplier payment | Supplier Due        | Cash/Bank                |
| Expense          | Expense account     | Cash/Bank                |
| Returns          | reverse of original |

## 7. Phases

1. Foundation: auth, onboarding (business type), branches, members/roles, products, brands, categories, customers, suppliers.
2. Core: purchase + IMEI + landed cost, sales + IMEI pick + price levels, stock, dues, payments.
3. Financial: cash, bank, expenses, accounting engine, ledgers, P&L, balance sheet, daily closing.
4. Advanced: dealers/credit override, warranty, commission, stock transfer, returns, reports.
5. Intelligence: analytics, alerts, forecasting, AI assistant (Bangla Q&A).
