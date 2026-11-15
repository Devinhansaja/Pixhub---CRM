// Formatting helpers (Sri Lanka: LKR, Asia/Colombo = UTC+05:30, no DST).
const COLOMBO_OFFSET_MIN = 330;

export function money(n: number | string | null | undefined, currency = "LKR") {
  const v = Number(n ?? 0);
  return `${currency} ${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function compact(n: number | null | undefined) {
  const v = Number(n ?? 0);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(v) >= 10_000) return `${Math.round(v / 1000)}k`;
  return v.toLocaleString("en-US");
}

/** Shift a date so its UTC fields read as Colombo wall-clock time. */
const colombo = (d: Date) => new Date(d.getTime() + COLOMBO_OFFSET_MIN * 60_000);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

export function formatDate(v: string | Date | null | undefined, withTime = false) {
  if (!v) return "—";
  const d = colombo(new Date(v));
  if (Number.isNaN(d.getTime())) return "—";
  const s = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return withTime ? `${s}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : s;
}

export function relative(v: string | null | undefined) {
  if (!v) return "";
  const diff = new Date(v).getTime() - Date.now();
  const abs = Math.abs(diff);
  const m = Math.round(abs / 60_000), h = Math.round(abs / 3_600_000), dd = Math.round(abs / 86_400_000);
  const txt = m < 1 ? "now" : m < 60 ? `${m} min` : h < 24 ? `${h} h` : `${dd} d`;
  if (txt === "now") return "just now";
  return diff < 0 ? `${txt} ago` : `in ${txt}`;
}

/** Start of today in Colombo, as a UTC ISO string. */
export function colomboDayStart(offsetDays = 0) {
  const c = colombo(new Date());
  const start = Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate() + offsetDays) - COLOMBO_OFFSET_MIN * 60_000;
  return new Date(start).toISOString();
}

export function initials(name: string | null | undefined) {
  const p = (name ?? "?").trim().split(/\s+/);
  return ((p[0]?.[0] ?? "?") + (p[1]?.[0] ?? "")).toUpperCase();
}

// ---- Sri Lankan phone numbers (same rules as the web CRM) ----
const MOBILE_RE = /^7[0124-8]\d{7}$/;
const LANDLINE_RE = /^(1[1-9]|2[1-7]|3[1-8]|4[1-7]|5[1-7]|6[3-7]|8[1-9]|9[1-9])\d{7}$/;

export function normalizePhone(raw: string): { e164: string; kind: "mobile" | "landline" } | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0094")) d = d.slice(4);
  else if (d.startsWith("94") && d.length === 11) d = d.slice(2);
  else if (d.startsWith("0") && d.length === 10) d = d.slice(1);
  if (d.length !== 9) return null;
  if (MOBILE_RE.test(d)) return { e164: `+94${d}`, kind: "mobile" };
  if (LANDLINE_RE.test(d)) return { e164: `+94${d}`, kind: "landline" };
  return null;
}

export function formatPhone(e164: string | null | undefined) {
  if (!e164) return "";
  const m = e164.match(/^\+94(\d{2})(\d{3})(\d{4})$/);
  return m ? `+94 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

export function normalizeUrl(v: string | null | undefined) {
  const s = (v ?? "").trim();
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}
