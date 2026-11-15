"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient, createClient, requireProfile } from "@/lib/supabase/server";
import { ROLES } from "@/lib/constants";
import type { ActionResult } from "../leads/actions";

const UUID = /^[0-9a-f-]{36}$/i;

export async function inviteUser(form: FormData): Promise<ActionResult> {
  const me = await requireProfile();
  if (me.role !== "admin") return { ok: false, error: "Only administrators can add employees" };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const fullName = String(form.get("full_name") ?? "").trim().slice(0, 120);
  const role = String(form.get("role") ?? "sales_executive");
  const managerId = String(form.get("manager_id") ?? "") || null;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Enter a valid email" };
  if (!fullName) return { ok: false, error: "Enter the employee's name" };
  if (!ROLES.some((r) => r.value === role)) return { ok: false, error: "Invalid role" };
  if (managerId && !UUID.test(managerId)) return { ok: false, error: "Invalid manager" };

  let admin;
  try { admin = createAdminClient(); } catch { return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not configured on the server" }; }
  const origin = process.env.NEXT_PUBLIC_SITE_URL || headers().get("origin") || "";
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: `${origin}/auth/callback?next=/settings`,
  });
  if (error) return { ok: false, error: error.message };

  // Profile row is created by the auth trigger; set role/team as the admin (RLS-checked).
  const supabase = createClient();
  const { error: upErr } = await supabase.from("profiles").update({ role, manager_id: managerId, full_name: fullName }).eq("id", data.user.id);
  if (upErr) return { ok: false, error: `Invited, but could not set role: ${upErr.message}` };
  revalidatePath("/team");
  return { ok: true, message: `Invitation sent to ${email}` };
}

export async function updateMember(id: string, patch: { role?: string; manager_id?: string | null; is_active?: boolean }): Promise<ActionResult> {
  const me = await requireProfile();
  if (me.role !== "admin") return { ok: false, error: "Only administrators can change roles and teams" };
  if (!UUID.test(id)) return { ok: false, error: "Invalid user" };
  if (id === me.id && (patch.role && patch.role !== "admin" || patch.is_active === false)) {
    return { ok: false, error: "You cannot remove your own admin access" };
  }
  if (patch.role && !ROLES.some((r) => r.value === patch.role)) return { ok: false, error: "Invalid role" };
  if (patch.manager_id && (!UUID.test(patch.manager_id) || patch.manager_id === id)) return { ok: false, error: "Invalid manager" };
  const supabase = createClient();
  const { error } = await supabase.from("profiles").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };

  if (patch.is_active === false) {
    try { await createAdminClient().auth.admin.signOut(id); } catch { /* best effort */ }
  }
  revalidatePath("/team");
  return { ok: true };
}
