# FIROZA ENTERPRISE
## Retail & Wholesale Mobile Business Management & Accounting ERP
You are a senior **Product Architect, Business Analyst, UI/UX Designer, Database Architect, Full-Stack Engineer, Accounting-System Designer, and SaaS Product Strategist**.
Your task is to design and develop a complete, production-ready ERP software called:
# **FIROZA ENTERPRISE**
### Product Positioning
**FIROZA ENTERPRISE is a specialized business management and accounting ERP for mobile phone retailers, wholesalers, dealers, sub-dealers, and mobile accessory businesses.**
The system must manage the complete business lifecycle:
**Purchase → Inventory → IMEI → Sales → Customer → Due → Payment → Cash/Bank → Expense → Supplier → Accounting → Profit → Reports**
The system must NOT be designed as a generic accounting application. It must be specifically optimized for the **mobile phone retail and wholesale business in Bangladesh**.
---
# 1. PRIMARY TARGET USERS
The primary customers of FIROZA ENTERPRISE are:
### A. Retail Mobile Shop
Businesses that sell mobile phones and accessories directly to end customers.
Typical needs:
* Retail sales
* IMEI management
* Customer information
* Customer due
* Cash management
* Bank management
* Purchase
* Inventory
* Warranty
* Sales return
* Daily profit
* Daily closing
### B. Wholesale Mobile Dealer
Businesses that purchase large quantities from distributors/importers and sell to other mobile shops/dealers.
Typical needs:
* Bulk purchase
* Bulk sales
* Dealer management
* Multiple pricing levels
* Credit management
* Customer/dealer ledger
* Supplier ledger
* Large inventory
* IMEI tracking
* Warehouse
* Multiple branches
* Salesman management
* Commission
* Payment collection
* Advanced accounting
* Business reports
### C. Retail + Wholesale Business
Some businesses operate both retail and wholesale operations.
The system must support both simultaneously.
---
# 2. PRODUCT PRINCIPLE
The software must follow this principle:
> **One transaction should automatically update every related business record.**
For example, when a mobile phone is sold:
1. Sales invoice is created.
2. Product stock decreases.
3. IMEI status changes from `IN_STOCK` to `SOLD`.
4. Customer ledger is updated.
5. Cash/Bank balance is updated if payment is received.
6. Customer due is updated if credit is given.
7. Sales revenue is recorded.
8. Cost of goods sold is recorded.
9. Gross profit is calculated.
10. Relevant accounting journal entries are generated.
11. Audit log is created.
The user should never have to manually enter the same transaction in multiple modules.
---
# 3. BUSINESS TYPES
During business onboarding, ask:
```text
Select Business Type:
○ Retail Mobile Shop
○ Wholesale Mobile Dealer
○ Retail + Wholesale
```
The system should dynamically enable relevant modules based on the business type.
However, all modules must remain available to administrators.
---
# 4. MULTI-TENANT SaaS ARCHITECTURE
FIROZA ENTERPRISE must be designed as a SaaS application.
Each business/company is an independent tenant.
Example:
```text
FIROZA ENTERPRISE
│
├── Business A
│   ├── Branch 01
│   ├── Branch 02
│   └── Warehouse
│
├── Business B
│   ├── Main Shop
│   └── Warehouse
│
└── Business C
    └── Main Shop
```
Data belonging to one business must NEVER be visible to another business.
Implement proper tenant isolation at the database and application levels.
---
# 5. TECHNOLOGY STACK
Use a modern, scalable architecture.
Preferred stack:
### Frontend
* React
* TypeScript
* Tailwind CSS
* shadcn/ui
* React Query / TanStack Query
* React Hook Form
* Zod
* Responsive design
### Backend
* Node.js
* Express.js
* TypeScript
* REST API
* JWT/session-based authentication
* RBAC
* Validation
* Centralized error handling
### Database
Prefer:
**PostgreSQL**
because this is a transaction-heavy accounting and ERP system.
Use proper:
* Foreign keys
* Transactions
* Constraints
* Indexes
* Unique constraints
* Decimal/numeric financial fields
* Database-level data integrity
Do NOT use floating-point numbers for monetary calculations.
---
# 6. USER ROLES
Implement role-based access control.
Default roles:
```text
Super Admin
Business Owner
Manager
Accountant
Salesman
Store Keeper
Purchase Officer
Branch Manager
Viewer
```
Permissions must be granular.
Example:
```text
Sales:
  view
  create
  edit
  delete
  approve
  cancel
Purchase:
  view
  create
  edit
  delete
  approve
Customer:
  view
  create
  edit
  delete
Accounting:
  view
  create
  edit
  approve
```
Never rely only on frontend permission checks. Enforce permissions on the backend.
---
# 7. MAIN NAVIGATION
Create a professional ERP dashboard with the following sidebar:
```text
Dashboard
Sales
  ├── New Sale
  ├── Sales History
  ├── Sales Return
  └── Quotations
Purchase
  ├── New Purchase
  ├── Purchase History
  └── Purchase Return
Inventory
  ├── Stock
  ├── IMEI Management
  ├── Stock Transfer
  ├── Stock Adjustment
  └── Stock Valuation
Products
  ├── Products
  ├── Brands
  ├── Categories
  ├── Models
  └── Variants
Customers
  ├── Customers
  ├── Customer Ledger
  ├── Due Collection
  └── Customer Statements
Suppliers
  ├── Suppliers
  ├── Supplier Ledger
  └── Supplier Payments
Dealers
  ├── Dealer List
  ├── Dealer Ledger
  ├── Credit Management
  └── Dealer Statements
Cash
  ├── Cashbook
  ├── Cash In
  └── Cash Out
Banking
  ├── Bank Accounts
  ├── Bank Transactions
  └── Bank Transfer
Expenses
  ├── Expenses
  └── Expense Categories
Employees
  ├── Employees
  ├── Salesmen
  └── Commission
Warranty
  ├── Warranty
  └── Warranty Claims
Accounting
  ├── Chart of Accounts
  ├── Journal
  ├── General Ledger
  ├── Trial Balance
  ├── Profit & Loss
  └── Balance Sheet
Reports
Notifications
Audit Logs
Settings
```
---
# 8. DASHBOARD
Create different dashboards depending on user role and business type.
Main dashboard should display:
```text
Today's Sales
Today's Purchase
Today's Profit
Customer Due
Supplier Due
Cash Balance
Bank Balance
Stock Value
Total Customers
Total Suppliers
Total Products
Low Stock Items
Overdue Customers
Upcoming Supplier Payments
```
Charts:
* Sales trend
* Purchase trend
* Profit trend
* Top-selling products
* Brand-wise sales
* Customer outstanding
* Supplier outstanding
* Expense breakdown
Dashboard must support:
```text
Today
Yesterday
This Week
This Month
Last Month
Custom Date Range
```
---
# 9. PRODUCT MANAGEMENT
Create product hierarchy:
```text
Brand
  ↓
Model
  ↓
Variant
  ↓
IMEI
```
Example:
```text
Brand: Samsung
Model: Galaxy A56
Variant: 8GB / 256GB
Color: Graphite
```
Product fields:
* Brand
* Model
* SKU
* Category
* Variant
* RAM
* Storage
* Color
* Purchase Price
* Wholesale Price
* Dealer Price
* Retail Price
* Minimum Selling Price
* Reorder Level
* Warranty Period
* Status
Support:
* Mobile phones
* Tablets
* Feature phones
* Smart watches
* Chargers
* Cables
* Earphones
* Power banks
* Covers
* Tempered glass
* Other accessories
---
# 10. IMEI MANAGEMENT
IMEI is a core feature.
Each mobile phone may have:
* IMEI 1
* IMEI 2
* Serial Number
Track every device individually.
IMEI lifecycle:
```text
PURCHASED
↓
IN_STOCK
↓
RESERVED
↓
SOLD
↓
RETURNED
↓
WARRANTY
```
For every IMEI store:
* IMEI
* Product
* Variant
* Purchase invoice
* Supplier
* Purchase date
* Purchase cost
* Current branch
* Current warehouse
* Sale invoice
* Customer
* Sale date
* Sale price
* Warranty information
* Status
Provide a global IMEI search.
When a user searches an IMEI, show its complete history.
---
# 11. PURCHASE MANAGEMENT
Purchase workflow:
```text
Supplier
↓
Purchase Invoice
↓
Purchase Items
↓
IMEI Entry
↓
Stock Increase
↓
Supplier Payable
↓
Payment
↓
Accounting
```
Purchase fields:
* Supplier
* Invoice number
* Date
* Branch
* Warehouse
* Product
* IMEI
* Quantity
* Purchase rate
* Discount
* VAT/Tax if applicable
* Transport cost
* Other cost
* Total
* Paid
* Due
Support both:
### Cash Purchase
and
### Credit Purchase
---
# 12. LANDED COST
Allow additional purchase costs:
* Transport
* Loading
* Courier
* Insurance
* Other costs
Example:
```text
Product Purchase      ৳ 320,000
Transport             ৳   5,000
Loading               ৳   1,000
Other                  ৳   2,000
Actual Cost            ৳ 328,000
```
Allocate additional cost appropriately across purchase items.
---
# 13. SALES MANAGEMENT
Sales workflow:
```text
Customer
↓
Invoice
↓
Product Selection
↓
IMEI Selection
↓
Price
↓
Discount
↓
Payment
↓
Due
↓
Stock Update
↓
Accounting
```
Support:
* Cash sales
* Credit sales
* Partial payment
* Multiple payment methods
* Discount
* Customer-specific price
* Dealer price
* Wholesale price
* Retail price
---
# 14. MULTIPLE PRICE LEVELS
This is especially important for wholesale dealers.
Each product can have:
```text
Purchase Price
Wholesale Price
Dealer Price
Retail Price
Special Customer Price
Minimum Selling Price
```
Customer profile should contain a default price level.
Example:
```text
Rahman Mobile
Customer Type: Dealer
Price Level: Dealer Price
Credit Limit: ৳500,000
```
When creating a sale, the system should automatically suggest the appropriate price.
---
# 15. CUSTOMER MANAGEMENT
Customer types:
```text
Retail Customer
Retail Shop
Wholesale Dealer
Sub Dealer
Corporate Customer
VIP Customer
```
Customer profile:
* Name
* Business name
* Mobile
* Alternative mobile
* Address
* NID
* Trade license
* Customer type
* Price level
* Credit limit
* Payment terms
* Opening balance
* Status
* Notes
---
# 16. CUSTOMER LEDGER
Every customer must have a complete ledger.
Example:
```text
Opening Balance       ৳ 50,000
Sales                 ৳ 200,000
Payment              -৳ 120,000
Sales Return          -৳ 10,000
--------------------------------
Current Due           ৳ 120,000
```
Show:
* Total purchase
* Total payment
* Total return
* Current due
* Overdue
* Credit limit
* Available credit
---
# 17. CREDIT MANAGEMENT
For wholesale/dealer customers:
```text
Credit Limit
Current Due
Available Credit
Overdue Amount
Payment Terms
```
If a new sale exceeds the credit limit:
```text
WARNING:
Credit limit exceeded.
Manager approval required.
```
Allow authorized users to override the restriction.
Record the approval in audit logs.
---
# 18. SUPPLIER MANAGEMENT
Supplier profile:
* Name
* Company
* Contact person
* Mobile
* Address
* Bank information
* Opening payable
* Credit terms
* Notes
Supplier ledger:
```text
Opening Payable
+ Purchases
- Payments
- Purchase Returns
= Current Payable
```
---
# 19. CASH MANAGEMENT
Create multiple cash accounts if required.
Examples:
```text
Main Cash
Branch Cash
Counter Cash
Office Cash
```
Cash transactions:
* Sales receipt
* Customer payment
* Supplier payment
* Expense
* Cash transfer
* Bank deposit
* Bank withdrawal
* Other income
* Other adjustment
Provide daily cash closing.
---
# 20. BANK MANAGEMENT
Support multiple bank accounts.
Each bank account should contain:
* Bank
* Branch
* Account name
* Account number
* Opening balance
* Current balance
Transactions:
* Deposit
* Withdrawal
* Transfer
* Customer payment
* Supplier payment
* Bank charge
* Other transaction
Support bank reconciliation in a future phase.
---
# 21. PAYMENT METHODS
Support:
```text
Cash
Bank
bKash
Nagad
Rocket
Card
Cheque
Other
```
For digital payments, store:
* Transaction ID
* Reference
* Date
* Account
* Amount
---
# 22. EXPENSE MANAGEMENT
Expense categories:
```text
Rent
Salary
Electricity
Internet
Transport
Courier
Packaging
Marketing
Facebook Ads
Repair
Office Expense
Bank Charge
Government Fee
Other
```
Every expense must be connected to:
* Branch
* Account
* Date
* Category
* Amount
* Description
* Attachment
---
# 23. SALES RETURN
Sales return must automatically:
1. Update stock.
2. Update IMEI status.
3. Adjust customer ledger.
4. Adjust cash/bank if refund is made.
5. Reverse relevant accounting entries.
6. Maintain original invoice reference.
---
# 24. PURCHASE RETURN
Purchase return must:
1. Reduce stock.
2. Update IMEI status.
3. Reduce supplier payable.
4. Record supplier refund/adjustment.
5. Update accounting.
6. Maintain original purchase reference.
---
# 25. STOCK MANAGEMENT
Stock must support:
```text
Branch
Warehouse
Product
Variant
IMEI
Quantity
Cost
Selling Price
```
Stock reports:
* Current stock
* Available stock
* Reserved stock
* Sold stock
* Low stock
* Dead stock
* Stock valuation
* Fast-moving items
* Slow-moving items
---
# 26. STOCK TRANSFER
Support:
```text
Warehouse
↓
Branch
```
and:
```text
Branch A
↓
Branch B
```
Transfer workflow:
```text
Draft
↓
Approved
↓
Dispatched
↓
Received
```
Track IMEI-level transfers.
---
# 27. WARRANTY MANAGEMENT
Track warranty by IMEI.
Fields:
* Warranty provider
* Warranty start
* Warranty end
* Warranty type
* Warranty status
Warranty claim workflow:
```text
Customer
↓
IMEI Search
↓
Warranty Validation
↓
Claim
↓
Service / Replacement
↓
Resolution
```
---
# 28. SALESMAN & COMMISSION
Salesman profile:
* Name
* Mobile
* Branch
* Joining date
* Commission rule
Commission can be:
* Percentage of sales
* Fixed amount per device
* Product-based
* Brand-based
* Category-based
Example:
```text
Sales = ৳1,000,000
Commission = 1%
Commission = ৳10,000
```
---
# 29. ACCOUNTING ENGINE
Implement proper double-entry accounting.
Core account categories:
```text
Assets
Liabilities
Equity
Revenue
Expenses
```
Example assets:
```text
Cash
Bank
Inventory
Customer Receivable
```
Liabilities:
```text
Supplier Payable
Loan
Other Liability
```
Revenue:
```text
Mobile Sales
Accessories Sales
Other Income
```
Expenses:
```text
Rent
Salary
Transport
Marketing
Utilities
```
---
# 30. AUTOMATIC JOURNAL ENTRIES
Do not require users to manually create accounting entries for routine operations.
Example cash sale:
```text
Debit: Cash
Credit: Sales Revenue
Debit: Cost of Goods Sold
Credit: Inventory
```
Example credit sale:
```text
Debit: Customer Receivable
Credit: Sales Revenue
Debit: Cost of Goods Sold
Credit: Inventory
```
Example customer payment:
```text
Debit: Cash/Bank
Credit: Customer Receivable
```
Example supplier payment:
```text
Debit: Supplier Payable
Credit: Cash/Bank
```
All journal entries must be generated through controlled business transactions.
---
# 31. PROFIT CALCULATION
Calculate:
```text
Sales Revenue
-
Cost of Goods Sold
=
Gross Profit
Gross Profit
-
Operating Expenses
=
Net Profit
```
Profit reports should support:
* Invoice-level profit
* Product-level profit
* Brand-level profit
* Category-level profit
* Customer-level profit
* Dealer-level profit
* Salesman-level profit
* Branch-level profit
* Date-range profit
---
# 32. REPORTING SYSTEM
Create a comprehensive reporting module.
### Sales Reports
* Daily Sales
* Monthly Sales
* Product-wise Sales
* Brand-wise Sales
* Customer-wise Sales
* Dealer-wise Sales
* Salesman-wise Sales
* Branch-wise Sales
* IMEI Sales
### Purchase Reports
* Supplier-wise Purchase
* Product-wise Purchase
* Purchase Return
* Supplier Outstanding
### Inventory Reports
* Current Stock
* Stock Valuation
* Low Stock
* Dead Stock
* Fast Moving
* Slow Moving
* IMEI Report
### Financial Reports
* Cashbook
* Bankbook
* Customer Ledger
* Supplier Ledger
* Trial Balance
* General Ledger
* Profit & Loss
* Balance Sheet
* Cash Flow
---
# 33. DUE COLLECTION DASHBOARD
Show customer outstanding by aging:
```text
Current
1–7 Days
8–15 Days
16–30 Days
31–60 Days
60+ Days
```
Use clear visual indicators.
Do not make the interface unnecessarily colorful.
---
# 34. SUPPLIER PAYMENT DASHBOARD
Show:
```text
Supplier
Outstanding
Due Date
Overdue
Last Payment
Next Payment
```
Allow filtering by:
* Branch
* Supplier
* Date
* Amount
* Status
---
# 35. NOTIFICATION SYSTEM
Generate notifications for:
* Low stock
* Customer overdue
* Supplier payment due
* Credit limit exceeded
* Warranty expiry
* Pending approval
* Stock transfer pending
* Unusual transaction
* Daily closing not completed
---
# 36. AUDIT LOG
Every sensitive operation must be logged.
Record:
```text
User
Date
Time
Action
Module
Record
Old Value
New Value
IP/device if appropriate
```
Examples:
```text
Invoice edited
Invoice cancelled
Price changed
Due adjusted
Stock adjusted
Payment deleted
Expense edited
Journal entry modified
```
Financial transactions should preferably be cancelled/reversed rather than physically deleted.
---
# 37. DOCUMENT & ATTACHMENT MANAGEMENT
Allow attachment of:
* Purchase invoice
* Sales invoice
* Payment receipt
* Bank slip
* Expense bill
* Warranty document
* Delivery challan
* Other documents
---
# 38. MULTI-BRANCH
Support:
```text
Head Office
Branch 01
Branch 02
Branch 03
Warehouse 01
Warehouse 02
```
Every transaction should be associated with a branch/location where applicable.
Head office users should be able to view consolidated data.
Branch users should only access authorized branch data.
---
# 39. DAILY BUSINESS CLOSING
Create a Daily Closing feature.
At the end of the day:
```text
Opening Cash
+ Cash Sales
+ Customer Collection
+ Other Cash In
- Expenses
- Supplier Payment
- Other Cash Out
= Expected Closing Cash
```
Then:
```text
Expected Cash
vs
Actual Cash
```
Show variance.
Require authorized user confirmation.
---
# 40. SEARCH SYSTEM
Global search should support:
* Customer name
* Mobile number
* Invoice number
* IMEI
* Product
* Supplier
* Dealer
* Transaction ID
IMEI search must be extremely fast.
---
# 41. INVOICE SYSTEM
Generate professional invoices.
Invoice should contain:
* Business logo
* Business name
* Address
* Contact
* Invoice number
* Date
* Customer
* Product
* IMEI
* Quantity
* Unit price
* Discount
* Total
* Paid
* Due
* Payment method
* Warranty information
* Terms & conditions
Support:
* Print
* PDF
* Download
* Share
---
# 42. BANGLADESH BUSINESS CONTEXT
Design the system for Bangladesh.
Support:
* BDT currency
* Bangla and English labels
* Bangladesh mobile number format
* bKash
* Nagad
* Rocket
* Local banks
* NID field
* Trade License field
* VAT/Tax fields where applicable
* Bangla invoice printing
Do not hard-code tax rules that may change. Make tax configuration flexible.
---
# 43. UI/UX DESIGN
The UI must look like a modern professional SaaS ERP.
Design principles:
* Clean
* Fast
* Minimal
* Professional
* Mobile responsive
* Desktop optimized
* Easy for non-technical shop owners
* Large readable numbers
* Clear financial indicators
* Minimal unnecessary animations
Primary dashboard should prioritize:
```text
Sales
Due
Cash
Bank
Stock
Profit
```
Use cards, tables, filters, charts and quick-action buttons.
---
# 44. QUICK ACTIONS
Dashboard should provide:
```text
+ New Sale
+ New Purchase
+ Receive Payment
+ Pay Supplier
+ Add Expense
+ Stock Transfer
+ Add Customer
+ Add Supplier
```
---
# 45. DATABASE DESIGN
Create a normalized PostgreSQL schema.
Core tables should include at minimum:
```text
users
roles
permissions
user_roles
businesses
branches
warehouses
customers
customer_addresses
customer_ledgers
suppliers
supplier_ledgers
dealers
dealer_credit_limits
brands
categories
products
product_variants
product_imeis
purchases
purchase_items
purchase_payments
purchase_returns
purchase_return_items
sales
sale_items
sale_payments
sales_returns
sales_return_items
stock
stock_movements
stock_transfers
stock_transfer_items
cash_accounts
cash_transactions
bank_accounts
bank_transactions
expenses
expense_categories
employees
salesmen
commission_rules
commission_transactions
warranties
warranty_claims
accounts
journal_entries
journal_entry_items
loans
notifications
attachments
audit_logs
```
Add timestamps, indexes and appropriate foreign keys.
---
# 46. DATA INTEGRITY
Financial and stock transactions must use database transactions.
For example:
```text
Create Sale
+
Reduce Stock
+
Change IMEI Status
+
Update Customer Ledger
+
Create Payment
+
Create Journal Entries
```
must succeed together or fail together.
Never allow partially completed financial transactions.
---
# 47. SECURITY
Implement:
* Secure authentication
* Password hashing
* JWT/session security
* Role-based authorization
* Tenant isolation
* Input validation
* SQL injection protection
* Rate limiting
* Secure file upload
* Audit logs
* Protected APIs
* Secure environment variables
Never expose sensitive credentials in frontend code.
---
# 48. BACKUP & RECOVERY
Design:
* Automated database backup
* Backup retention
* Disaster recovery strategy
* Export capability
* Business data export
The owner should be able to export business data where appropriate.
---
# 49. ANALYTICS
Create business intelligence dashboards.
Examples:
### Product Analytics
```text
Top Selling
Slow Moving
High Profit
Low Profit
Dead Stock
```
### Customer Analytics
```text
Top Customers
Top Dealers
Highest Due
Best Paying Customers
Overdue Customers
```
### Financial Analytics
```text
Revenue
Gross Profit
Net Profit
Expenses
Cash Flow
Receivables
Payables
```
---
# 50. FUTURE AI FEATURES
Design the architecture so AI can be added later.
Possible AI features:
```text
Sales Forecast
Stock Demand Forecast
Customer Due Risk
Product Recommendation
Dead Stock Detection
Profit Analysis
Business Question Answering
```
Example:
User asks:
> "গত ৩ মাসে কোন ব্র্যান্ড থেকে সবচেয়ে বেশি লাভ হয়েছে?"
The system should eventually analyze business data and answer based on actual database records.
---
# 51. MOBILE EXPERIENCE
The system must be responsive.
On mobile:
Prioritize:
```text
Quick Sale
IMEI Search
Customer
Due Collection
Payment
Stock
Expense
Dashboard
```
Desktop should provide the complete ERP interface.
---
# 52. DEVELOPMENT APPROACH
Do NOT attempt to build everything simultaneously.
Build incrementally.
## Phase 1 — Foundation
```text
Authentication
Business
Branch
Users
Roles
Permissions
Products
Brands
Categories
Customers
Suppliers
```
## Phase 2 — Core Business
```text
Purchase
Sales
Inventory
IMEI
Customer Due
Supplier Due
Payments
```
## Phase 3 — Financial
```text
Cash
Bank
Expense
Accounting
Ledger
P&L
Balance Sheet
```
## Phase 4 — Advanced
```text
Dealer Management
Credit Management
Multiple Pricing
Warranty
Commission
Multi-branch
Stock Transfer
Advanced Reports
```
## Phase 5 — Intelligence
```text
Analytics
Alerts
Forecasting
AI Assistant
```
---
# 53. MVP PRIORITY
The MVP must NOT become unnecessarily large.
The first production MVP should focus on:
```text
1. Authentication
2. Business Setup
3. User & Roles
4. Product
5. Customer
6. Supplier
7. Purchase
8. Sales
9. IMEI
10. Inventory
11. Customer Due
12. Supplier Due
13. Cash
14. Bank
15. Expense
16. Basic Accounting
17. Dashboard
18. Reports
```
Only after these are stable should advanced modules be added.
---
# 54. DEMO DATA
Create realistic demo data for development/testing.
Example brands:
```text
Samsung
Apple
Xiaomi
Redmi
Realme
Oppo
Vivo
OnePlus
Tecno
Infinix
```
Create sample:
* Products
* IMEI numbers
* Customers
* Dealers
* Suppliers
* Purchases
* Sales
* Payments
* Expenses
* Banks
* Cash transactions
Do NOT use real people's sensitive information.
---
# 55. ERROR HANDLING
Every form should provide clear validation.
Examples:
```text
IMEI already exists.
Insufficient stock.
Customer credit limit exceeded.
Invalid payment amount.
Invoice already cancelled.
Cannot delete posted accounting transaction.
Invalid product.
Supplier is inactive.
```
Use user-friendly messages.
---
# 56. APPROVAL WORKFLOW
For sensitive operations:
```text
Purchase
Sale cancellation
Large discount
Credit limit override
Stock adjustment
Expense
Payment adjustment
Journal adjustment
```
allow configurable approval rules.
---
# 57. SYSTEM SETTINGS
Settings should include:
```text
Business Profile
Currency
Language
Invoice Settings
Numbering
Tax Configuration
Payment Methods
Price Levels
Credit Rules
Warranty Rules
Commission Rules
Notification Settings
User Roles
Branch Settings
```
---
# 58. IMPORTANT UX RULE
Do not overwhelm a small retail shop owner with enterprise accounting terminology.
The interface should present simple business language first.
For example:
Instead of forcing the user to understand:
```text
Accounts Receivable
```
show:
```text
Customer Due
```
Instead of:
```text
Accounts Payable
```
show:
```text
Supplier Due
```
Advanced accounting terminology can remain available under the Accounting module.
---
# 59. PRODUCT GOAL
FIROZA ENTERPRISE should answer these questions immediately:
### Sales
> আজ কত বিক্রি হয়েছে?
### Profit
> আজ/এই মাসে কত লাভ হয়েছে?
### Customer
> কার কাছে কত টাকা পাওনা?
### Supplier
> কাকে কত টাকা দিতে হবে?
### Inventory
> দোকানে কী কী আছে?
### IMEI
> এই ফোনটি কোথা থেকে এসেছে এবং কার কাছে বিক্রি হয়েছে?
### Cash
> হাতে কত টাকা আছে?
### Bank
> ব্যাংকে কত টাকা আছে?
### Business
> ব্যবসা আসলে লাভ করছে নাকি শুধু cash movement হচ্ছে?
---
# 60. FINAL PRODUCT STRUCTURE
The final system should be organized as:
```text
                         FIROZA ENTERPRISE
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
     SALES                 PURCHASE              INVENTORY
       │                      │                      │
   Customer                Supplier                IMEI
       │                      │                      │
       └──────────────┬───────┴──────────────┬───────┘
                      │                      │
                   PAYMENT                STOCK
                      │                      │
              ┌───────┴───────┐              │
              ↓               ↓              │
            CASH            BANK             │
              │               │              │
              └───────┬───────┘              │
                      ↓                      │
                 ACCOUNTING ←────────────────┘
                      │
              ┌───────┴────────┐
              ↓                ↓
          PROFIT/LOSS       BALANCE SHEET
              │
              ↓
           REPORTS
              │
              ↓
        BUSINESS ANALYTICS
```
---
# 61. IMPLEMENTATION INSTRUCTION TO THE AI DEVELOPER
Do not merely generate static screens.
Build the application as a **real working ERP**.
For every module:
1. Define the business requirement.
2. Define database entities.
3. Define relationships.
4. Define API endpoints.
5. Define validation.
6. Define permissions.
7. Define transaction logic.
8. Define frontend screens.
9. Define loading/error/empty states.
10. Define test cases.
11. Implement.
12. Test.
13. Fix issues.
14. Only then proceed to the next module.
Maintain consistency across all modules.
Do not duplicate business logic unnecessarily.
Use reusable components and services.
Use database transactions for all financial and inventory-critical operations.
---
# 62. DEVELOPMENT RULE
When implementing the project, always prioritize:
```text
Business correctness
>
Data integrity
>
Security
>
Accounting accuracy
>
Inventory accuracy
>
Usability
>
Performance
>
Visual design
```
A beautiful UI with incorrect accounting is NOT acceptable.
---
# 63. FINAL EXPECTATION
The final product should feel like a professional commercial SaaS product specifically built for:
**Bangladesh's mobile phone retail and wholesale business sector.**
It should be:
* Easy for a small retailer
* Powerful for a wholesale dealer
* Scalable for multi-branch businesses
* Accurate for financial accounting
* Reliable for IMEI tracking
* Useful for customer/dealer credit management
* Suitable for daily business operations
* Suitable for future mobile applications
* Ready for future AI-powered analytics
The product name must consistently appear as:
# **FIROZA ENTERPRISE**
Use the tagline:
> **“মোবাইল ব্যবসার সম্পূর্ণ ডিজিটাল ব্যবস্থাপনা”**
Do not use placeholder screens as the final implementation. Build each module with real data models, real CRUD operations, real relationships, proper validation, permissions, transaction handling and interconnected business logic.
Start with **Product Architecture + Database ERD + Module Dependency Map**, then proceed phase-by-phase rather than attempting the entire system blindly in one step.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://mobilederp.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/93800b66-be81-4646-adf3-a75e17b73006).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

# firozaerp
