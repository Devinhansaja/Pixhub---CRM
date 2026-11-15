import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { DateTimeField } from "@/components/DateTimeField";
import { AppText, Button, Card, Chips, ErrorBox, Input, Screen, SelectField } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { PRIORITIES } from "@/lib/constants";
import { loadAssignees } from "@/lib/leads";
import { supabase } from "@/lib/supabase";
import { space } from "@/theme";

export default function NewTask() {
  const { contact, name } = useLocalSearchParams<{ contact?: string; name?: string }>();
  const router = useRouter();
  const { profile, isManager } = useAuth();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [due, setDue] = useState<Date | null>(null);
  const [assignee, setAssignee] = useState<string>(profile!.id);
  const [people, setPeople] = useState<{ id: string; full_name: string; role: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (isManager) loadAssignees().then(setPeople); }, [isManager]);

  const save = async () => {
    if (!title.trim()) return setError("Give the task a title.");
    setSaving(true); setError(null);
    const { error: e } = await supabase.from("tasks").insert({
      title: title.trim().slice(0, 300), description: description.trim() || null, priority, due_at: due?.toISOString() ?? null,
      assigned_to: assignee, contact_id: contact || null, created_by: profile!.id,
    });
    setSaving(false);
    if (e) setError(e.message); else router.back();
  };

  return (
    <Screen>
      {error && <ErrorBox message={error} />}
      {name && <AppText muted>For lead: <AppText style={{ fontWeight: "600" }}>{name}</AppText></AppText>}
      <Card style={{ gap: space.lg }}>
        <Input label="Title *" value={title} onChangeText={setTitle} placeholder="e.g. Send website proposal" autoFocus />
        <Input label="Details" value={description} onChangeText={setDescription} multiline />
        <AppText variant="label" muted>Priority</AppText>
        <Chips value={priority} onChange={setPriority} options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))} />
        <DateTimeField label="Due" value={due} onChange={setDue} />
        {isManager && people.length > 0 && (
          <SelectField label="Assign to" value={assignee} onChange={setAssignee} options={people.map((p) => ({ value: p.id, label: p.id === profile!.id ? `${p.full_name} (me)` : p.full_name }))} />
        )}
      </Card>
      <Button title="Create task" onPress={save} loading={saving} full />
    </Screen>
  );
}
