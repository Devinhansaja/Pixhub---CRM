import "server-only";
import { createClient } from "@/lib/supabase/server";
import { loadAssignees } from "@/lib/leads-query";
import type { Options } from "./editor";

export async function loadCampaignOptions(): Promise<Options> {
  const supabase = createClient();
  const [{ data: imports }, { data: opts }, { data: services }, assignees] = await Promise.all([
    supabase.from("lead_imports").select("id,file_name").order("created_at", { ascending: false }).limit(50),
    supabase.rpc("lead_filter_options"),
    supabase.from("services").select("id,name").eq("is_active", true).order("sort_order"),
    loadAssignees(supabase),
  ]);
  const o = (opts ?? { districts: [], industries: [] }) as { districts: string[]; industries: string[] };
  return { imports: imports ?? [], industries: o.industries, districts: o.districts, services: services ?? [], assignees };
}

export const campaignStatusStyle: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  pending_approval: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  approved: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  sending: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  paused: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  completed: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
  cancelled: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};
export const campaignStatusLabel = (s: string) => s === "pending_approval" ? "Waiting for approval" : s.charAt(0).toUpperCase() + s.slice(1);
