"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { STAGES, OUTREACH } from "@/lib/constants";
import { extractPhones } from "@/lib/phone";
import { normalizeUrl } from "@/lib/import-mapping";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: string): ActionResult => ({ ok: false, error });
const str = (v: unknown, max = 500) => {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
};

async function logActivity(contactId: string, type: string, description: string, metadata: Record<string, unknown> = {}) {
  const supabase = createClient();
  const profile = await requireProfile();
  await supabase.from("deal_activities").insert({ contact_id: contactId, type, description, metadata, created_by: profile.id });
}

export async function updateStage(contactId: string, stage: string): Promise<ActionResult> {
  if (!UUID.test(contactId) || !STAGES.some((s) => s.value === stage)) return fail("Invalid input");
  const supabase = createClient();
  const { data: before } = await supabase.from("contacts").select("stage").eq("id", contactId).single();
  const { error } = await supabase.from("contacts").update({ stage }).eq("id", contactId);
  if (error) return fail(error.message);
  await logActivity(contactId, "stage_change", `Stage changed from ${before?.stage ?? "?"} to ${stage}`, { from: before?.stage, to: stage });
  revalidatePath(`/leads/${contactId}`);
  revalidatePath("/pipeline");
  return { ok: true };
}

export async function updateLeadDetails(contactId: string, form: FormData): Promise<ActionResult> {
  if (!UUID.test(contactId)) return fail("Invalid lead");
  const company = str(form.get("company_name"), 300);
  if (!company) return fail("Company name is required");

  const mobileIn = str(form.get("mobile"));
  const landIn = str(form.get("landline"));
  const mobile = mobileIn ? extractPhones(mobileIn).find((p) => p.kind === "mobile")?.e164 : null;
  if (mobileIn && !mobile) return fail("Mobile number is not a valid Sri Lankan mobile (07X XXX XXXX)");
  const landline = landIn ? extractPhones(landIn)[0]?.e164 : null;
  if (landIn && !landline) return fail("Landline number is not valid");
  const email = str(form.get("email"), 200)?.toLowerCase() ?? null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("Email is not valid");
  const valueRaw = str(form.get("estimated_value"));
  const estimated_value = valueRaw ? Number(valueRaw.replace(/,/g, "")) : null;
  if (estimated_value !== null && (!Number.isFinite(estimated_value) || estimated_value < 0)) return fail("Estimated value must be a positive number");

  const supabase = createClient();
  const { error } = await supabase.from("contacts").update({
    company_name: company,
    industry: str(form.get("industry"), 200),
    contact_person: str(form.get("contact_person"), 200),
    mobile, landline, email,
    district: str(form.get("district"), 100),
    city: str(form.get("city"), 100),
    address: str(form.get("address")),
    website: normalizeUrl(form.get("website")),
    facebook_url: normalizeUrl(form.get("facebook_url")),
    notes: str(form.get("notes"), 2000),
    estimated_value,
  }).eq("id", contactId);
  if (error) return fail(error.code === "23505" ? "Another lead already uses this mobile number" : error.message);
  revalidatePath(`/leads/${contactId}`);
  return { ok: true, message: "Saved" };
}

export async function assignLeads(contactIds: string[], assigneeId: string | null): Promise<ActionResult> {
  const profile = await requireProfile();
  if (profile.role === "sales_executive") return fail("Only managers and admins can assign leads");
  const ids = contactIds.filter((id) => UUID.test(id)).slice(0, 1000);
  if (!ids.length) return fail("No leads selected");
  if (assigneeId !== null && !UUID.test(assigneeId)) return fail("Invalid assignee");

  const supabase = createClient();
  const { data, error } = await supabase.from("contacts").update({ assigned_to: assigneeId }).in("id", ids).select("id");
  if (error) return fail(error.message);
  let name = "Unassigned";
  if (assigneeId) {
    const { data: p } = await supabase.from("profiles").select("full_name").eq("id", assigneeId).single();
    name = p?.full_name ?? "user";
    await supabase.from("notifications").insert({
      user_id: assigneeId,
      title: `${data?.length ?? 0} lead(s) assigned to you`,
      body: `Assigned by ${profile.full_name}`,
      link: "/leads?owner=me",
    });
  }
  await supabase.from("deal_activities").insert(
    (data ?? []).map((r) => ({ contact_id: r.id, type: "assignment", description: `Assigned to ${name} by ${profile.full_name}`, created_by: profile.id })),
  );
  revalidatePath("/leads");
  return { ok: true, message: `${data?.length ?? 0} lead(s) assigned to ${name}` };
}

export async function addNote(contactId: string, text: string): Promise<ActionResult> {
  const note = str(text, 5000);
  if (!UUID.test(contactId) || !note) return fail("Note cannot be empty");
  await logActivity(contactId, "note", note);
  revalidatePath(`/leads/${contactId}`);
  return { ok: true };
}

export async function addFollowUp(contactId: string, form: FormData): Promise<ActionResult> {
  const profile = await requireProfile();
  const due = str(form.get("due_at"));
  const channel = str(form.get("channel")) ?? "whatsapp";
  const note = str(form.get("note"), 1000);
  const assignee = str(form.get("assigned_to")) ?? profile.id;
  if (!UUID.test(contactId) || !due) return fail("Choose a date and time");
  const dueDate = new Date(`${due}:00+05:30`);
  if (Number.isNaN(dueDate.getTime())) return fail("Invalid date");
  if (!["whatsapp", "call", "email", "meeting", "visit"].includes(channel)) return fail("Invalid channel");
  if (!UUID.test(assignee)) return fail("Invalid assignee");

  const supabase = createClient();
  const { error } = await supabase.from("follow_ups").insert({
    contact_id: contactId, due_at: dueDate.toISOString(), channel, note, assigned_to: assignee, created_by: profile.id,
  });
  if (error) return fail(error.message);
  await logActivity(contactId, "system", `Follow-up scheduled (${channel}) for ${dueDate.toLocaleString("en-GB", { timeZone: "Asia/Colombo" })}`);
  revalidatePath(`/leads/${contactId}`);
  revalidatePath("/tasks");
  return { ok: true };
}

export async function setFollowUpStatus(id: string, status: "done" | "cancelled" | "missed"): Promise<ActionResult> {
  if (!UUID.test(id) || !["done", "cancelled", "missed"].includes(status)) return fail("Invalid input");
  const supabase = createClient();
  const { data, error } = await supabase
    .from("follow_ups")
    .update({ status, completed_at: new Date().toISOString() })
    .eq("id", id)
    .select("contact_id")
    .single();
  if (error) return fail(error.message);
  revalidatePath(`/leads/${data.contact_id}`);
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function rescheduleFollowUp(id: string, due: string): Promise<ActionResult> {
  const d = new Date(`${due}:00+05:30`);
  if (!UUID.test(id) || Number.isNaN(d.getTime())) return fail("Invalid date");
  const supabase = createClient();
  const { error } = await supabase.from("follow_ups").update({ due_at: d.toISOString() }).eq("id", id);
  if (error) return fail(error.message);
  revalidatePath("/tasks");
  return { ok: true };
}

/**
 * Records a WhatsApp outreach step. "chat_opened" only means the link was opened;
 * "contacted" must be confirmed by the user after they actually sent the message.
 */
export async function logOutreach(contactId: string, status: string, body?: string | null, templateId?: string | null): Promise<ActionResult> {
  if (!UUID.test(contactId) || !OUTREACH.some((o) => o.value === status) || status === "none") return fail("Invalid status");
  const profile = await requireProfile();
  const supabase = createClient();
  const inbound = status === "replied";
  const { error } = await supabase.from("communication_logs").insert({
    contact_id: contactId,
    channel: "whatsapp",
    direction: inbound ? "inbound" : "outbound",
    status,
    body: str(body, 4000),
    template_id: templateId && UUID.test(templateId) ? templateId : null,
    source: "manual",
    created_by: profile.id,
  });
  if (error) return fail(error.message.includes("do-not-contact") ? "This contact is marked do-not-contact" : error.message);
  const label = OUTREACH.find((o) => o.value === status)!.label;
  await logActivity(contactId, "whatsapp", `WhatsApp: ${label}`, { status });
  revalidatePath(`/leads/${contactId}`);
  revalidatePath("/whatsapp");
  return { ok: true };
}

export async function setDoNotContact(contactId: string, dnc: boolean, reason?: string): Promise<ActionResult> {
  if (!UUID.test(contactId)) return fail("Invalid lead");
  const supabase = createClient();
  const { error } = await supabase
    .from("contacts")
    .update({ do_not_contact: dnc, opt_out_reason: dnc ? str(reason, 300) ?? "Requested no contact" : null })
    .eq("id", contactId);
  if (error) return fail(error.message);
  await logActivity(contactId, "system", dnc ? `Marked do-not-contact: ${reason || "Requested no contact"}` : "Do-not-contact removed");
  revalidatePath(`/leads/${contactId}`);
  return { ok: true };
}

/** Records a manual check of website / Facebook — stored with timestamp and source URL. */
export async function recordVerification(contactId: string, kind: "website" | "facebook", isLive: boolean, sourceUrl: string): Promise<ActionResult> {
  const src = normalizeUrl(sourceUrl);
  if (!UUID.test(contactId) || !src) return fail("Enter the URL you checked");
  const supabase = createClient();
  const now = new Date().toISOString();
  const patch = kind === "website"
    ? { website_verified_at: now, website_verified_source: src, website_is_live: isLive }
    : { facebook_verified_at: now, facebook_verified_source: src, facebook_is_active: isLive };
  const { error } = await supabase.from("contacts").update(patch).eq("id", contactId);
  if (error) return fail(error.message);
  await logActivity(contactId, "system", `${kind === "website" ? "Website" : "Facebook page"} checked manually: ${isLive ? "live/active" : "not live/inactive"} (${src})`);
  revalidatePath(`/leads/${contactId}`);
  return { ok: true };
}

export async function addRecommendation(contactId: string, serviceId: string, reason: string): Promise<ActionResult> {
  const r = str(reason, 500);
  if (!UUID.test(contactId) || !UUID.test(serviceId) || !r) return fail("Choose a service and give a reason");
  const supabase = createClient();
  const { error } = await supabase.from("lead_service_recommendations").upsert(
    { contact_id: contactId, service_id: serviceId, confidence: 90, basis: "manual", reason: r, is_verified: true },
    { onConflict: "contact_id,service_id" },
  );
  if (error) return fail(error.message);
  revalidatePath(`/leads/${contactId}`);
  return { ok: true };
}

export async function verifyRecommendation(id: string, contactId: string): Promise<ActionResult> {
  if (!UUID.test(id)) return fail("Invalid");
  const supabase = createClient();
  const { error } = await supabase.from("lead_service_recommendations").update({ is_verified: true, basis: "manual", confidence: 90 }).eq("id", id);
  if (error) return fail(error.message);
  revalidatePath(`/leads/${contactId}`);
  return { ok: true };
}

export async function removeRecommendation(id: string, contactId: string): Promise<ActionResult> {
  if (!UUID.test(id)) return fail("Invalid");
  const supabase = createClient();
  const { error } = await supabase.from("lead_service_recommendations").delete().eq("id", id);
  if (error) return fail(error.message);
  await supabase.from("contacts").update({ updated_at: new Date().toISOString() }).eq("id", contactId); // re-score
  revalidatePath(`/leads/${contactId}`);
  return { ok: true };
}

export async function reclassify(contactIds: string[]): Promise<ActionResult & { count?: number }> {
  const ids = contactIds.filter((id) => UUID.test(id)).slice(0, 2000);
  if (!ids.length) return fail("Nothing to classify");
  const supabase = createClient();
  const { data, error } = await supabase.rpc("classify_contacts", { p_ids: ids });
  if (error) return fail(error.message);
  return { ok: true, count: data as number };
}

export async function createLead(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const profile = await requireProfile();
  const company = str(form.get("company_name"), 300);
  if (!company) return fail("Company name is required");
  const mobileIn = str(form.get("mobile"));
  const mobile = mobileIn ? extractPhones(mobileIn).find((p) => p.kind === "mobile")?.e164 : null;
  if (mobileIn && !mobile) return fail("Mobile number is not a valid Sri Lankan mobile");
  const email = str(form.get("email"), 200)?.toLowerCase() ?? null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("Email is not valid");

  const supabase = createClient();
  const { data, error } = await supabase.from("contacts").insert({
    company_name: company,
    industry: str(form.get("industry"), 200),
    contact_person: str(form.get("contact_person"), 200),
    mobile_raw: mobileIn,
    mobile,
    email,
    district: str(form.get("district"), 100),
    city: str(form.get("city"), 100),
    website: normalizeUrl(form.get("website")),
    facebook_url: normalizeUrl(form.get("facebook_url")),
    notes: str(form.get("notes"), 2000),
    assigned_to: profile.role === "sales_executive" ? profile.id : null,
  }).select("id").single();
  if (error) return fail(error.code === "23505" ? "A lead with this mobile number (or same name and city) already exists" : error.message);
  await supabase.rpc("classify_contacts", { p_ids: [data.id] });
  redirect(`/leads/${data.id}`);
}
