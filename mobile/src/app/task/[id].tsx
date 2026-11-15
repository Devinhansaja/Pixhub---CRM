import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";
import { DateTimeField } from "@/components/DateTimeField";
import { AppText, Badge, Button, Card, Chips, Divider, ErrorBox, Input, KeyValue, Loading, Row, Screen } from "@/components/ui";
import { useData } from "@/hooks/useData";
import { useAuth } from "@/lib/auth";
import { TASK_STATUSES, priorityTone, taskStatusLabel } from "@/lib/constants";
import { formatDate, relative } from "@/lib/format";
import { check, supabase } from "@/lib/supabase";
import { space } from "@/theme";

interface Task {
  id: string; title: string; description: string | null; status: string; priority: string; due_at: string | null; created_at: string;
  contact: { id: string; company_name: string } | null; assignee: { full_name: string } | null; creator: { full_name: string } | null;
}

export default function TaskDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { profile } = useAuth();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useData(async () => {
    const [task, events] = await Promise.all([
      supabase.from("tasks").select("id,title,description,status,priority,due_at,created_at,contact:contacts(id,company_name),assignee:profiles!tasks_assigned_to_fkey(full_name),creator:profiles!tasks_created_by_fkey(full_name)").eq("id", id).maybeSingle(),
      supabase.from("task_events").select("id,type,description,created_at").eq("task_id", id).order("created_at", { ascending: false }).limit(50),
    ]);
    const tk = check(task) as unknown as Task | null;
    if (!tk) throw new Error("Task not found");
    return { task: tk, events: (check(events) ?? []) as { id: string; type: string; description: string; created_at: string }[] };
  }, [id]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <Screen><ErrorBox message={error} onRetry={reload} /></Screen>;
  const tk = data!.task;

  const update = async (patch: Record<string, unknown>) => {
    setBusy(true);
    const { error: e } = await supabase.from("tasks").update(patch).eq("id", tk.id);
    setBusy(false);
    if (e) Alert.alert("Couldn't update", e.message); else reload();
  };

  return (
    <Screen>
      <Card style={{ gap: space.md }}>
        <AppText variant="heading">{tk.title}</AppText>
        <Row wrap gap={6}>
          <Badge label={taskStatusLabel(tk.status)} tone={tk.status === "done" ? "success" : tk.status === "cancelled" ? "neutral" : "primary"} />
          <Badge label={tk.priority} tone={priorityTone(tk.priority)} />
          {tk.due_at && new Date(tk.due_at) < new Date() && tk.status !== "done" && <Badge label="Overdue" tone="danger" />}
        </Row>
        {tk.description && <AppText selectable>{tk.description}</AppText>}
        <Divider />
        <KeyValue icon="business-outline" label="Lead" value={tk.contact?.company_name} onPress={tk.contact ? () => router.push(`/lead/${tk.contact!.id}`) : undefined} />
        <KeyValue icon="person-outline" label="Assigned to" value={tk.assignee?.full_name ?? "Nobody"} />
        <KeyValue icon="create-outline" label="Created by" value={`${tk.creator?.full_name ?? "—"} · ${formatDate(tk.created_at)}`} />
      </Card>

      <Card style={{ gap: space.md }}>
        <AppText variant="subheading">Status</AppText>
        <Chips value={tk.status} onChange={(status) => update({ status })} options={TASK_STATUSES} />
        <DateTimeField label="Due" value={tk.due_at ? new Date(tk.due_at) : null} onChange={(d) => update({ due_at: d?.toISOString() ?? null })} />
        {tk.status !== "done" && <Button title="Mark as done" icon="checkmark-circle" variant="success" loading={busy} onPress={() => update({ status: "done" })} />}
      </Card>

      <Card style={{ gap: space.md }}>
        <AppText variant="subheading">Activity</AppText>
        <Input value={comment} onChangeText={setComment} placeholder="Add a comment…" multiline />
        <Button small title="Post comment" disabled={!comment.trim()} loading={busy} onPress={async () => {
          setBusy(true);
          const { error: e } = await supabase.from("task_events").insert({ task_id: tk.id, type: "comment", description: comment.trim().slice(0, 2000), created_by: profile!.id });
          setBusy(false);
          if (e) Alert.alert("Couldn't post", e.message); else { setComment(""); reload(); }
        }} />
        {data!.events.map((ev) => (
          <View key={ev.id} style={{ gap: 2, paddingVertical: 6 }}>
            <AppText>{ev.description}</AppText>
            <AppText variant="caption" faint>{relative(ev.created_at)}</AppText>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
