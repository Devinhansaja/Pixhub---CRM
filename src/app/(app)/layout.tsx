import { AppShell } from "@/components/shell";
import type { Notification } from "@/components/notification-bell";
import { createClient, requireProfile } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const supabase = createClient();
  // Housekeeping (due reminders, quotation expiry) runs alongside the notification queries
  // instead of before them; anything it creates shows up on the next page load.
  const [, { data: items }, { count }] = await Promise.all([
    supabase.rpc("run_housekeeping"),
    supabase.from("notifications").select("id,title,body,link,read_at,created_at").eq("user_id", profile.id)
      .order("created_at", { ascending: false }).limit(15),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", profile.id).is("read_at", null),
  ]);
  return (
    <AppShell
      user={{ full_name: profile.full_name, email: profile.email, role: profile.role }}
      notifications={(items ?? []) as Notification[]}
      unread={count ?? 0}
    >
      {children}
    </AppShell>
  );
}
