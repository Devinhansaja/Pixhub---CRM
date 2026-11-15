"use server";

import { revalidatePath } from "next/cache";
import { createClient, requireProfile } from "@/lib/supabase/server";

type Result = { ok: true; message?: string; id?: string } | { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface QuotePayload {
  id?: string | null;
  contact_id: string;
  deal_id?: string | null;
  issue_date: string;
  expiry_date: string;
  discount_amount: number;
  tax_rate: number;
  notes?: string | null;
  items: { service_id?: string | null; description: string; quantity: number; unit_price: number; discount_pct: number }[];
}

export async function saveQuotation(p: QuotePayload): Promise<Result> {
  await requireProfile();
  if (p.id && !UUID.test(p.id)) return { ok: false, error: "Invalid quotation" };
  if (!UUID.test(p.contact_id)) return { ok: false, error: "Choose a company" };
  if (p.deal_id && !UUID.test(p.deal_id)) return { ok: false, error: "Invalid deal" };
  if (!DATE.test(p.issue_date) || !DATE.test(p.expiry_date)) return { ok: false, error: "Invalid dates" };
  if (p.expiry_date < p.issue_date) return { ok: false, error: "Expiry date must be on or after the issue date" };
  if (!(p.discount_amount >= 0)) return { ok: false, error: "Discount must be 0 or more" };
  if (!(p.tax_rate >= 0 && p.tax_rate <= 100)) return { ok: false, error: "Tax rate must be 0–100%" };
  if (!Array.isArray(p.items) || p.items.length === 0) return { ok: false, error: "Add at least one item" };
  for (const [i, it] of p.items.entries()) {
    if (!it.description?.trim()) return { ok: false, error: `Item ${i + 1}: description is required` };
    if (!(it.quantity > 0)) return { ok: false, error: `Item ${i + 1}: quantity must be more than 0` };
    if (!(it.unit_price >= 0)) return { ok: false, error: `Item ${i + 1}: price must be 0 or more` };
    if (!(it.discount_pct >= 0 && it.discount_pct <= 100)) return { ok: false, error: `Item ${i + 1}: discount must be 0–100%` };
    if (it.service_id && !UUID.test(it.service_id)) return { ok: false, error: `Item ${i + 1}: invalid service` };
  }
  const supabase = createClient();
  const { data, error } = await supabase.rpc("save_quotation", {
    p_id: p.id ?? null, p_contact: p.contact_id, p_deal: p.deal_id || null,
    p_issue: p.issue_date, p_expiry: p.expiry_date, p_discount: p.discount_amount, p_tax: p.tax_rate,
    p_notes: p.notes?.trim() || null,
    p_items: p.items.map((it) => ({ ...it, description: it.description.trim().slice(0, 500), service_id: it.service_id || "" })),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/quotations");
  revalidatePath(`/leads/${p.contact_id}`);
  return { ok: true, id: data as string };
}

async function setStatus(id: string, status: string, extra: Record<string, unknown> = {}): Promise<Result> {
  if (!UUID.test(id)) return { ok: false, error: "Invalid quotation" };
  const supabase = createClient();
  const { data, error } = await supabase.from("quotations").update({ status, ...extra }).eq("id", id).select("contact_id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Quotation not found or not accessible" };
  revalidatePath(`/quotations/${id}`);
  revalidatePath("/quotations");
  revalidatePath(`/leads/${data[0].contact_id}`);
  return { ok: true };
}

export async function submitForApproval(id: string) { await requireProfile(); return setStatus(id, "pending_approval", { review_note: null }); }
export async function withdrawQuotation(id: string) { await requireProfile(); return setStatus(id, "draft"); }
export async function markSent(id: string) { await requireProfile(); return setStatus(id, "sent"); }
export async function markAccepted(id: string) { await requireProfile(); return setStatus(id, "accepted"); }
export async function markRejected(id: string) { await requireProfile(); return setStatus(id, "rejected"); }

export async function approveQuotation(id: string): Promise<Result> {
  const me = await requireProfile();
  if (me.role === "sales_executive") return { ok: false, error: "Only managers can approve quotations" };
  return setStatus(id, "approved", { review_note: null });
}

export async function requestChanges(id: string, note: string): Promise<Result> {
  const me = await requireProfile();
  if (me.role === "sales_executive") return { ok: false, error: "Only managers can review quotations" };
  const n = note.trim().slice(0, 1000);
  if (!n) return { ok: false, error: "Explain what needs to change" };
  return setStatus(id, "draft", { review_note: n });
}

export async function duplicateQuotation(id: string): Promise<Result> {
  await requireProfile();
  if (!UUID.test(id)) return { ok: false, error: "Invalid quotation" };
  const supabase = createClient();
  const { data: q } = await supabase.from("quotations").select("*").eq("id", id).single();
  const { data: items } = await supabase.from("quotation_items").select("service_id,description,quantity,unit_price,discount_pct").eq("quotation_id", id).order("sort_order");
  if (!q || !items?.length) return { ok: false, error: "Quotation not found" };
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
  const expiry = new Date(Date.now() + 30 * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });
  return saveQuotation({
    contact_id: q.contact_id, deal_id: q.deal_id, issue_date: today, expiry_date: expiry,
    discount_amount: Number(q.discount_amount), tax_rate: Number(q.tax_rate), notes: q.notes,
    items: items.map((i) => ({ service_id: i.service_id, description: i.description, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount_pct: Number(i.discount_pct) })),
  });
}

export async function deleteQuotation(id: string): Promise<Result> {
  const me = await requireProfile();
  if (me.role === "sales_executive") return { ok: false, error: "Only managers can delete quotations" };
  if (!UUID.test(id)) return { ok: false, error: "Invalid quotation" };
  const supabase = createClient();
  const { error } = await supabase.from("quotations").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/quotations");
  return { ok: true };
}
