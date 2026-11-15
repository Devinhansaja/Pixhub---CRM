import { extractPhones } from "./phone.ts";

export function normalizeUrl(u: unknown): string | null {
  const s = String(u ?? "").trim();
  if (!s || s === "-" || /^n\/?a$/i.test(s)) return null;
  if (/^https?:\/\//i.test(s)) return s.slice(0, 500);
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/i.test(s)) return `https://${s}`.slice(0, 500);
  return null;
}

export const CRM_FIELDS = [
  { key: "company_name", label: "Company Name", required: true },
  { key: "industry", label: "Industry / Business Category" },
  { key: "contact_person", label: "Contact Person" },
  { key: "mobile", label: "Mobile Number" },
  { key: "landline", label: "Landline" },
  { key: "email", label: "Email" },
  { key: "district", label: "District" },
  { key: "city", label: "City" },
  { key: "address", label: "Address" },
  { key: "website", label: "Website" },
  { key: "facebook_url", label: "Facebook Page URL" },
  { key: "notes", label: "Notes" },
] as const;

export type CrmField = (typeof CRM_FIELDS)[number]["key"];
export type Mapping = Partial<Record<CrmField, string>>;

const SYNONYMS: Record<CrmField, string[]> = {
  company_name: ["company name", "company", "business name", "business", "name of business", "organization", "organisation", "shop name", "name"],
  industry: ["industry", "category", "business category", "type", "business type", "sector", "nature of business"],
  contact_person: ["contact person", "contact name", "owner", "owner name", "person", "manager", "contact"],
  mobile: ["mobile", "mobile number", "mobile no", "cell", "phone", "phone number", "telephone", "tel", "contact number", "whatsapp", "hotline"],
  landline: ["landline", "land line", "fixed line", "office phone", "tel office", "land phone"],
  email: ["email", "e-mail", "email address", "mail"],
  district: ["district"],
  city: ["city", "town", "area", "location"],
  address: ["address", "street", "full address"],
  website: ["website", "web", "web site", "url", "site"],
  facebook_url: ["facebook", "facebook page", "facebook url", "fb", "fb page"],
  notes: ["notes", "note", "remarks", "comment", "comments", "description"],
};

const norm = (s: string) => s.toLowerCase().replace(/[_\-.#:]/g, " ").replace(/\s+/g, " ").trim();

/** Auto-detect column mapping: exact synonym match first, then "contains". */
export function detectMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<string>();
  for (const pass of ["exact", "contains"] as const) {
    for (const f of CRM_FIELDS) {
      if (mapping[f.key]) continue;
      const hit = headers.find((h) => {
        if (used.has(h)) return false;
        const n = norm(h);
        return SYNONYMS[f.key].some((s) => (pass === "exact" ? n === s : n.includes(s) && s.length > 3));
      });
      if (hit) {
        mapping[f.key] = hit;
        used.add(hit);
      }
    }
  }
  return mapping;
}

export interface PreparedRow {
  company_name: string;
  industry: string | null;
  contact_person: string | null;
  mobile_raw: string | null;
  mobile: string | null;
  landline: string | null;
  email: string | null;
  district: string | null;
  city: string | null;
  address: string | null;
  website: string | null;
  facebook_url: string | null;
  notes: string | null;
}

export type RowIssue = "missing_company" | "invalid_phone" | "no_phone" | "invalid_email";

const text = (v: unknown, max = 500): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s && s !== "-" ? s.slice(0, max) : null;
};

const titleCase = (s: string | null) =>
  s ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : null;

export function prepareRow(raw: Record<string, unknown>, m: Mapping): { row: PreparedRow | null; issues: RowIssue[] } {
  const get = (f: CrmField) => (m[f] ? raw[m[f] as string] : undefined);
  const issues: RowIssue[] = [];
  const company = text(get("company_name"), 300);
  if (!company) return { row: null, issues: ["missing_company"] };

  const mobileCell = text(get("mobile"));
  const landCell = text(get("landline"));
  const phones = [...extractPhones(mobileCell), ...extractPhones(landCell)];
  const mobile = phones.find((p) => p.kind === "mobile")?.e164 ?? null;
  const landline = phones.find((p) => p.kind === "landline")?.e164 ?? null;
  if (!mobileCell && !landCell) issues.push("no_phone");
  else if (!mobile && !landline) issues.push("invalid_phone");

  let email = text(get("email"), 200)?.toLowerCase() ?? null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    issues.push("invalid_email");
    email = null;
  }

  const fbRaw = text(get("facebook_url"));
  const facebook = fbRaw && /facebook\.com|fb\.com|fb\.me/i.test(fbRaw) ? normalizeUrl(fbRaw) : null;

  return {
    row: {
      company_name: company,
      industry: text(get("industry"), 200),
      contact_person: text(get("contact_person"), 200),
      mobile_raw: mobileCell,
      mobile,
      landline,
      email,
      district: titleCase(text(get("district"), 100)),
      city: titleCase(text(get("city"), 100)),
      address: text(get("address"), 500),
      website: normalizeUrl(get("website")),
      facebook_url: facebook,
      notes: text(get("notes"), 2000),
    },
    issues,
  };
}

/** Mirrors the SQL generated column `contacts.dedupe_key`. */
export function dedupeKey(r: Pick<PreparedRow, "mobile" | "company_name" | "city">): string {
  return r.mobile
    ? `m:${r.mobile}`
    : `n:${r.company_name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}|${(r.city ?? "").toLowerCase()}`;
}
