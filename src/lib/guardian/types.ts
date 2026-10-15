export type GuardianAlert = {
  id: string;
  check_code: string;
  severity: string;
  title: string;
  detail: string | null;
  ref_type: string | null;
  ref_id: string | null;
  status: string;
  first_seen: string;
  last_seen: string;
};
export type GuardianSnapshot = {
  checked_at: string;
  business_date: string;
  last_guardian_run: string | null;
  company: {
    name: string;
    type: string;
    phone: string | null;
    address: string | null;
    trade_license: string | null;
    currency: string;
    profile: Record<string, string>;
  };
  metrics: Record<string, number>;
  checks: { code: string; issues: number }[];
  alerts: GuardianAlert[];
  loss_sales: {
    id: string;
    invoice_no: string;
    sale_date: string;
    model: string;
    imei1: string;
    price: number;
    unit_cost: number;
    net_revenue: number;
    margin: number;
    discount: number;
    paid: number;
    due: number;
    customer_current_due: number;
    subsequent_party_receipts: number;
  }[];
  restock: {
    id: string;
    sku: string;
    model: string;
    storage: string | null;
    reorder_level: number;
    available: number;
    suggested_minimum: number;
  }[];
};
