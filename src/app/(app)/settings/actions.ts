"use server";

import { revalidatePath } from "next/cache";
import { createClient, requireProfile } from "@/lib/supabase/server";
import type { ActionResult } from "../leads/actions";

const CATEGORIES = ["website", "software", "social_media", "ecommerce", "follow_up", "meeting", "general"];

export async function updateMyProfile(form: FormData): Promise<ActionResult> {
  const me = await requireProfile();
  const full_name = String(form.get("full_name") ?? "").trim().slice(0, 120);
  const phone = String(form.get("phone") ?? "").trim().slice(0, 30) || null;
  if (!full_name) return { ok: false, error: "Name is required" };
  const supabase = createClient();
  const { error } = await supabase.from("profiles").update({ full_name, phone }).eq("id", me.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile saved" };
}

export async function changePassword(form: FormData): Promise<ActionResult> {
  await requireProfile();
  const pw = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (pw.length < 10) return { ok: false, error: "Use at least 10 characters" };
  if (pw !== confirm) return { ok: false, error: "Passwords do not match" };
  const supabase = createClient();
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) return { ok: false, error: error.message };
  return { ok: true, message: "Password updated" };
}

export async function saveTemplate(form: FormData): Promise<ActionResult> {
  const me = await requireProfile();
  if (me.role === "sales_executive") return { ok: false, error: "Only managers and admins can edit templates" };
  const id = String(form.get("id") ?? "");
  const name = String(form.get("name") ?? "").trim().slice(0, 100);
  const category = String(form.get("category") ?? "general");
  const body = String(form.get("body") ?? "").trim().slice(0, 4000);
  const is_active = form.get("is_active") === "on";
  if (!name || !body) return { ok: false, error: "Name and message are required" };
  if (!CATEGORIES.includes(category)) return { ok: false, error: "Invalid category" };
  const supabase = createClient();
  const { error } = id
    ? await supabase.from("message_templates").update({ name, category, body, is_active }).eq("id", id)
    : await supabase.from("message_templates").insert({ name, category, body, is_active, created_by: me.id });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, message: "Template saved" };
}

export async function saveOrganization(form: FormData): Promise<ActionResult> {
  const me = await requireProfile();
  if (me.role !== "admin") return { ok: false, error: "Admins only" };
  const id = String(form.get("id") ?? "");
  const f = (k: string) => String(form.get(k) ?? "").trim().slice(0, 300) || null;
  const supabase = createClient();
  const { error } = await supabase.from("organizations").update({
    name: f("name") ?? "PIXhub.lk", legal_name: f("legal_name"), address: f("address"),
    phone: f("phone"), email: f("email"), website: f("website"), tax_reg_no: f("tax_reg_no"),
  }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  const tax = Number(form.get("default_tax_rate") ?? 0);
  if (!Number.isFinite(tax) || tax < 0 || tax > 100) return { ok: false, error: "Default tax rate must be 0–100" };
  const { error: sErr } = await supabase.from("system_settings").upsert({
    key: "company", value: { currency: "LKR", timezone: "Asia/Colombo", default_tax_rate: tax }, updated_by: me.id, updated_at: new Date().toISOString(),
  });
  if (sErr) return { ok: false, error: sErr.message };
  revalidatePath("/settings");
  return { ok: true, message: "Company details saved" };
}

export async function saveService(id: string, form: FormData): Promise<ActionResult> {
  const me = await requireProfile();
  if (me.role !== "admin") return { ok: false, error: "Admins only" };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Invalid service" };
  const priceRaw = String(form.get("base_price") ?? "").replace(/,/g, "").trim();
  const base_price = priceRaw ? Number(priceRaw) : null;
  if (base_price !== null && (!Number.isFinite(base_price) || base_price < 0)) return { ok: false, error: "Price must be a positive number" };
  const description = String(form.get("description") ?? "").trim().slice(0, 300) || null;
  const is_active = form.get("is_active") === "on";
  const supabase = createClient();
  const { error } = await supabase.from("services").update({ base_price, description, is_active }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  return { ok: true, message: "Saved" };
}
