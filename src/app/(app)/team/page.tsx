import { createClient, requireRole } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { TeamManager } from "./team-manager";

export default async function TeamPage() {
  const me = await requireRole(["admin", "sales_manager"]);
  const supabase = createClient();
  const [{ data: members }, { data: bd }] = await Promise.all([
    supabase.from("profiles").select("id,email,full_name,role,manager_id,is_active,created_at").order("full_name"),
    supabase.rpc("dashboard_breakdowns"),
  ]);
  const perf = new Map(((bd as { by_owner?: { name: string; leads: number; won: number }[] })?.by_owner ?? []).map((o) => [o.name, o]));
  const visible = (members ?? []).filter((m) => me.role === "admin" || m.id === me.id || m.manager_id === me.id);

  return (
    <>
      <PageHeader title="Team Management" description={me.role === "admin" ? "Invite employees, set roles and build sales teams." : "Your sales team."} />
      <TeamManager
        me={me.id}
        isAdmin={me.role === "admin"}
        members={visible.map((m) => ({ ...m, leads: perf.get(m.full_name)?.leads ?? 0, won: perf.get(m.full_name)?.won ?? 0 }))}
        managers={(members ?? []).filter((m) => m.role !== "sales_executive" && m.is_active)}
      />
    </>
  );
}
