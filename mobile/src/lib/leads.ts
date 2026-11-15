import { supabase, check } from "./supabase";

/** Adds an entry to a lead's activity timeline. */
export async function logActivity(contactId: string, userId: string, type: string, description: string, metadata: Record<string, unknown> = {}) {
  check(await supabase.from("deal_activities").insert({ contact_id: contactId, type, description: description.slice(0, 5000), metadata, created_by: userId }));
}

export async function changeStage(contactId: string, userId: string, from: string, to: string) {
  check(await supabase.from("contacts").update({ stage: to }).eq("id", contactId));
  await logActivity(contactId, userId, "stage_change", `Stage changed from ${from} to ${to} (mobile app)`, { from, to });
}

export async function loadAssignees() {
  const { data } = await supabase.from("profiles").select("id,full_name,role").eq("is_active", true).order("full_name");
  return (data ?? []) as { id: string; full_name: string; role: string }[];
}
