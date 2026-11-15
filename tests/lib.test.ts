import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPhones, normalizeOne, formatPhone } from "../src/lib/phone.ts";
import { waLink, renderTemplate } from "../src/lib/whatsapp.ts";
import { detectMapping, prepareRow, dedupeKey } from "../src/lib/import-mapping.ts";
import { lineTotal, quoteTotals } from "../src/lib/quote-math.ts";
import { isPrivateIp, parseHtml } from "../src/lib/website-check.ts";
import { verifySignature, templateParams } from "../src/lib/whatsapp-cloud.ts";
import { createHmac } from "node:crypto";
import { fillTemplate, toHtml, nextGapMs, inSendWindow, colomboDayStart, nextStatus } from "../src/lib/email-core.ts";
import { verifySvix } from "../src/lib/email-signature.ts";

test("email templates, html escaping and unsubscribe footer", () => {
  assert.equal(fillTemplate("Hi {{contact_person}} at {{company}} – {{x}}", { company: "Lanka <Foods>" }), "Hi Sir/Madam at Lanka <Foods> – {{x}}");
  const html = toHtml("Hello <b>\n\nVisit https://pixhub.lk", "PIXhub.lk", "https://crm/u/abc");
  assert.match(html, /Hello &lt;b&gt;/);
  assert.match(html, /<a href="https:\/\/pixhub\.lk"/);
  assert.match(html, /Unsubscribe<\/a>/);
});

test("sending breaks and schedule (Colombo time)", () => {
  assert.equal(nextGapMs(2, 5, () => 0), 120_000);
  assert.equal(nextGapMs(2, 5, () => 1), 300_000);
  assert.equal(nextGapMs(0.2, 0.5, () => 0), 60_000, "never faster than 1 minute");
  const monday10 = new Date("2026-11-16T10:00:00+05:30");
  assert.equal(inSendWindow(monday10, 9, 17, [1, 2, 3, 4, 5]), true);
  assert.equal(inSendWindow(new Date("2026-11-16T08:59:00+05:30"), 9, 17, [1, 2, 3, 4, 5]), false);
  assert.equal(inSendWindow(new Date("2026-11-15T10:00:00+05:30"), 9, 17, [1, 2, 3, 4, 5]), false, "Sunday off");
  assert.equal(colomboDayStart(new Date("2026-11-16T02:00:00+05:30")).toISOString(), "2026-11-15T18:30:00.000Z");
});

test("Resend webhook signature and status ordering", () => {
  const secret = "whsec_" + Buffer.from("supersecretkey123").toString("base64");
  const body = '{"type":"email.delivered"}';
  const ts = "1794700000";
  const sig = createHmac("sha256", Buffer.from("supersecretkey123")).update(`msg_1.${ts}.${body}`).digest("base64");
  assert.equal(verifySvix(body, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, secret, 1794700100), true);
  assert.equal(verifySvix(body + " ", { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, secret, 1794700100), false);
  assert.equal(verifySvix(body, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, secret, 1794709999), false, "too old");
  assert.equal(nextStatus("sent", "delivered"), "delivered");
  assert.equal(nextStatus("opened", "delivered"), null);
  assert.equal(nextStatus("opened", "bounced"), "bounced");
  assert.equal(nextStatus("bounced", "delivered"), null);
});

test("website check blocks private addresses (SSRF)", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "203.94.1.1", "2606:4700::1111"]) assert.equal(isPrivateIp(ip), false, ip);
});

test("website check extracts only observable facts", () => {
  const r = parseHtml(`<html><head><title> Lanka &amp; Co </title><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Best spices in Kandy"></head><body>
    <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a><a href="https://www.facebook.com/lankaco">FB</a>
    <button>Add to cart</button></body></html>`);
  assert.equal(r.page_title, "Lanka & Co");
  assert.equal(r.meta_description, "Best spices in Kandy");
  assert.equal(r.mobile_friendly, true);
  assert.equal(r.facebook_link, "https://www.facebook.com/lankaco");
  assert.equal(r.has_ecommerce_signals, true);
  const bare = parseHtml("<html><body>Hello</body></html>");
  assert.deepEqual([bare.page_title, bare.mobile_friendly, bare.facebook_link, bare.has_ecommerce_signals], [null, false, null, false]);
});

test("WhatsApp webhook signature and template params", () => {
  const body = '{"object":"whatsapp_business_account"}';
  const sig = "sha256=" + createHmac("sha256", "secret").update(body).digest("hex");
  assert.equal(verifySignature(body, sig, "secret"), true);
  assert.equal(verifySignature(body, sig, "wrong"), false);
  assert.equal(verifySignature(body, null, "secret"), false);
  assert.equal(verifySignature(body + " ", sig, "secret"), false);
  assert.deepEqual(
    templateParams(["contact_person", "company", "services"], { company: "Lanka Foods", contact_person: null, city: "Galle", services: ["POS System"], sender: "Nimal" }),
    ["Sir/Madam", "Lanka Foods", "POS System"],
  );
});

test("quotation math matches the database trigger", () => {
  // Same figures as tests/db-rls.mjs: 159,000 subtotal, 4,000 discount, 18% tax → 182,900
  const lines = [{ quantity: 1, unit_price: 150000, discount_pct: 10 }, { quantity: 2, unit_price: 12000, discount_pct: 0 }];
  assert.equal(lineTotal(lines[0]), 135000);
  assert.deepEqual(quoteTotals(lines, 4000, 18), { subtotal: 159000, tax: 27900, total: 182900 });
  assert.deepEqual(quoteTotals([{ quantity: 3, unit_price: 333.33, discount_pct: 0 }], 0, 0), { subtotal: 999.99, tax: 0, total: 999.99 });
});

test("normalizes Sri Lankan mobile formats", () => {
  for (const raw of ["0771234567", "077 123 4567", "+94 77 123 4567", "94771234567", "0094771234567", "771234567", "077-123-4567"]) {
    assert.deepEqual(normalizeOne(raw), { e164: "+94771234567", kind: "mobile" }, raw);
  }
});

test("detects landlines and rejects invalid numbers", () => {
  assert.deepEqual(normalizeOne("011 2345678"), { e164: "+94112345678", kind: "landline" });
  assert.deepEqual(normalizeOne("0812345678"), { e164: "+94812345678", kind: "landline" });
  assert.equal(normalizeOne("0731234567"), null); // 073 is not a mobile prefix
  assert.equal(normalizeOne("12345"), null);
  assert.equal(normalizeOne("0771234"), null);
});

test("extracts multiple numbers from one cell, mobile first", () => {
  const r = extractPhones("011-2345678 / 0712345678");
  assert.equal(r.length, 2);
  assert.equal(r[0].e164, "+94712345678");
  assert.equal(r[1].kind, "landline");
  assert.deepEqual(extractPhones(771234567), [{ e164: "+94771234567", kind: "mobile" }]); // numeric Excel cell
  assert.equal(formatPhone("+94771234567"), "+94 77 123 4567");
});

test("WhatsApp links only for valid mobiles", () => {
  assert.equal(waLink("+94771234567"), "https://wa.me/94771234567");
  assert.equal(waLink("+94112345678"), null);
  assert.equal(waLink(null), null);
  assert.match(waLink("+94771234567", "Hi & bye")!, /\?text=Hi%20%26%20bye$/);
});

test("renders templates with fallbacks", () => {
  const out = renderTemplate("Hi {{contact_person}} at {{company}}: {{services}} – {{sender}} {{unknown}}", {
    company: "Lanka Foods", services: ["POS System", "Inventory Management", "SEO"],
  });
  assert.equal(out, "Hi Sir/Madam at Lanka Foods: POS System and Inventory Management – the PIXhub team {{unknown}}");
});

test("auto-detects column mapping", () => {
  const m = detectMapping(["Business Name", "Category", "Contact Person", "Mobile No", "Land Line", "E-mail", "District", "Town", "Address", "Web Site", "FB Page", "Remarks"]);
  assert.equal(m.company_name, "Business Name");
  assert.equal(m.industry, "Category");
  assert.equal(m.mobile, "Mobile No");
  assert.equal(m.landline, "Land Line");
  assert.equal(m.email, "E-mail");
  assert.equal(m.city, "Town");
  assert.equal(m.website, "Web Site");
  assert.equal(m.facebook_url, "FB Page");
  assert.equal(m.notes, "Remarks");
});

test("prepares rows, flags issues and builds dedupe keys", () => {
  const m = { company_name: "Name", mobile: "Phone", email: "Email", city: "City", website: "Web" } as const;
  const ok = prepareRow({ Name: " ABC  Hotel ", Phone: "0112345678 / 0771234567", Email: "Info@ABC.lk", City: "KANDY", Web: "abc.lk" }, m);
  assert.equal(ok.row?.company_name, "ABC Hotel");
  assert.equal(ok.row?.mobile, "+94771234567");
  assert.equal(ok.row?.landline, "+94112345678");
  assert.equal(ok.row?.email, "info@abc.lk");
  assert.equal(ok.row?.city, "Kandy");
  assert.equal(ok.row?.website, "https://abc.lk");
  assert.deepEqual(ok.issues, []);
  assert.equal(dedupeKey(ok.row!), "m:+94771234567");

  const bad = prepareRow({ Name: "XYZ Stores", Phone: "12345", Email: "nope", City: "Galle" }, m);
  assert.deepEqual(bad.issues, ["invalid_phone", "invalid_email"]);
  assert.equal(dedupeKey(bad.row!), "n:xyzstores|galle");

  assert.deepEqual(prepareRow({ Name: "" }, m).issues, ["missing_company"]);
});
