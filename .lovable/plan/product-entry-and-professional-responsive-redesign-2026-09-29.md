# Product Entry and Professional Responsive Redesign

## What will change
- Make SKU automatic when adding a product, while keeping a clear optional manual override.
- Show IMEI requirements inside the product form for serialized categories and provide a direct “Save & add stock/IMEI” path.
- Keep IMEI creation inside Purchase receiving so branch, supplier, cost, stock, and accounting remain correct.
- Allow the Purchase page to open with the newly created product already selected, where one or two IMEIs can be entered per unit.
- Apply the selected Professional Slate Dashboard direction across the app shell and shared page elements.
- Improve mobile navigation, header actions, forms, tables, empty states, and dense sales/purchase screens.

## Product and IMEI flow
```text
Add Product
  ├─ SKU generated automatically
  ├─ IMEI tracking shown from selected category
  └─ Save & Add Stock / IMEI
       → New Purchase (product preselected)
       → supplier + branch + cost + IMEI entry
       → stock, IMEI history, supplier due, accounts updated together
```

## Technical details
- Add a tenant-scoped database SKU generator as the source of truth, retaining the existing unique business + SKU rule.
- Update Products and New Purchase without creating a second IMEI write path.
- Refine semantic slate/green/amber design tokens and shared Button, Input, Table, page header, and app navigation styles.
- Preserve all current routes, permissions, accounting rules, and inventory RPCs.
- Verify signed-in desktop and mobile Product → Purchase/IMEI flow, plus current build and runtime diagnostics.
