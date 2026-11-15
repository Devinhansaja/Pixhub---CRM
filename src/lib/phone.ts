// Sri Lankan phone number normalisation.
// A valid result means the number has a valid *format* only — it does NOT mean
// the number is active or has a WhatsApp account.

export type PhoneKind = "mobile" | "landline";

export interface NormalizedPhone {
  e164: string; // +94XXXXXXXXX
  kind: PhoneKind;
}

// Mobile operator prefixes after the 0: 70,71,72,74,75,76,77,78
const MOBILE_RE = /^7[0124-8]\d{7}$/;
// Landlines: area codes 11–91 (2 digits) followed by 7 digits; excludes 7x mobiles
const LANDLINE_RE = /^(1[1-9]|2[1-7]|3[1-8]|4[1-7]|5[1-7]|6[3-7]|8[1-9]|9[1-9])\d{7}$/;

/** Normalise one candidate number to its 9-digit national significant number. */
function toNational(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("0094")) d = d.slice(4);
  else if (d.startsWith("94") && d.length === 11) d = d.slice(2);
  else if (d.startsWith("0") && d.length === 10) d = d.slice(1);
  // Excel often drops the leading 0, leaving 9 digits — already national.
  return d.length === 9 ? d : null;
}

export function normalizeOne(raw: string): NormalizedPhone | null {
  const n = toNational(raw);
  if (!n) return null;
  if (MOBILE_RE.test(n)) return { e164: `+94${n}`, kind: "mobile" };
  if (LANDLINE_RE.test(n)) return { e164: `+94${n}`, kind: "landline" };
  return null;
}

/**
 * A cell may hold several numbers ("077 123 4567 / 011-2345678").
 * Returns all valid numbers found, mobiles first.
 */
export function extractPhones(raw: unknown): NormalizedPhone[] {
  if (raw === null || raw === undefined) return [];
  const text = String(raw).trim();
  if (!text) return [];
  const parts = text.split(/[\/,;|\n]|\bor\b|&/i).map((p) => p.trim()).filter(Boolean);
  const out: NormalizedPhone[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const n = normalizeOne(p);
    if (n && !seen.has(n.e164)) {
      seen.add(n.e164);
      out.push(n);
    }
  }
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "mobile" ? -1 : 1));
}

/** Pretty display: +94 77 123 4567 */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const m = e164.match(/^\+94(\d{2})(\d{3})(\d{4})$/);
  return m ? `+94 ${m[1]} ${m[2]} ${m[3]}` : e164;
}
