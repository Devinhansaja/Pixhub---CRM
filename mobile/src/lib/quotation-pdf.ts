import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { formatDate, money } from "./format";

export interface QuotationForPdf {
  number: string; issue_date: string; expiry_date: string; currency: string; notes: string | null;
  subtotal: number; discount_amount: number; tax_rate: number; tax_amount: number; total: number;
  contact: { company_name: string; contact_person: string | null; address: string | null; email: string | null; mobile: string | null } | null;
  items: { description: string; quantity: number; unit_price: number; discount_pct: number; line_total: number }[];
  org: { name: string; address: string | null; phone: string | null; email: string | null; website: string | null } | null;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function html(q: QuotationForPdf) {
  const m = (n: number) => esc(money(n, q.currency));
  const rows = q.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.description)}</td><td class="r">${i.quantity}</td><td class="r">${m(i.unit_price)}</td><td class="r">${i.discount_pct ? `${i.discount_pct}%` : "—"}</td><td class="r">${m(i.line_total)}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;padding:32px;font-size:12px}
    .top{display:flex;justify-content:space-between;border-bottom:3px solid #2563eb;padding-bottom:16px}
    h1{margin:0;font-size:26px;color:#2563eb} h2{margin:0 0 4px;font-size:16px}
    .muted{color:#64748b} table{width:100%;border-collapse:collapse;margin-top:20px}
    th{background:#eff6ff;text-align:left;padding:8px;font-size:11px;text-transform:uppercase;color:#1d4ed8}
    td{padding:8px;border-bottom:1px solid #e2e8f0} .r{text-align:right}
    .tot{margin-left:auto;width:280px;margin-top:16px} .tot div{display:flex;justify-content:space-between;padding:4px 0}
    .grand{font-size:16px;font-weight:700;border-top:2px solid #0f172a;margin-top:4px;padding-top:8px!important}
    .notes{margin-top:28px;white-space:pre-wrap;background:#f8fafc;padding:12px;border-radius:8px}
  </style></head><body>
  <div class="top"><div><h1>${esc(q.org?.name ?? "PIXhub.lk")}</h1><div class="muted">${esc(q.org?.address ?? "")}<br>${esc([q.org?.phone, q.org?.email, q.org?.website].filter(Boolean).join(" · "))}</div></div>
  <div style="text-align:right"><h2>QUOTATION</h2><div><b>${esc(q.number)}</b></div><div class="muted">Date: ${esc(formatDate(q.issue_date))}<br>Valid until: ${esc(formatDate(q.expiry_date))}</div></div></div>
  <div style="margin-top:20px"><div class="muted">Prepared for</div><h2>${esc(q.contact?.company_name)}</h2><div class="muted">${esc([q.contact?.contact_person, q.contact?.address, q.contact?.mobile, q.contact?.email].filter(Boolean).join(" · "))}</div></div>
  <table><thead><tr><th>#</th><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Disc.</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="tot"><div><span>Subtotal</span><span>${m(q.subtotal)}</span></div>
  ${q.discount_amount ? `<div><span>Discount</span><span>- ${m(q.discount_amount)}</span></div>` : ""}
  ${q.tax_rate ? `<div><span>Tax (${q.tax_rate}%)</span><span>${m(q.tax_amount)}</span></div>` : ""}
  <div class="grand"><span>Total</span><span>${m(q.total)}</span></div></div>
  ${q.notes ? `<div class="notes"><b>Terms & notes</b><br>${esc(q.notes)}</div>` : ""}
  </body></html>`;
}

/** Builds the quotation PDF on the phone and opens the share sheet (WhatsApp, email, save to Files…). */
export async function shareQuotationPdf(q: QuotationForPdf) {
  const { uri } = await Print.printToFileAsync({ html: html(q) });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: `Quotation ${q.number}`, UTI: "com.adobe.pdf" });
  else await Print.printAsync({ uri });
}
