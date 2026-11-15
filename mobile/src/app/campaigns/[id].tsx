import { Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Linking, View } from "react-native";
import { Sheet } from "@/components/Sheet";
import { AppText, Badge, Button, Card, Divider, ErrorBox, Grid, Input, Loading, Notice, Row, Screen, StatCard } from "@/components/ui";
import { useData } from "@/hooks/useData";
import { useResponsive } from "@/hooks/useResponsive";
import { useAuth } from "@/lib/auth";
import { CAMPAIGN_STATUSES, WEB_URL } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { check, supabase } from "@/lib/supabase";
import { space } from "@/theme";

interface C {
  id: string; name: string; status: string; subject: string; body: string; created_by: string | null; review_note: string | null; paused_reason: string | null;
  daily_limit: number; min_gap_minutes: number; max_gap_minutes: number; send_start_hour: number; send_end_hour: number; send_days: number[];
  followup_enabled: boolean; followup_days: number; next_send_at: string | null; created_at: string; author: { full_name: string } | null;
}
const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CampaignDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, isAdmin } = useAuth();
  const { columns } = useResponsive();
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | "speed" | "review">(null);
  const [speed, setSpeed] = useState({ daily: "", min: "", max: "", start: "", end: "" });
  const [note, setNote] = useState("");

  const { data, loading, error, reload, refresh, refreshing } = useData(async () => {
    const [c, s] = await Promise.all([
      supabase.from("email_campaigns").select("*, author:profiles!email_campaigns_created_by_fkey(full_name)").eq("id", id).maybeSingle(),
      supabase.rpc("campaign_stats", { p_campaign: id }),
    ]);
    const row = check(c) as unknown as C | null;
    if (!row) throw new Error("Campaign not found");
    return { c: row, s: (check(s) ?? {}) as Record<string, number> };
  }, [id]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <Screen><ErrorBox message={error} onRetry={reload} /></Screen>;
  const { c, s } = data!;
  const st = CAMPAIGN_STATUSES[c.status] ?? { label: c.status, tone: "neutral" as const };
  const canApprove = isAdmin || c.created_by !== profile!.id;

  const update = async (patch: Record<string, unknown>, label: string) => {
    setBusy(label);
    const { error: e } = await supabase.from("email_campaigns").update(patch).eq("id", c.id);
    setBusy(null);
    if (e) Alert.alert("Couldn't update", e.message); else reload();
  };

  const openSpeed = () => {
    setSpeed({ daily: String(c.daily_limit), min: String(c.min_gap_minutes), max: String(c.max_gap_minutes), start: String(c.send_start_hour), end: String(c.send_end_hour) });
    setSheet("speed");
  };
  const saveSpeed = async () => {
    const v = { daily: Number(speed.daily), min: Number(speed.min), max: Number(speed.max), start: Number(speed.start), end: Number(speed.end) };
    if (!(v.daily >= 1 && v.daily <= 2000)) return Alert.alert("Emails per day must be 1–2,000");
    if (!(v.min >= 1) || !(v.max >= v.min)) return Alert.alert("Breaks: shortest ≥ 1 minute, longest ≥ shortest");
    if (!(v.start >= 0 && v.end <= 24 && v.end > v.start)) return Alert.alert("Sending hours must be 0–24 and end after start");
    await update({ daily_limit: Math.round(v.daily), min_gap_minutes: v.min, max_gap_minutes: v.max, send_start_hour: Math.round(v.start), send_end_hour: Math.round(v.end) }, "speed");
    setSheet(null);
  };

  return (
    <>
      <Stack.Screen options={{ title: c.name }} />
      <Screen refreshing={refreshing} onRefresh={refresh}>
        <Card style={{ gap: space.sm }}>
          <Row>
            <View style={{ flex: 1 }}>
              <AppText variant="heading">{c.name}</AppText>
              <AppText variant="caption" muted>By {c.author?.full_name ?? "—"} · {formatDate(c.created_at)}</AppText>
            </View>
            <Badge label={st.label} tone={st.tone} />
          </Row>
          {c.status === "sending" && c.next_send_at && <AppText variant="caption" muted>Next email after {formatDate(c.next_send_at, true)}</AppText>}
          {c.status === "paused" && c.paused_reason && <Notice tone="warning" icon="pause-circle-outline">{c.paused_reason}</Notice>}
          {c.status === "draft" && c.review_note && <Notice tone="warning" icon="chatbubble-ellipses-outline">Changes requested: {c.review_note}</Notice>}
        </Card>

        <Grid columns={columns}>
          {[
            <StatCard key="q" label="Waiting to send" value={s.queued ?? 0} icon="hourglass-outline" />,
            <StatCard key="s" label="Sent" value={s.sent ?? 0} icon="paper-plane-outline" tone="primary" hint={`${s.sent_today ?? 0} today`} />,
            <StatCard key="r" label="Replied" value={s.replied ?? 0} icon="chatbubbles-outline" tone="success" />,
            <StatCard key="b" label="Bounced" value={s.bounced ?? 0} icon="alert-circle-outline" tone="danger" />,
            <StatCard key="a" label="AI held back" value={s.ai_rejected ?? 0} icon="sparkles-outline" tone="warning" />,
            <StatCard key="f" label="Follow-ups sent" value={s.followups_sent ?? 0} icon="repeat-outline" tone="violet" />,
          ]}
        </Grid>

        <Card style={{ gap: space.md }}>
          <AppText variant="subheading">Controls</AppText>
          {c.status === "draft" && <Button title="Submit for approval" icon="send-outline" loading={busy === "submit"} onPress={() => update({ status: "pending_approval", review_note: null }, "submit")} />}
          {["draft", "pending_approval"].includes(c.status) && canApprove && <Button title="Approve" icon="checkmark-circle-outline" variant="success" loading={busy === "approve"} onPress={() => update({ status: "approved", review_note: null }, "approve")} />}
          {c.status === "pending_approval" && canApprove && <Button title="Request changes" variant="secondary" onPress={() => setSheet("review")} />}
          {c.status === "approved" && <Button title="Start sending (opens web CRM)" icon="play-outline" onPress={() => Linking.openURL(`${WEB_URL}/campaigns/${c.id}`)} />}
          {c.status === "sending" && <Button title="Pause" icon="pause-outline" variant="secondary" loading={busy === "pause"} onPress={() => update({ status: "paused", paused_reason: "Paused by a user (mobile app)" }, "pause")} />}
          {c.status === "paused" && <Button title="Resume sending" icon="play-outline" loading={busy === "resume"} onPress={() => update({ status: "sending", paused_reason: null, next_send_at: null }, "resume")} />}
          {["sending", "paused", "approved", "draft", "pending_approval"].includes(c.status) && <Button title="Change speed & hours" icon="speedometer-outline" variant="secondary" onPress={openSpeed} />}
          {["sending", "paused", "approved"].includes(c.status) && <Button title="Cancel campaign" variant="danger" onPress={() =>
            Alert.alert("Cancel this campaign?", "Emails that haven't been sent yet will not go out.", [{ text: "Keep", style: "cancel" }, {
              text: "Cancel campaign", style: "destructive", onPress: async () => {
                await update({ status: "cancelled" }, "cancel");
                await supabase.from("email_messages").update({ status: "skipped", error: "Campaign cancelled" }).eq("campaign_id", c.id).eq("status", "queued");
              },
            }])} />}
        </Card>

        <Card style={{ gap: space.sm }}>
          <AppText variant="subheading">Pace</AppText>
          <AppText muted>Up to {c.daily_limit} emails a day, a random {c.min_gap_minutes}–{c.max_gap_minutes} minute break between emails, {c.send_start_hour}:00–{c.send_end_hour}:00 Sri Lanka time on {c.send_days.map((d) => DAYS[d]).join(", ")}.</AppText>
          {c.followup_enabled && <AppText muted>Follow-up after {c.followup_days} day(s) if there&apos;s no reply.</AppText>}
          <Divider />
          <AppText variant="subheading">Email</AppText>
          <AppText style={{ fontWeight: "600" }}>{c.subject}</AppText>
          <AppText muted selectable>{c.body}</AppText>
        </Card>
      </Screen>

      <Sheet visible={sheet === "speed"} title="Speed & hours" onClose={() => setSheet(null)}>
        <Input label="Max emails per day" value={speed.daily} onChangeText={(v) => setSpeed({ ...speed, daily: v })} keyboardType="number-pad" />
        <Row gap={space.sm}>
          <View style={{ flex: 1 }}><Input label="Shortest break (min)" value={speed.min} onChangeText={(v) => setSpeed({ ...speed, min: v })} keyboardType="decimal-pad" /></View>
          <View style={{ flex: 1 }}><Input label="Longest break (min)" value={speed.max} onChangeText={(v) => setSpeed({ ...speed, max: v })} keyboardType="decimal-pad" /></View>
        </Row>
        <Row gap={space.sm}>
          <View style={{ flex: 1 }}><Input label="Start hour (0–23)" value={speed.start} onChangeText={(v) => setSpeed({ ...speed, start: v })} keyboardType="number-pad" /></View>
          <View style={{ flex: 1 }}><Input label="End hour (1–24)" value={speed.end} onChangeText={(v) => setSpeed({ ...speed, end: v })} keyboardType="number-pad" /></View>
        </Row>
        <Button title="Save" loading={busy === "speed"} onPress={saveSpeed} />
      </Sheet>
      <Sheet visible={sheet === "review"} title="Request changes" onClose={() => setSheet(null)}>
        <Input value={note} onChangeText={setNote} multiline placeholder="What should be changed?" autoFocus />
        <Button title="Send back to draft" disabled={!note.trim()} loading={busy === "review"} onPress={async () => { await update({ status: "draft", review_note: note.trim().slice(0, 1000) }, "review"); setSheet(null); setNote(""); }} />
      </Sheet>
    </>
  );
}
