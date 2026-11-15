"use server";

import { revalidatePath } from "next/cache";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { checkWebsite, type WebsiteCheck } from "@/lib/website-check";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function enrichOne(contactId: string, userId: string): Promise<WebsiteCheck | { skipped: string }> {
  const supabase = createClient();
  const { data: c } = await supabase.from("contacts").select("id,website,facebook_url").eq("id", contactId).maybeSingle();
  if (!c) return { skipped: "Lead not found" };
  if (!c.website) return { skipped: "No website on file" };

  const r = await checkWebsite(c.website);
  const now = new Date().toISOString();
  const { error } = await supabase.from("lead_enrichment").insert({ contact_id: c.id, checked_by: userId, checked_at: now, ...r });
  if (error) return { skipped: error.message };

  const patch: Record<string, unknown> = {
    website_verified_at: now, website_verified_source: r.final_url ?? r.source_url, website_is_live: r.is_live,
  };
  // A Facebook link published on the company's own website is a verifiable fact.
  if (!c.facebook_url && r.facebook_link) patch.facebook_url = r.facebook_link;
  await supabase.from("contacts").update(patch).eq("id", c.id);
  await supabase.from("deal_activities").insert({
    contact_id: c.id, type: "system", created_by: userId,
    description: `Website checked: ${r.is_live ? `live (HTTP ${r.http_status})` : `not reachable${r.error ? ` – ${r.error}` : ""}`} · ${r.final_url ?? r.source_url}`
      + (patch.facebook_url ? ` · Facebook link found on site: ${r.facebook_link}` : ""),
  });
  if (patch.facebook_url) await supabase.rpc("classify_contacts", { p_ids: [c.id] }); // refresh data-gap suggestions
  return r;
}

export async function enrichLead(contactId: string) {
  const me = await requireProfile();
  if (!UUID.test(contactId)) return { ok: false as const, error: "Invalid lead" };
  const r = await enrichOne(contactId, me.id);
  revalidatePath(`/leads/${contactId}`);
  if ("skipped" in r) return { ok: false as const, error: r.skipped };
  return { ok: true as const, message: r.is_live ? `Website is live (HTTP ${r.http_status})` : `Website not reachable${r.error ? `: ${r.error}` : ""}` };
}

/** Managers/admins: check up to 25 accessible leads whose website hasn't been verified yet. */
export async function enrichBatch() {
  const me = await requireProfile();
  if (me.role === "sales_executive") return { ok: false as const, error: "Only managers and admins can run batch checks" };
  const supabase = createClient();
  const { data, error } = await supabase.from("contacts").select("id")
    .not("website", "is", null).is("website_verified_at", null)
    .order("lead_score", { ascending: false }).limit(25);
  if (error) return { ok: false as const, error: error.message };
  const ids = (data ?? []).map((d) => d.id);
  let live = 0, down = 0, skipped = 0;
  for (let i = 0; i < ids.length; i += 5) {
    const results = await Promise.all(ids.slice(i, i + 5).map((id) => enrichOne(id, me.id)));
    for (const r of results) { if ("skipped" in r) skipped++; else if (r.is_live) live++; else down++; }
  }
  revalidatePath("/classification");
  return { ok: true as const, message: ids.length ? `Checked ${ids.length} websites: ${live} live, ${down} not reachable${skipped ? `, ${skipped} skipped` : ""}.` : "No unchecked websites left." };
}
