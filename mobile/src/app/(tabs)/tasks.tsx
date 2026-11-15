import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { AppText, Badge, Card, Chips, EmptyState, ErrorBox, IconButton, Loading, Row, Screen, SectionHeader } from "@/components/ui";
import { useData } from "@/hooks/useData";
import { useAuth } from "@/lib/auth";
import { priorityTone } from "@/lib/constants";
import { colomboDayStart, formatDate } from "@/lib/format";
import { check, supabase } from "@/lib/supabase";
import { space, useTheme } from "@/theme";

type View_ = "today" | "upcoming" | "done";
interface Task { id: string; title: string; status: string; priority: string; due_at: string | null; contact: { id: string; company_name: string } | null; assignee: { full_name: string } | null }
interface Follow { id: string; due_at: string; channel: string; note: string | null; contact: { id: string; company_name: string } | null }

export default function Tasks() {
  const t = useTheme();
  const router = useRouter();
  const { profile, isManager } = useAuth();
  const [view, setView] = useState<View_>("today");
  const [scope, setScope] = useState<"mine" | "team">("mine");

  const { data, loading, error, refresh, refreshing, reload, setData } = useData(async () => {
    const tomorrow = colomboDayStart(1);
    let tq = supabase.from("tasks").select("id,title,status,priority,due_at,contact:contacts(id,company_name),assignee:profiles!tasks_assigned_to_fkey(full_name)");
    let fq = supabase.from("follow_ups").select("id,due_at,channel,note,contact:contacts(id,company_name)");
    if (scope === "mine") { tq = tq.eq("assigned_to", profile!.id); fq = fq.eq("assigned_to", profile!.id); }
    if (view === "done") {
      tq = tq.eq("status", "done").order("completed_at", { ascending: false }).limit(50);
      fq = fq.eq("status", "done").order("completed_at", { ascending: false }).limit(30);
    } else if (view === "today") {
      tq = tq.in("status", ["todo", "in_progress"]).or(`due_at.lt.${tomorrow},due_at.is.null`).order("due_at", { nullsFirst: false }).limit(100);
      fq = fq.eq("status", "pending").lt("due_at", tomorrow).order("due_at").limit(100);
    } else {
      tq = tq.in("status", ["todo", "in_progress"]).gte("due_at", tomorrow).order("due_at").limit(100);
      fq = fq.eq("status", "pending").gte("due_at", tomorrow).order("due_at").limit(100);
    }
    const [tasks, follows] = await Promise.all([tq, fq]);
    return { tasks: (check(tasks) ?? []) as unknown as Task[], follows: (check(follows) ?? []) as unknown as Follow[] };
  }, [view, scope]);

  const toggleTask = async (task: Task) => {
    const status = task.status === "done" ? "todo" : "done";
    setData((d) => d && { ...d, tasks: d.tasks.map((x) => (x.id === task.id ? { ...x, status } : x)) });
    const { error: e } = await supabase.from("tasks").update({ status }).eq("id", task.id);
    if (e) { Alert.alert("Couldn't update", e.message); reload(); }
  };
  const finishFollow = async (f: Follow) => {
    setData((d) => d && { ...d, follows: d.follows.filter((x) => x.id !== f.id) });
    const { error: e } = await supabase.from("follow_ups").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", f.id);
    if (e) { Alert.alert("Couldn't update", e.message); reload(); }
  };

  if (loading && !data) return <Loading />;
  const now = new Date();
  const overdue = (d: string | null) => !!d && new Date(d) < now;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Screen refreshing={refreshing} onRefresh={refresh}>
        <Chips value={view} onChange={setView} options={[{ value: "today", label: "Today & overdue" }, { value: "upcoming", label: "Upcoming" }, { value: "done", label: "Done" }]} />
        {isManager && <Chips value={scope} onChange={setScope} options={[{ value: "mine", label: "Mine" }, { value: "team", label: "Whole team" }]} />}
        {error && <ErrorBox message={error} onRetry={reload} />}

        <SectionHeader title={`Follow-ups (${data?.follows.length ?? 0})`} />
        {data?.follows.length === 0 ? <AppText muted>No follow-ups here.</AppText> : data?.follows.map((f) => (
          <Card key={f.id} onPress={() => f.contact && router.push(`/lead/${f.contact.id}`)} style={{ paddingVertical: space.md }}>
            <Row>
              <Ionicons name={f.channel === "call" ? "call-outline" : f.channel === "email" ? "mail-outline" : f.channel === "meeting" ? "people-outline" : f.channel === "visit" ? "car-outline" : "chatbubble-ellipses-outline"} size={20} color={t.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText style={{ fontWeight: "600" }} numberOfLines={1}>{f.contact?.company_name ?? "Lead"}</AppText>
                <AppText variant="caption" muted numberOfLines={2}>{f.channel} · {formatDate(f.due_at, true)}{f.note ? ` · ${f.note}` : ""}</AppText>
              </View>
              {overdue(f.due_at) && view !== "done" && <Badge label="Overdue" tone="danger" />}
              {view !== "done" && <IconButton icon="checkmark-circle-outline" color={t.success} label="Mark done" onPress={() => finishFollow(f)} />}
            </Row>
          </Card>
        ))}

        <SectionHeader title={`Tasks (${data?.tasks.length ?? 0})`} />
        {data?.tasks.length === 0 ? <EmptyState icon="checkmark-done-outline" title="All clear" message="No tasks in this view." /> : data?.tasks.map((tk) => (
          <Card key={tk.id} onPress={() => router.push(`/task/${tk.id}`)} style={{ paddingVertical: space.md }}>
            <Row>
              <Pressable hitSlop={10} onPress={() => toggleTask(tk)} accessibilityLabel={tk.status === "done" ? "Mark not done" : "Mark done"}>
                <Ionicons name={tk.status === "done" ? "checkmark-circle" : "ellipse-outline"} size={24} color={tk.status === "done" ? t.success : t.textFaint} />
              </Pressable>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText style={{ fontWeight: "600", textDecorationLine: tk.status === "done" ? "line-through" : "none" }} numberOfLines={2}>{tk.title}</AppText>
                <AppText variant="caption" muted numberOfLines={1}>
                  {[tk.contact?.company_name, tk.due_at ? formatDate(tk.due_at, true) : "No due date", scope === "team" ? tk.assignee?.full_name : null].filter(Boolean).join(" · ")}
                </AppText>
              </View>
              {overdue(tk.due_at) && tk.status !== "done" ? <Badge label="Overdue" tone="danger" /> : <Badge label={tk.priority} tone={priorityTone(tk.priority)} />}
            </Row>
          </Card>
        ))}
      </Screen>
      <Pressable accessibilityLabel="New task" onPress={() => router.push("/task/new")}
        style={({ pressed }) => ({ position: "absolute", right: 20, bottom: 24, width: 56, height: 56, borderRadius: 28, backgroundColor: t.primary, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.85 : 1, elevation: 4, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } })}>
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </View>
  );
}
