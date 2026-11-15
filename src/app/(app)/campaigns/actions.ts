"use server";

import { revalidatePath } from "next/cache";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { applyLeadFilters, leadSelect, type LeadFilters } from "@/lib/leads-query";
import { fillTemplate, toHtml, toText } from "@/lib/email-core";
import { resendConfigured, sendViaResend } from "@/lib/resend";

type Result<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AUDIENCE = 20000;

export interface Audience { import?: string; industry?: string; district?: string; city?: string; service?: string; min_score?: string; stage?: string; owner?: string; q?: string }

export interface CampaignInput {
  id?: string;
  name: string; subject: string; body: string; audience: Audience;
  followup_enabled: boolean; followup_days: number;
  followup1_subject?: string; followup1_body?: string; followup2_subject?: string; followup2_body?: string;
  daily_limit: number; min_gap_minutes: number; max_gap_minutes: number;
  send_start_hour: number; send_end_hour: number; send_days: number[];
  ai_review: boolean; max_bounce_rate: number;
}

async function manager() {
  const me = await requireProfile();
  if (me.role === "sales_executive") throw new Error("Only managers and admins can run email campaigns");
  return me;
}

const wrap = async <T>(fn: () => Promise<Result<T>>): Promise<Result<T>> => {
  try { return await fn(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" }; }
};

function cleanAudience(a: Audience): Audience {
  const out: Audience = {};
  for (const k of ["import", "industry", "district", "city", "service", "min_score", "stage", "owner", "q"] as const) {
    const v = typeof a?.[k] === "string" ? a[k]!.trim().slice(0, 120) : "";
    if (v) out[k] = v;
  }
  return out;
}

/** Leads a campaign would reach: matches the filters, has an email, not opted out, not bounced. */
function audienceQuery(supabase: ReturnType<typeof createClient>, a: Audience, meId: string, columns: string, opts?: { count?: "exact" }) {
  const f = { ...cleanAudience(a), sort: "score" } as LeadFilters;
  let q = supabase.from("contacts").select(leadSelect(f, columns), opts);
  q = applyLeadFilters(q, f, meId);
  return q.not("email", "is", null).eq("do_not_contact", false).not("email_status", "in", "(bounced,complained)");
}

export async function previewAudience(a: Audience) {
  return wrap(async () => {
    const me = await manager();
    const supabase = createClient();
    const { data, count, error } = await audienceQuery(supabase, a, me.id, "id,company_name,email,city", { count: "exact" }).limit(5);
    if (error) throw new Error(error.message);
    return { ok: true, data: { count: count ?? 0, sample: (data ?? []) as unknown as { id: string; company_name: string; email: string; city: string | null }[] } };
  });
}

function validate(c: CampaignInput): string | null {
  if (!c.name?.trim()) return "Give the campaign a name";
  if (!c.subject?.trim() || c.subject.length > 200) return "Subject is required (max 200 characters)";
  if (!c.body?.trim() || c.body.length > 8000) return "Email text is required (max 8,000 characters)";
  if (!(c.daily_limit >= 1 && c.daily_limit <= 2000)) return "Emails per day must be 1–2,000";
  if (!(c.min_gap_minutes >= 1)) return "The shortest break must be at least 1 minute";
  if (!(c.max_gap_minutes >= c.min_gap_minutes)) return "The longest break must be at least the shortest break";
  if (!(c.send_end_hour > c.send_start_hour)) return "Sending end time must be after start time";
  if (!c.send_days?.length) return "Pick at least one sending day";
  if (c.followup_enabled && !c.followup1_body?.trim()) return "Write follow-up 1, or switch follow-ups off";
  if (!(c.followup_days >= 1 && c.followup_days <= 30)) return "Follow-up wait must be 1–30 days";
  return null;
}

export async function saveCampaign(c: CampaignInput) {
  return wrap<{ id: string }>(async () => {
    const me = await manager();
    const err = validate(c);
    if (err) return { ok: false, error: err };
    const row = {
      name: c.name.trim().slice(0, 150), subject: c.subject.trim(), body: c.body.trim(), audience: cleanAudience(c.audience),
      followup_enabled: !!c.followup_enabled, followup_days: Math.round(c.followup_days),
      followup1_subject: c.followup1_subject?.trim() || null, followup1_body: c.followup1_body?.trim() || null,
      followup2_subject: c.followup2_subject?.trim() || null, followup2_body: c.followup2_body?.trim() || null,
      daily_limit: Math.round(c.daily_limit), min_gap_minutes: c.min_gap_minutes, max_gap_minutes: c.max_gap_minutes,
      send_start_hour: Math.round(c.send_start_hour), send_end_hour: Math.round(c.send_end_hour),
      send_days: [...new Set(c.send_days.map(Number))].filter((d) => d >= 1 && d <= 7).sort(),
      ai_review: !!c.ai_review, max_bounce_rate: c.max_bounce_rate,
    };
    const supabase = createClient();
    if (c.id) {
      if (!UUID.test(c.id)) return { ok: false, error: "Invalid campaign" };
      const { data: cur } = await supabase.from("email_campaigns").select("status").eq("id", c.id).single();
      // Speed/schedule can change any time; content only while draft
      const contentEditable = cur?.status === "draft";
      const patch = contentEditable ? row : {
        daily_limit: row.daily_limit, min_gap_minutes: row.min_gap_minutes, max_gap_minutes: row.max_gap_minutes,
        send_start_hour: row.send_start_hour, send_end_hour: row.send_end_hour, send_days: row.send_days,
        followup_days: row.followup_days, max_bounce_rate: row.max_bounce_rate, name: row.name,
      };
      const { error } = await supabase.from("email_campaigns").update(patch).eq("id", c.id);
      if (error) return { ok: false, error: error.message };
      revalidatePath(`/campaigns/${c.id}`);
      return { ok: true, data: { id: c.id }, message: contentEditable ? "Saved" : "Speed and schedule saved (email text is locked after approval)" };
    }
    const { data, error } = await supabase.from("email_campaigns").insert({ ...row, created_by: me.id }).select("id").single();
    if (error) return { ok: false, error: error.message };
    revalidatePath("/campaigns");
    return { ok: true, data: { id: data.id } };
  });
}

async function setStatus(id: string, status: string, extra: Record<string, unknown> = {}): Promise<Result> {
  if (!UUID.test(id)) return { ok: false, error: "Invalid campaign" };
  const supabase = createClient();
  const { data, error } = await supabase.from("email_campaigns").update({ status, ...extra }).eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Campaign not found" };
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/campaigns");
  return { ok: true };
}

export async function submitCampaign(id: string) { return wrap(async () => { await manager(); return setStatus(id, "pending_approval", { review_note: null }); }); }
export async function approveCampaign(id: string) { return wrap(async () => { await manager(); return setStatus(id, "approved", { review_note: null }); }); }
export async function requestChanges(id: string, note: string) {
  return wrap(async () => {
    await manager();
    if (!note.trim()) return { ok: false, error: "Explain what to change" };
    return setStatus(id, "draft", { review_note: note.trim().slice(0, 1000) });
  });
}
export async function backToDraft(id: string) { return wrap(async () => { await manager(); return setStatus(id, "draft"); }); }
export async function pauseCampaign(id: string) { return wrap(async () => { await manager(); return setStatus(id, "paused", { paused_reason: "Paused by a user" }); }); }
export async function resumeCampaign(id: string) { return wrap(async () => { await manager(); return setStatus(id, "sending", { paused_reason: null, next_send_at: null }); }); }

export async function cancelCampaign(id: string) {
  return wrap(async () => {
    await manager();
    const r = await setStatus(id, "cancelled");
    if (!r.ok) return r;
    await createClient().from("email_messages").update({ status: "skipped", error: "Campaign cancelled" }).eq("campaign_id", id).eq("status", "queued");
    return { ok: true };
  });
}

/** Queues the first email for every lead in the audience, then starts sending. */
export async function startCampaign(id: string) {
  return wrap<{ queued: number }>(async () => {
    const me = await manager();
    if (!UUID.test(id)) return { ok: false, error: "Invalid campaign" };
    if (!resendConfigured()) return { ok: false, error: "Email sending isn't set up yet (RESEND_API_KEY missing on the server)." };
    const supabase = createClient();
    const { data: c } = await supabase.from("email_campaigns").select("id,status,audience").eq("id", id).single();
    if (!c) return { ok: false, error: "Campaign not found" };
    if (c.status !== "approved") return { ok: false, error: "The campaign must be approved first" };
    let queued = 0;
    for (let from = 0; from < MAX_AUDIENCE; from += 1000) {
      const { data, error } = await audienceQuery(supabase, c.audience as Audience, me.id, "id,email").range(from, from + 999);
      if (error) return { ok: false, error: error.message };
      const rows = (data ?? []) as unknown as { id: string; email: string }[];
      if (!rows.length) break;
      const { data: ins, error: insErr } = await supabase.from("email_messages")
        .upsert(rows.map((r) => ({ campaign_id: id, contact_id: r.id, to_email: r.email, step: 0 })), { onConflict: "campaign_id,contact_id,step", ignoreDuplicates: true })
        .select("id");
      if (insErr) return { ok: false, error: insErr.message };
      queued += ins?.length ?? 0;
      if (rows.length < 1000) break;
    }
    if (!queued) return { ok: false, error: "No leads with an email address match this audience." };
    const r = await setStatus(id, "sending", { started_at: new Date().toISOString(), next_send_at: null, paused_reason: null });
    if (!r.ok) return r;
    return { ok: true, data: { queued }, message: `${queued} emails queued. Sending starts within a minute, at your chosen pace.` };
  });
}

/** Sends one sample of the campaign email (filled with a real lead's details) to your own inbox. */
export async function sendTestEmail(id: string) {
  return wrap(async () => {
    const me = await manager();
    if (!resendConfigured()) return { ok: false, error: "Email sending isn't set up yet (RESEND_API_KEY missing)." };
    const supabase = createClient();
    const [{ data: c }, { data: settings }] = await Promise.all([
      supabase.from("email_campaigns").select("subject,body,audience").eq("id", id).single(),
      supabase.from("system_settings").select("value").eq("key", "email").maybeSingle(),
    ]);
    if (!c) return { ok: false, error: "Campaign not found" };
    const { data: sample } = await audienceQuery(supabase, c.audience as Audience, me.id, "company_name,contact_person,city").limit(1);
    const lead = ((sample ?? []) as unknown as { company_name: string; contact_person: string | null; city: string | null }[])[0]
      ?? { company_name: "Sample Company", contact_person: null, city: "Colombo" };
    const cfg = (settings?.value ?? {}) as { from_name?: string; from_email?: string; reply_to?: string; footer?: string };
    const vars = { company: lead.company_name, contact_person: lead.contact_person, city: lead.city, services: [], sender: me.full_name };
    const body = fillTemplate(c.body, vars);
    const unsub = `${(process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "")}/api/unsubscribe/00000000-0000-0000-0000-000000000000`;
    await sendViaResend({
      from: `${cfg.from_name || "PIXhub.lk"} <${process.env.EMAIL_FROM_ADDRESS || cfg.from_email || "hello@pixhub.lk"}>`,
      to: me.email, subject: `[TEST] ${fillTemplate(c.subject, vars)}`, replyTo: cfg.reply_to || undefined, unsubscribeUrl: unsub,
      html: toHtml(body, cfg.footer || "PIXhub.lk", unsub), text: toText(body, cfg.footer || "PIXhub.lk", unsub),
    });
    return { ok: true, message: `Test email sent to ${me.email} (using ${lead.company_name}'s details).` };
  });
}

export async function deleteCampaign(id: string) {
  return wrap(async () => {
    await manager();
    if (!UUID.test(id)) return { ok: false, error: "Invalid campaign" };
    const { data, error } = await createClient().from("email_campaigns").delete().eq("id", id).select("id");
    if (error) return { ok: false, error: error.message };
    if (!data?.length) return { ok: false, error: "Only draft campaigns you created (or any, as admin) can be deleted" };
    revalidatePath("/campaigns");
    return { ok: true };
  });
}

/** Staff record that a lead replied to an email: stops its follow-ups. */
export async function markEmailReplied(contactId: string) {
  return wrap(async () => {
    await requireProfile();
    if (!UUID.test(contactId)) return { ok: false, error: "Invalid lead" };
    const { data, error } = await createClient().rpc("mark_email_replied", { p_contact: contactId });
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/leads/${contactId}`);
    return { ok: true, message: `Reply recorded${data ? ` — ${data} follow-up(s) cancelled` : ""}.` };
  });
}

export async function saveEmailSettings(form: FormData) {
  return wrap(async () => {
    const me = await requireProfile();
    if (me.role !== "admin") return { ok: false, error: "Admins only" };
    const v = (k: string) => String(form.get(k) ?? "").trim().slice(0, 300);
    const from_email = v("from_email"), reply_to = v("reply_to");
    const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    if (!emailRe.test(from_email)) return { ok: false, error: "Sender email isn't valid" };
    if (reply_to && !emailRe.test(reply_to)) return { ok: false, error: "Reply-to email isn't valid" };
    if (!v("footer")) return { ok: false, error: "Add a footer with your business name and address (required for bulk email)" };
    const { error } = await createClient().from("system_settings").upsert({
      key: "email", value: { from_name: v("from_name") || "PIXhub.lk", from_email, reply_to, footer: v("footer") }, updated_by: me.id, updated_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/settings");
    return { ok: true, message: "Email settings saved" };
  });
}
