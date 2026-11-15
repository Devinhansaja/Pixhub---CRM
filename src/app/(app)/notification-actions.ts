"use server";

import { revalidatePath } from "next/cache";
import { createClient, requireProfile } from "@/lib/supabase/server";

export async function markNotificationsRead(ids: string[] | null) {
  await requireProfile();
  const clean = ids?.filter((i) => /^[0-9a-f-]{36}$/i.test(i)).slice(0, 100) ?? null;
  const supabase = createClient();
  const { error } = await supabase.rpc("mark_notifications_read", { p_ids: clean });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/", "layout");
  return { ok: true as const };
}
