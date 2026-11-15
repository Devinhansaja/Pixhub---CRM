"use server";

import { revalidatePath } from "next/cache";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { STAGES } from "@/lib/constants";
import type { ActionResult } from "../leads/actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseDeal(form: FormData) {
  const title = String(form.get("title") ?? "").trim().slice(0, 200);
  const value = Number(String(form.get("value") ?? "0").replace(/,/g, ""));
  const probRaw = String(form.get("probability") ?? "").trim();
  const probability = probRaw === "" ? null : Number(probRaw);
  const serviceId = String(form.get("service_id") ?? "") || null;
  const close = String(form.get("expected_close_date") ?? "") || null;
  const stage = String(form.get("stage") ?? "new");
  const assignee = String(form.get("assigned_to") ?? "") || null;
  if (!title) return { error: "Give the deal a title" };
  if (!Number.isFinite(value) || value < 0) return { error: "Value must be a positive number" };
  if (probability !== null && (!Number.isInteger(probability) || probability < 0 || probability > 100)) return { error: "Probability must be 0–100" };
  if (serviceId && !UUID.test(serviceId)) return { error: "Invalid service" };
  if (close && !/^\d{4}-\d{2}-\d{2}$/.test(close)) return { error: "Invalid close date" };
  if (!STAGES.some((s) => s.value === stage)) return { error: "Invalid stage" };
  if (assignee && !UUID.test(assignee)) return { error: "Invalid salesperson" };
  return { data: { title, value, probability, service_id: serviceId, expected_close_date: close, stage, assigned_to: assignee } };
}

export async function createDeal(contactId: string, form: FormData): Promise<ActionResult> {
  const me = await requireProfile();
  if (!UUID.test(contactId)) return { ok: false, error: "Invalid lead" };
  const p = parseDeal(form);
  if ("error" in p) return { ok: false, error: p.error! };
  const d = p.data!;
  const supabase = createClient();
  const { error } = await supabase.from("deals").insert({
    ...d,
    probability: d.probability ?? 10,
    contact_id: contactId,
    assigned_to: me.role === "sales_executive" ? me.id : d.assigned_to ?? me.id,
    created_by: me.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/leads/${contactId}`);
  revalidatePath("/pipeline");
  return { ok: true, message: "Deal created" };
}

export async function updateDeal(dealId: string, form: FormData): Promise<ActionResult> {
  const me = await requireProfile();
  if (!UUID.test(dealId)) return { ok: false, error: "Invalid deal" };
  const p = parseDeal(form);
  if ("error" in p) return { ok: false, error: p.error! };
  const { assigned_to, probability, ...rest } = p.data!;
  const supabase = createClient();
  const patch: Record<string, unknown> = { ...rest };
  if (probability !== null) patch.probability = probability;
  if (me.role !== "sales_executive" && assigned_to) patch.assigned_to = assigned_to;
  const { data, error } = await supabase.from("deals").update(patch).eq("id", dealId).select("contact_id").single();
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/leads/${data.contact_id}`);
  revalidatePath("/pipeline");
  return { ok: true, message: "Deal saved" };
}

export async function moveDeal(dealId: string, stage: string): Promise<ActionResult> {
  if (!UUID.test(dealId) || !STAGES.some((s) => s.value === stage)) return { ok: false, error: "Invalid input" };
  const supabase = createClient();
  const { data, error } = await supabase.from("deals").update({ stage }).eq("id", dealId).select("contact_id").single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/pipeline");
  revalidatePath(`/leads/${data.contact_id}`);
  return { ok: true };
}

export async function deleteDeal(dealId: string): Promise<ActionResult> {
  const me = await requireProfile();
  if (me.role === "sales_executive") return { ok: false, error: "Only managers can delete deals" };
  if (!UUID.test(dealId)) return { ok: false, error: "Invalid deal" };
  const supabase = createClient();
  const { data, error } = await supabase.from("deals").delete().eq("id", dealId).select("contact_id").single();
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/leads/${data.contact_id}`);
  revalidatePath("/pipeline");
  return { ok: true };
}
