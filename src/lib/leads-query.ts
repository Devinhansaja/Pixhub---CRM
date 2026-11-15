import type { SupabaseClient } from "@supabase/supabase-js";
import { STAGES } from "./constants";
import { sanitizeSearch } from "./utils";

export interface LeadFilters {
  q?: string;
  stage?: string;
  district?: string;
  industry?: string;
  service?: string;
  owner?: string; // profile id | "unassigned" | "me"
  min_score?: string;
  mobile?: string; // "valid" | "none"
  followup?: string; // "overdue"
  import?: string; // lead_imports id — leads from one uploaded file
  has?: string; // "website" | "no_website" | "email" | "no_email" | "facebook" | "no_facebook"
  city?: string;
  sort?: string; // "score" | "recent" | "name" | "followup" | "contacted"
  page?: string;
}

export const PAGE_SIZE = 50;

const isUuid = (s?: string) => !!s && /^[0-9a-f-]{36}$/i.test(s);

/** Applies the leads-table filters. `select` must embed `svc:lead_service_recommendations!inner(service_id)` when filtering by service. */
export function applyLeadFilters<T>(query: T, f: LeadFilters, userId: string): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = query as any;
  const search = f.q ? sanitizeSearch(f.q) : "";
  if (search) {
    const digits = search.replace(/\D/g, "");
    const ors = [`company_name.ilike.*${search}*`, `contact_person.ilike.*${search}*`, `email.ilike.*${search}*`];
    if (digits.length >= 5) ors.push(`mobile.ilike.*${digits.slice(-9)}*`, `landline.ilike.*${digits.slice(-9)}*`);
    q = q.or(ors.join(","));
  }
  if (f.stage && STAGES.some((s) => s.value === f.stage)) q = q.eq("stage", f.stage);
  if (f.district) q = q.eq("district", f.district);
  if (f.industry) q = q.eq("industry", f.industry);
  if (isUuid(f.service)) q = q.eq("svc.service_id", f.service);
  if (f.owner === "unassigned") q = q.is("assigned_to", null);
  else if (f.owner === "me") q = q.eq("assigned_to", userId);
  else if (isUuid(f.owner)) q = q.eq("assigned_to", f.owner);
  const min = Number(f.min_score);
  if (Number.isFinite(min) && min > 0) q = q.gte("lead_score", min);
  if (f.mobile === "valid") q = q.not("mobile", "is", null);
  if (f.mobile === "none") q = q.is("mobile", null);
  if (f.followup === "overdue") q = q.lt("next_follow_up_at", new Date().toISOString());
  if (isUuid(f.import)) q = q.eq("import_id", f.import);
  const city = f.city ? sanitizeSearch(f.city) : "";
  if (city) q = q.ilike("city", `%${city}%`);
  const hasCol: Record<string, [string, boolean]> = {
    website: ["website", true], no_website: ["website", false],
    email: ["email", true], no_email: ["email", false],
    facebook: ["facebook_url", true], no_facebook: ["facebook_url", false],
  };
  if (f.has && hasCol[f.has]) {
    const [col, present] = hasCol[f.has];
    q = present ? q.not(col, "is", null) : q.is(col, null);
  }

  switch (f.sort) {
    case "recent": q = q.order("created_at", { ascending: false }); break;
    case "name": q = q.order("company_name"); break;
    case "followup": q = q.order("next_follow_up_at", { ascending: true, nullsFirst: false }); break;
    case "contacted": q = q.order("last_contacted_at", { ascending: false, nullsFirst: false }); break;
    default: q = q.order("lead_score", { ascending: false }).order("company_name");
  }
  return q as T;
}

export function leadSelect(f: LeadFilters, base: string): string {
  return isUuid(f.service) ? `${base},svc:lead_service_recommendations!inner(service_id)` : base;
}

export async function loadAssignees(supabase: SupabaseClient) {
  const { data } = await supabase
    .from("profiles")
    .select("id,full_name,role,manager_id")
    .eq("is_active", true)
    .order("full_name");
  return (data ?? []) as { id: string; full_name: string; role: string; manager_id: string | null }[];
}
