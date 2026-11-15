import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface PdfQuotation {
  number: string; status: string; issue_date: string; expiry_date: string; notes: string | null;
  subtotal: number; discount_amount: number; tax_rate: number; tax_amount: number; total: number;
  approved: boolean;
  org: { name: string; legal_name: string | null; address: string | null; phone: string | null; email: string | null; website: string | null; tax_reg_no: string | null };
  customer: { company_name: string; contact_person: string | null; address: string | null; city: string | null; district: string | null; email: string | null; mobile: string | null };
  items: { description: string; quantity: number; unit_price: number; discount_pct: number; line_total: number }[];
}

const NAVY = rgb(0x0a / 255, 0x25 / 255, 0x40 / 255);
const BLUE = rgb(0, 0x52 / 255, 0xcc / 255);
const GREY = rgb(0.4, 0.45, 0.5);
const LINE = rgb(0.88, 0.9, 0.93);

/** Standard PDF fonts only support WinAnsi; replace anything else so generation never fails. */
export function pdfSafe(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")
    .replace(/…/g, "...").replace(/→/g, "->").replace(/\t/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x0A\x20-\x7E\xA0-\xFF]/g, "?");
}

const money = (n: number) => "LKR " + new Intl.NumberFormat("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const date = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Colombo" });

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) <= width) line = test;
      else {
        if (line) out.push(line);
        // hard-break very long words
        let w = word;
        while (font.widthOfTextAtSize(w, size) > width) {
          let i = w.length;
          while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > width) i--;
          out.push(w.slice(0, i));
          w = w.slice(i);
        }
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

export async function renderQuotationPdf(q: PdfQuotation): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Quotation ${q.number}`);
  doc.setAuthor(q.org.name);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 48;
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;

  const text = (t: string, x: number, yy: number, size = 9, f = font, color = rgb(0.1, 0.12, 0.15)) =>
    page.drawText(pdfSafe(t), { x, y: yy, size, font: f, color });
  const right = (t: string, xr: number, yy: number, size = 9, f = font, color = rgb(0.1, 0.12, 0.15)) =>
    text(t, xr - f.widthOfTextAtSize(pdfSafe(t), size), yy, size, f, color);

  const watermark = () => {
    if (!q.approved) page.drawText("DRAFT", { x: 150, y: 380, size: 110, font: bold, color: rgb(0.93, 0.94, 0.96), rotate: degrees(35) });
  };
  watermark();

  // Header band
  page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: BLUE });
  text(q.org.name, M, y - 10, 18, bold, NAVY);
  let hy = y - 26;
  for (const l of [q.org.legal_name, q.org.address, [q.org.phone, q.org.email].filter(Boolean).join("  |  "), q.org.website, q.org.tax_reg_no ? `Tax reg. no: ${q.org.tax_reg_no}` : null]) {
    if (l) { text(l, M, hy, 8.5, font, GREY); hy -= 11; }
  }
  right("QUOTATION", W - M, y - 10, 20, bold, BLUE);
  right(q.number, W - M, y - 28, 10, bold);
  right(`Date: ${date(q.issue_date)}`, W - M, y - 42, 9);
  right(`Valid until: ${date(q.expiry_date)}`, W - M, y - 54, 9);
  y = Math.min(hy, y - 66) - 16;

  // Bill to
  text("PREPARED FOR", M, y, 8, bold, GREY);
  y -= 14;
  text(q.customer.company_name, M, y, 11, bold);
  y -= 13;
  for (const l of [q.customer.contact_person ? `Attn: ${q.customer.contact_person}` : null, q.customer.address, [q.customer.city, q.customer.district].filter(Boolean).join(", "), [q.customer.mobile, q.customer.email].filter(Boolean).join("  |  ")]) {
    if (l) { text(l, M, y, 9, font, GREY); y -= 12; }
  }
  y -= 14;

  // Items table
  const cols = { desc: M + 6, qty: 360, price: 440, disc: 478, total: W - M - 6 };
  const descWidth = cols.qty - 40 - cols.desc;
  const header = () => {
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: NAVY });
    text("Description", cols.desc, y, 8.5, bold, rgb(1, 1, 1));
    right("Qty", cols.qty, y, 8.5, bold, rgb(1, 1, 1));
    right("Unit price", cols.price, y, 8.5, bold, rgb(1, 1, 1));
    right("Disc.", cols.disc + 18, y, 8.5, bold, rgb(1, 1, 1));
    right("Amount", cols.total, y, 8.5, bold, rgb(1, 1, 1));
    y -= 22;
  };
  header();
  for (const it of q.items) {
    const lines = wrap(it.description, font, 9, descWidth);
    const h = lines.length * 11 + 8;
    if (y - h < 140) { page = doc.addPage([W, H]); watermark(); y = H - M; header(); }
    lines.forEach((l, i) => text(l, cols.desc, y - i * 11, 9));
    right(String(Number(it.quantity)), cols.qty, y, 9);
    right(money(it.unit_price).replace("LKR ", ""), cols.price, y, 9);
    right(it.discount_pct ? `${Number(it.discount_pct)}%` : "-", cols.disc + 18, y, 9);
    right(money(it.line_total).replace("LKR ", ""), cols.total, y, 9);
    y -= h;
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.5, color: LINE });
  }

  // Totals
  if (y < 170) { page = doc.addPage([W, H]); watermark(); y = H - M; }
  y -= 8;
  const row = (label: string, value: string, strong = false) => {
    right(label, 440, y, strong ? 11 : 9, strong ? bold : font, strong ? NAVY : GREY);
    right(value, W - M - 6, y, strong ? 11 : 9, strong ? bold : font, strong ? NAVY : undefined);
    y -= strong ? 18 : 14;
  };
  row("Subtotal", money(q.subtotal));
  if (q.discount_amount > 0) row("Discount", `- ${money(q.discount_amount)}`);
  if (q.tax_rate > 0) row(`Tax (${Number(q.tax_rate)}%)`, money(q.tax_amount));
  page.drawLine({ start: { x: 330, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 1, color: NAVY });
  y -= 4;
  row("TOTAL", money(q.total), true);

  // Notes
  if (q.notes) {
    y -= 10;
    text("NOTES & TERMS", M, y, 8, bold, GREY);
    y -= 13;
    for (const l of wrap(q.notes, font, 9, W - 2 * M)) {
      if (y < 70) { page = doc.addPage([W, H]); watermark(); y = H - M; }
      text(l, M, y, 9, font, rgb(0.25, 0.28, 0.32));
      y -= 12;
    }
  }

  // Footer on every page
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 46 }, end: { x: W - M, y: 46 }, thickness: 0.5, color: LINE });
    p.drawText(pdfSafe(`${q.org.name} - Quotation ${q.number} - valid until ${date(q.expiry_date)}`), { x: M, y: 32, size: 7.5, font, color: GREY });
    const pn = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pn, { x: W - M - font.widthOfTextAtSize(pn, 7.5), y: 32, size: 7.5, font, color: GREY });
  });

  return doc.save();
}
