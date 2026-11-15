import { useRouter } from "expo-router";
import { View } from "react-native";
import { AppText, Badge, BarList, Card, Divider, ErrorBox, Grid, ListItem, Loading, Row, Screen, SectionHeader, StatCard } from "@/components/ui";
import { useData } from "@/hooks/useData";
import { useResponsive } from "@/hooks/useResponsive";
import { useAuth } from "@/lib/auth";
import { stageLabel, priorityTone } from "@/lib/constants";
import { colomboDayStart, compact, formatDate, money } from "@/lib/format";
import { check, supabase } from "@/lib/supabase";
import { space } from "@/theme";

type Stats = Record<string, number>;
interface Breakdowns { by_stage: { name: string; value: number }[]; by_district: { name: string; value: number }[] }
interface TaskRow { id: string; title: string; due_at: string | null; priority: string; contact: { company_name: string } | null }
interface FollowRow { id: string; due_at: string; channel: string; contact: { id: string; company_name: string } | null }

export default function Dashboard() {
  const router = useRouter();
  const { profile } = useAuth();
  const { columns } = useResponsive();
  const { data, loading, refreshing, error, refresh, reload } = useData(async () => {
    supabase.rpc("run_housekeeping").then(() => {}, () => {}); // reminders & expiry, best effort
    const tomorrow = colomboDayStart(1);
    const [stats, bd, tasks, follows] = await Promise.all([
      supabase.rpc("dashboard_stats"),
      supabase.rpc("dashboard_breakdowns"),
      supabase.from("tasks").select("id,title,due_at,priority,contact:contacts(company_name)")
        .eq("assigned_to", profile!.id).in("status", ["todo", "in_progress"]).lt("due_at", tomorrow).order("due_at").limit(6),
      supabase.from("follow_ups").select("id,due_at,channel,contact:contacts(id,company_name)")
        .eq("assigned_to", profile!.id).eq("status", "pending").lt("due_at", tomorrow).order("due_at").limit(6),
    ]);
    return {
      stats: check(stats) as Stats,
      // Charts are optional: if they're slow, still show the numbers and lists
      bd: (bd.error ? { by_stage: [], by_district: [] } : bd.data) as Breakdowns,
      tasks: (check(tasks) ?? []) as unknown as TaskRow[],
      follows: (check(follows) ?? []) as unknown as FollowRow[],
    };
  });

  if (loading && !data) return <Loading />;
  const s = data?.stats ?? {};
  const hour = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Colombo" }));
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={{ gap: 4 }}>
        <AppText muted>{greet},</AppText>
        <AppText variant="title">{profile?.full_name?.split(" ")[0] ?? "there"} 👋</AppText>
      </View>
      {error && <ErrorBox message={error} onRetry={reload} />}

      <Grid columns={columns}>
        {[
          <StatCard key="l" label="Total leads" value={compact(s.total_leads)} icon="people" hint={`+${s.new_leads_7d ?? 0} this week`} onPress={() => router.push("/leads")} />,
          <StatCard key="q" label="Qualified (score ≥ 60)" value={compact(s.qualified)} icon="star" tone="warning" />,
          <StatCard key="i" label="Interested / in talks" value={compact(s.interested)} icon="flame" tone="orange" onPress={() => router.push("/pipeline")} />,
          <StatCard key="w" label="Won" value={compact(s.won)} icon="trophy" tone="success" hint={money(s.revenue)} />,
          <StatCard key="p" label="Pipeline value" value={money(s.pipeline_value)} icon="trending-up" tone="violet" />,
          <StatCard key="t" label="Tasks due today" value={s.tasks_due_today ?? 0} icon="checkbox" tone="sky" hint={`${s.tasks_overdue ?? 0} overdue`} onPress={() => router.push("/tasks")} />,
          <StatCard key="f" label="Follow-ups today" value={s.follow_ups_today ?? 0} icon="call" tone="teal" hint={`${s.overdue_follow_ups ?? 0} overdue`} onPress={() => router.push("/tasks")} />,
          <StatCard key="qa" label="Quotations pending" value={s.pending_quotations ?? 0} icon="document-text" tone="primary" hint={`${s.quotations_awaiting_approval ?? 0} need approval`} onPress={() => router.push("/quotations")} />,
        ]}
      </Grid>

      <SectionHeader title="My follow-ups (today & overdue)" action="All tasks" onAction={() => router.push("/tasks")} />
      <Card padded={false} style={{ paddingHorizontal: space.lg }}>
        {(data?.follows.length ?? 0) === 0 ? <AppText muted style={{ paddingVertical: space.lg }}>Nothing due. Nice work!</AppText> :
          data!.follows.map((f, i) => (
            <View key={f.id}>
              {i > 0 && <Divider />}
              <ListItem icon={f.channel === "call" ? "call-outline" : f.channel === "email" ? "mail-outline" : f.channel === "meeting" ? "people-outline" : "chatbubble-ellipses-outline"}
                title={f.contact?.company_name ?? "Lead"} subtitle={`${f.channel} · ${formatDate(f.due_at, true)}`}
                right={new Date(f.due_at) < new Date() ? <Badge label="Overdue" tone="danger" /> : undefined}
                onPress={() => f.contact && router.push(`/lead/${f.contact.id}`)} />
            </View>
          ))}
      </Card>

      <SectionHeader title="My tasks (today & overdue)" />
      <Card padded={false} style={{ paddingHorizontal: space.lg }}>
        {(data?.tasks.length ?? 0) === 0 ? <AppText muted style={{ paddingVertical: space.lg }}>No tasks due.</AppText> :
          data!.tasks.map((tk, i) => (
            <View key={tk.id}>
              {i > 0 && <Divider />}
              <ListItem icon="checkbox-outline" title={tk.title} subtitle={[tk.contact?.company_name, tk.due_at ? formatDate(tk.due_at, true) : null].filter(Boolean).join(" · ")}
                right={<Badge label={tk.priority} tone={priorityTone(tk.priority)} />} onPress={() => router.push(`/task/${tk.id}`)} />
            </View>
          ))}
      </Card>

      <Row style={{ alignItems: "flex-start", flexWrap: "wrap" }} gap={space.lg}>
        <Card style={{ flex: 1, minWidth: 280, gap: space.md }}>
          <AppText variant="subheading">Leads by stage</AppText>
          <BarList items={(data?.bd.by_stage ?? []).map((x) => ({ name: stageLabel(x.name), value: Number(x.value) })).sort((a, b) => b.value - a.value)} />
        </Card>
        <Card style={{ flex: 1, minWidth: 280, gap: space.md }}>
          <AppText variant="subheading">Top districts</AppText>
          <BarList items={(data?.bd.by_district ?? []).slice(0, 8).map((x) => ({ name: x.name, value: Number(x.value) }))} />
        </Card>
      </Row>
    </Screen>
  );
}
