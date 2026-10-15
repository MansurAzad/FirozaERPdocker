# Guardian review — 12 October 2026

## Delivered and checked
- Owner overview uses a fresh tenant-scoped database snapshot. All 17 deterministic checks pass against the current records: journals, sale/purchase totals, stock movements, serialized stock, sold-device links, warranty replacement review, negative balances, customer/supplier/inventory/money controls, duplicate invoices, return quantities and payment links.
- Authenticated AI chat and a follow-up returned the correct loss. Stop clears loading; conversation does not persist after reload. Wrong-business requests return 403 and signed-out requests return 401.
- Company profile save and reload passed; temporary verification value was restored.
- Anomaly severity/period filters and PDF/Excel downloads passed.
- Voice transcript-to-editable-input and denied-permission fallback passed with controlled browser events. Real microphone recognition and audible playback require testing on the user's device.
- Manual Check now previously failed with “DELETE requires a WHERE clause”; temporary-table cleanup now has a scoped predicate. The live check completes and updates both alerts and last-run time.
- Guardian loss evidence now includes discount. RESERVED devices are counted consistently in stock checks.
- Backup export/restore includes Guardian tables and company context. Destructive restore/reset were inspected, not executed against the live business.
- Status-only warranty replacement is blocked because it previously closed a claim without recording a replacement IMEI or stock/accounting transaction. Existing replacement claims are included in Guardian review; a full replacement workflow is not implemented.

## Safe review of the two findings
**INV-000001:** price ৳100,000 less discount ৳500 yields revenue ৳99,500 against recorded cost ৳150,000: loss **৳50,500**. Verify supplier cost and sale documents. Retain a genuine loss; correct an entry error only through an approved return/re-entry matching actual device and money movements. No sale, payment or stock records were corrected automatically.

The invoice's ৳500 due is its posting-time value. Subsequent unallocated party receipts explain current Customer Due of ৳0; this is not a sync discrepancy. Party receipts total ৳50,500 and include earlier opening-balance settlement, not only the invoice's ৳500.

**NOTE9 512:** available stock is zero and reorder trigger is five. Check physical stock per branch, pending transfers, demand, supplier terms and funds. Five is not an approved order quantity. Enter a distinct IMEI for every received device.

## Scope and limitations
This is a current-record consistency audit plus end-to-end verification of the new Guardian flows, not certification that every old form, permission role, return path or concurrent-device scenario has been exercised. Periodic active-query refresh (60 seconds), focus refresh and mutation invalidation provide eventual refresh, not instantaneous realtime sync. The hourly Guardian schedule remains enabled; an entire later scheduled cycle was not observed during this turn. AI briefings are on demand; no scheduled AI/approval workflow was added. Project-wide lint still contains pre-existing formatting and any-type errors; new Guardian files are checked separately.