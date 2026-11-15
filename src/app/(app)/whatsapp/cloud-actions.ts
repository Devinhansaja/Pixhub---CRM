"use server";

import { revalidatePath } from "next/cache";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { sendTemplate, sendText, templateParams, waConfigured, WA_HOURLY_LIMIT, WhatsAppError } from "@/lib/whatsapp-cloud";
import type { ActionResult } from "../leads/actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordOptIn(contactId: string, source: string): Promise<ActionResult> {
  const me = await requireProfile();
  const s = source.trim().slice(0, 300);
  if (!UUID.test(contactId)) return { ok: false, error: "Invalid lead" };
  if (s.length < 5) return { ok: false, error: "Describe how and when the customer agreed (e.g. 'Asked for updates on call, 14 Nov')" };
  const supabase = createClient();
  const { data: c } = await supabase.from("contacts").select("do_not_contact").eq("id", contactId).maybeSingle();
  if (!c) return { ok: false, error: "Lead not found" };
  if (c.do_not_contact) return { ok: false, error: "This contact opted out. Remove do-not-contact first if they asked to hear from you again." };
  const { error } = await supabase.from("contacts").update({ whatsapp_opt_in_at: new Date().toISOString(), whatsapp_opt_in_source: s, whatsapp_opt_in_by: me.id }).eq("id", contactId);
  if (error) return { ok: false, error: error.message };
  await supabase.from("deal_activities").insert({ contact_id: contactId, type: "system", created_by: me.id, description: `WhatsApp opt-in recorded by ${me.full_name}: ${s}` });
  revalidatePath(`/leads/${contactId}`);
  return { ok: true, message: "Opt-in recorded" };
}

export async function revokeOptIn(contactId: string): Promise<ActionResult> {
  const me = await requireProfile();
  if (!UUID.test(contactId)) return { ok: false, error: "Invalid lead" };
  const supabase = createClient();
  const { error } = await supabase.from("contacts").update({ whatsapp_opt_in_at: null, whatsapp_opt_in_source: null, whatsapp_opt_in_by: null }).eq("id", contactId);
  if (error) return { ok: false, error: error.message };
  await supabase.from("deal_activities").insert({ contact_id: contactId, type: "system", created_by: me.id, description: "WhatsApp opt-in withdrawn" });
  revalidatePath(`/leads/${contactId}`);
  return { ok: true };
}

async function preflight(contactId: string) {
  if (!waConfigured()) throw new WhatsAppError("The WhatsApp Business API is not configured on the server.");
  if (!UUID.test(contactId)) throw new WhatsAppError("Invalid lead");
  const supabase = createClient();
  const { data: sent, error } = await supabase.rpc("whatsapp_sends_last_hour");
  if (error) throw new WhatsAppError(error.message);
  if ((sent as number) >= WA_HOURLY_LIMIT) throw new WhatsAppError(`Limit of ${WA_HOURLY_LIMIT} API messages per hour reached. This CRM does not do bulk messaging.`);
  const { data: c } = await supabase.from("contacts")
    .select("id,company_name,contact_person,city,mobile,do_not_contact,whatsapp_opt_in_at,last_inbound_at,recs:lead_service_recommendations(confidence,service:services(name))")
    .eq("id", contactId).maybeSingle();
  if (!c) throw new WhatsAppError("Lead not found");
  if (c.do_not_contact) throw new WhatsAppError("This contact is marked do-not-contact.");
  if (!c.mobile) throw new WhatsAppError("No valid mobile number.");
  return { supabase, c };
}

async function logSent(contactId: string, userId: string, externalId: string, body: string, templateName: string | null) {
  const supabase = createClient();
  const { error } = await supabase.from("communication_logs").insert({
    contact_id: contactId, channel: "whatsapp", direction: "outbound", status: "contacted", source: "whatsapp_cloud_api",
    body, template_name: templateName, external_id: externalId, delivery_status: "accepted", created_by: userId,
  });
  if (error) throw new WhatsAppError(`Message was sent but could not be logged: ${error.message}`);
  await supabase.from("deal_activities").insert({ contact_id: contactId, type: "whatsapp", created_by: userId,
    description: templateName ? `WhatsApp template “${templateName}” sent via Business API` : "WhatsApp reply sent via Business API" });
  revalidatePath(`/leads/${contactId}`);
  revalidatePath("/whatsapp");
}

export async function sendTemplateMessage(contactId: string, templateId: string): Promise<ActionResult> {
  const me = await requireProfile();
  try {
    const { supabase, c } = await preflight(contactId);
    if (!c.whatsapp_opt_in_at) throw new WhatsAppError("Record the customer's opt-in before sending template messages.");
    if (!UUID.test(templateId)) throw new WhatsAppError("Choose a template");
    const { data: t } = await supabase.from("whatsapp_templates").select("name,language,params,body_preview,is_active").eq("id", templateId).maybeSingle();
    if (!t || !t.is_active) throw new WhatsAppError("Template not available");
    const services = ((c.recs ?? []) as unknown as { confidence: number; service: { name: string } | null }[])
      .sort((a, b) => b.confidence - a.confidence).map((r) => r.service?.name).filter(Boolean) as string[];
    const params = templateParams(t.params ?? [], { company: c.company_name, contact_person: c.contact_person, city: c.city, services, sender: me.full_name });
    const preview = (t.body_preview as string).replace(/\{\{(\d+)\}\}/g, (_m: string, n: string) => params[Number(n) - 1] ?? "");
    const wamid = await sendTemplate(c.mobile!, t.name, t.language, params);
    await logSent(contactId, me.id, wamid, preview, t.name);
    return { ok: true, message: "Sent through the WhatsApp Business API. Delivery status updates automatically." };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Send failed" };
  }
}

export async function sendReply(contactId: string, text: string): Promise<ActionResult> {
  const me = await requireProfile();
  try {
    const body = text.trim();
    if (!body) throw new WhatsAppError("Write a message");
    const { c } = await preflight(contactId);
    if (!c.last_inbound_at || Date.now() - new Date(c.last_inbound_at).getTime() > 24 * 3600 * 1000) {
      throw new WhatsAppError("Free-text replies are only allowed within 24 hours of the customer's last message. Use an approved template instead.");
    }
    const wamid = await sendText(c.mobile!, body);
    await logSent(contactId, me.id, wamid, body.slice(0, 4000), null);
    return { ok: true, message: "Reply sent" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Send failed" };
  }
}

export async function saveWaTemplate(form: FormData): Promise<ActionResult> {
  const me = await requireProfile();
  if (me.role !== "admin") return { ok: false, error: "Admins only" };
  const name = String(form.get("name") ?? "").trim();
  const language = String(form.get("language") ?? "en").trim();
  const category = String(form.get("category") ?? "marketing");
  const body_preview = String(form.get("body_preview") ?? "").trim().slice(0, 1024);
  const params = String(form.get("params") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (!/^[a-z0-9_]+$/.test(name)) return { ok: false, error: "Template name must match Meta exactly (lowercase letters, numbers, underscores)" };
  if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(language)) return { ok: false, error: "Language code like en, en_US or si" };
  if (!body_preview) return { ok: false, error: "Paste the approved template body" };
  const allowed = ["company", "contact_person", "services", "city", "sender"];
  if (params.some((p) => !allowed.includes(p))) return { ok: false, error: `Variables must be from: ${allowed.join(", ")}` };
  const vars = new Set(body_preview.match(/\{\{\d+\}\}/g) ?? []);
  if (vars.size !== params.length) return { ok: false, error: `The body has ${vars.size} variable(s) but ${params.length} field(s) were mapped` };
  const supabase = createClient();
  const { error } = await supabase.from("whatsapp_templates").insert({ name, language, category, body_preview, params });
  if (error) return { ok: false, error: error.code === "23505" ? "That template/language already exists" : error.message };
  revalidatePath("/whatsapp");
  return { ok: true, message: "Template added" };
}

export async function toggleWaTemplate(id: string, active: boolean): Promise<ActionResult> {
  const me = await requireProfile();
  if (me.role !== "admin" || !UUID.test(id)) return { ok: false, error: "Not allowed" };
  const supabase = createClient();
  const { error } = await supabase.from("whatsapp_templates").update({ is_active: active }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/whatsapp");
  return { ok: true };
}
