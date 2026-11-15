"use server";

import { revalidatePath } from "next/cache";
import { createClient, requireProfile } from "@/lib/supabase/server";
import type { ActionResult } from "../leads/actions";

const UUID = /^[0-9a-f-]{36}$/i;

async function adminOnly(): Promise<ActionResult | null> {
  const p = await requireProfile();
  return p.role === "admin" ? null : { ok: false, error: "Only administrators can edit classification rules" };
}

export async function addRule(form: FormData): Promise<ActionResult> {
  const denied = await adminOnly();
  if (denied) return denied;
  const keyword = String(form.get("keyword") ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const serviceId = String(form.get("service_id") ?? "");
  const weight = Number(form.get("weight"));
  const reason = String(form.get("reason") ?? "").trim().slice(0, 300);
  if (keyword.length < 2 || keyword.length > 40) return { ok: false, error: "Keyword must be 2–40 letters/numbers" };
  if (!UUID.test(serviceId)) return { ok: false, error: "Choose a service" };
  if (!Number.isInteger(weight) || weight < 1 || weight > 100) return { ok: false, error: "Weight must be 1–100" };
  if (!reason) return { ok: false, error: "Give a reason (shown to sales staff)" };
  const supabase = createClient();
  const { error } = await supabase.from("classification_rules").insert({ keyword, service_id: serviceId, weight, reason });
  if (error) return { ok: false, error: error.code === "23505" ? "This keyword already maps to that service" : error.message };
  revalidatePath("/classification");
  return { ok: true, message: `Rule added. Run "Re-classify" to apply it to existing leads.` };
}

export async function toggleRule(id: string, active: boolean): Promise<ActionResult> {
  const denied = await adminOnly();
  if (denied) return denied;
  const supabase = createClient();
  const { error } = await supabase.from("classification_rules").update({ is_active: active }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/classification");
  return { ok: true };
}

export async function deleteRule(id: string): Promise<ActionResult> {
  const denied = await adminOnly();
  if (denied) return denied;
  const supabase = createClient();
  const { error } = await supabase.from("classification_rules").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/classification");
  return { ok: true };
}
