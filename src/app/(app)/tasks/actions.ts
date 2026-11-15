"use server";

import { revalidatePath } from "next/cache";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { PRIORITIES, TASK_STATUSES } from "@/lib/constants";
import type { ActionResult } from "../leads/actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

function readTask(form: FormData, meId: string, isExec: boolean) {
  const title = String(form.get("title") ?? "").trim().slice(0, 300);
  const description = String(form.get("description") ?? "").trim().slice(0, 5000) || null;
  const priority = String(form.get("priority") ?? "medium");
  const assignee = String(form.get("assigned_to") ?? "") || meId;
  const contactId = String(form.get("contact_id") ?? "") || null;
  const due_at = iso(form.get("due_at"));
  const remind_at = iso(form.get("remind_at"));
  if (!title) return { error: "Title is required" };
  if (!PRIORITIES.some((p) => p.value === priority)) return { error: "Invalid priority" };
  if (!UUID.test(assignee)) return { error: "Invalid assignee" };
  if (isExec && assignee !== meId) return { error: "Sales executives can only assign tasks to themselves" };
  if (contactId && !UUID.test(contactId)) return { error: "Invalid lead" };
  if (due_at === undefined || remind_at === undefined) return { error: "Invalid date" };
  return { data: { title, description, priority, assigned_to: assignee, contact_id: contactId, due_at, remind_at } };
}

export async function createTask(form: FormData): Promise<ActionResult> {
  const me = await requireProfile();
  const t = readTask(form, me.id, me.role === "sales_executive");
  if ("error" in t) return { ok: false, error: t.error! };
  const supabase = createClient();
  const { error } = await supabase.from("tasks").insert({ ...t.data, created_by: me.id });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/tasks");
  if (t.data!.contact_id) revalidatePath(`/leads/${t.data!.contact_id}`);
  return { ok: true, message: "Task created" };
}

export async function updateTask(id: string, form: FormData): Promise<ActionResult> {
  const me = await requireProfile();
  if (!UUID.test(id)) return { ok: false, error: "Invalid task" };
  const t = readTask(form, me.id, false);
  if ("error" in t) return { ok: false, error: t.error! };
  const { contact_id: _c, assigned_to, ...rest } = t.data!;
  const patch: Record<string, unknown> = rest;
  if (me.role !== "sales_executive") patch.assigned_to = assigned_to;
  const supabase = createClient();
  const { error } = await supabase.from("tasks").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/tasks/${id}`);
  revalidatePath("/tasks");
  return { ok: true, message: "Saved" };
}

export async function setTaskStatus(id: string, status: string): Promise<ActionResult> {
  if (!UUID.test(id) || !TASK_STATUSES.some((s) => s.value === status)) return { ok: false, error: "Invalid input" };
  const supabase = createClient();
  const { error } = await supabase.from("tasks").update({ status }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/tasks");
  revalidatePath(`/tasks/${id}`);
  return { ok: true };
}

export async function rescheduleTask(id: string, dueIso: string): Promise<ActionResult> {
  const d = new Date(dueIso);
  if (!UUID.test(id) || Number.isNaN(d.getTime())) return { ok: false, error: "Invalid date" };
  const supabase = createClient();
  const { error } = await supabase.from("tasks").update({ due_at: d.toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/tasks");
  return { ok: true };
}

export async function addTaskComment(id: string, text: string): Promise<ActionResult> {
  const me = await requireProfile();
  const body = text.trim().slice(0, 2000);
  if (!UUID.test(id) || !body) return { ok: false, error: "Comment cannot be empty" };
  const supabase = createClient();
  const { error } = await supabase.from("task_events").insert({ task_id: id, type: "comment", description: body, created_by: me.id });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/tasks/${id}`);
  return { ok: true };
}

export async function deleteTask(id: string): Promise<ActionResult> {
  if (!UUID.test(id)) return { ok: false, error: "Invalid task" };
  const supabase = createClient();
  const { data, error } = await supabase.from("tasks").delete().eq("id", id).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Only the creator or a manager can delete this task" };
  revalidatePath("/tasks");
  return { ok: true };
}
