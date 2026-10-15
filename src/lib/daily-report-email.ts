import { totals, type BranchSummary } from "./daily-summary";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const tk = (n: number) =>
  "৳" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TEAL = "#0f6b63", INK = "#173c3a", BRASS = "#d9a845", PAPER = "#f3f8f5";

/** Builds one plain, readable report email (inline styles only, white body). */
export function dailyReportEmail(company: string, title: string, date: string, rows: BranchSummary[]) {
  const t = totals(rows);
  const tiles: [string, string, number][] = [
    ["বিক্রি", "Sales", t.sales], ["মোট লাভ", "Gross profit", t.grossProfit],
    ["খরচ", "Expenses", t.expenses], ["নিট ফলাফল", "Net result", t.netResult],
    ["নতুন বাকি", "New customer due", t.due], ["ক্রয়", "Purchases", t.purchases],
    ["স্টক মূল্য", "Stock value", t.stockValue],
  ];
  const tileHtml = tiles.map(([bn, en, v]) => `
    <tr><td style="padding:10px 14px;border-bottom:1px solid #e3ece8;color:${INK};font-size:14px">${bn} <span style="color:#6b8481">· ${en}</span></td>
    <td style="padding:10px 14px;border-bottom:1px solid #e3ece8;text-align:right;font-weight:700;font-size:15px;color:${v < 0 ? "#b42318" : INK}">${tk(v)}</td></tr>`).join("");
  const rowHtml = rows.map((r) => `
    <tr><td style="padding:8px 10px;border-bottom:1px solid #eef3f1">${esc(r.name)}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eef3f1;text-align:right">${Number(r.sales_count)}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eef3f1;text-align:right">${tk(r.sales_total - r.returns_total)}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eef3f1;text-align:right">${tk(r.expenses_total)}</td>
    <td style="padding:8px 10px;border-bottom:1px solid #eef3f1;text-align:right">${tk(r.stock_value)}</td></tr>`).join("");
  const subject = `${company} — ${title} — ${date}`;
  const html = `<!doctype html><html><body style="margin:0;background:#ffffff;font-family:Arial,'Hind Siliguri',sans-serif;color:${INK}">
  <div style="max-width:620px;margin:0 auto;padding:24px 16px">
    <div style="background:${INK};color:#fff;border-radius:10px 10px 0 0;padding:20px 22px">
      <div style="font-size:20px;font-weight:700;letter-spacing:.5px">${esc(company)}</div>
      <div style="height:3px;width:40px;background:${BRASS};margin:10px 0"></div>
      <div style="font-size:16px">${esc(title)}</div>
      <div style="font-size:13px;opacity:.8">দৈনিক হিসাব · ${esc(date)}</div>
    </div>
    <div style="background:${PAPER};padding:18px 16px;border-radius:0 0 10px 10px">
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px">${tileHtml}</table>
      <p style="font-size:13px;color:#6b8481;margin:14px 2px">${t.salesCount} টি বিক্রি · স্টক ${t.stockUnits} pcs</p>
      ${rows.length ? `<table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px;font-size:13px">
        <tr style="background:${TEAL};color:#fff"><th style="padding:8px 10px;text-align:left">শাখা / শপ</th><th style="padding:8px 10px;text-align:right">Invoice</th><th style="padding:8px 10px;text-align:right">বিক্রি</th><th style="padding:8px 10px;text-align:right">খরচ</th><th style="padding:8px 10px;text-align:right">স্টক</th></tr>
        ${rowHtml}</table>` : ""}
      <p style="font-size:12px;color:#6b8481;margin-top:18px">বিক্রি = ফেরত বাদে · নিট ফলাফল = মোট লাভ − খরচ। এই ইমেইল স্বয়ংক্রিয়ভাবে পাঠানো হয়েছে।</p>
    </div>
  </div></body></html>`;
  return { subject, html };
}
