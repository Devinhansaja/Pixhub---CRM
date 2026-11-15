import { Stack, useRouter, type Href } from "expo-router";
import { View } from "react-native";
import { AppText, Button, Card, EmptyState, ErrorBox, Loading, Row, Screen } from "@/components/ui";
import { useData } from "@/hooks/useData";
import { useAuth } from "@/lib/auth";
import { relative } from "@/lib/format";
import { check, supabase } from "@/lib/supabase";
import { space, useTheme } from "@/theme";

interface Note { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }

/** Maps a web CRM link (e.g. /leads/<id>) to the matching app screen. */
function toAppRoute(link: string | null): Href | null {
  if (!link) return null;
  const m = link.match(/^\/(leads|tasks|quotations|campaigns)\/([0-9a-f-]{36})/i);
  if (m) return ({ leads: `/lead/${m[2]}`, tasks: `/task/${m[2]}`, quotations: `/quotations/${m[2]}`, campaigns: `/campaigns/${m[2]}` } as const)[m[1] as "leads"] as Href;
  if (link.startsWith("/tasks")) return "/tasks";
  if (link.startsWith("/leads")) return "/leads";
  return null;
}

export default function Notifications() {
  const t = useTheme();
  const router = useRouter();
  const { profile } = useAuth();
  const { data, loading, error, refresh, refreshing, reload, setData } = useData(async () =>
    (check(await supabase.from("notifications").select("id,title,body,link,read_at,created_at").eq("user_id", profile!.id).order("created_at", { ascending: false }).limit(100)) ?? []) as Note[]);

  if (loading && !data) return <Loading />;
  const unread = (data ?? []).filter((n) => !n.read_at).length;

  const markAll = async () => {
    setData((d) => d?.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })) ?? d);
    await supabase.rpc("mark_notifications_read", { p_ids: null });
  };
  const openNote = async (n: Note) => {
    if (!n.read_at) {
      setData((d) => d?.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)) ?? d);
      supabase.rpc("mark_notifications_read", { p_ids: [n.id] }).then(() => {}, () => {});
    }
    const route = toAppRoute(n.link);
    if (route) router.push(route);
  };

  return (
    <>
      <Stack.Screen options={{ headerRight: () => unread > 0 ? <Button small variant="ghost" title="Mark all read" onPress={markAll} /> : null }} />
      <Screen refreshing={refreshing} onRefresh={refresh}>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {(data ?? []).length === 0 ? <EmptyState icon="notifications-off-outline" title="No notifications" message="Task reminders, approvals and assignments will show up here." /> :
          data!.map((n) => (
            <Card key={n.id} onPress={() => openNote(n)} style={{ paddingVertical: space.md, borderLeftWidth: n.read_at ? 0 : 3, borderLeftColor: t.primary }}>
              <Row style={{ alignItems: "flex-start" }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText style={{ fontWeight: n.read_at ? "400" : "700" }}>{n.title}</AppText>
                  {n.body && <AppText variant="caption" muted>{n.body}</AppText>}
                </View>
                <AppText variant="caption" faint>{relative(n.created_at)}</AppText>
              </Row>
            </Card>
          ))}
      </Screen>
    </>
  );
}
