import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Linking, Pressable, View } from "react-native";
import { DateTimeField } from "@/components/DateTimeField";
import { Sheet } from "@/components/Sheet";
import {
  AppText, Badge, Button, Card, Chips, Divider, ErrorBox, IconButton, Input, KeyValue, ListItem, Loading, Notice,
  PickerSheet, Row, Screen, SectionHeader, type IconName,
} from "@/components/ui";
import { useData } from "@/hooks/useData";
import { useResponsive } from "@/hooks/useResponsive";
import { useAuth } from "@/lib/auth";
import { FOLLOW_UP_CHANNELS, STAGES, quotationLabel, quotationTone, stageLabel, stageTone } from "@/lib/constants";
import { formatDate, formatPhone, money, relative } from "@/lib/format";
import { changeStage, loadAssignees, logActivity } from "@/lib/leads";
import { check, supabase } from "@/lib/supabase";
import { space, useTheme } from "@/theme";

interface Lead {
  id: string; company_name: string; industry: string | null; contact_person: string | null; mobile: string | null; landline: string | null;
  email: string | null; district: string | null; city: string | null; address: string | null; website: string | null; facebook_url: string | null;
  notes: string | null; stage: string; lead_score: number; score_breakdown: { factor?: string; points?: number; kind?: string; evidence?: string }[];
  estimated_value: number | null; do_not_contact: boolean; email_status: string | null; assigned_to: string | null;
  last_contacted_at: string | null; created_at: string; owner: { full_name: string } | null;
}

export default function LeadDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useTheme();
  const { profile, isManager } = useAuth();
  const { isTablet } = useResponsive();
  const [sheet, setSheet] = useState<null | "stage" | "note" | "follow" | "assign">(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [fu, setFu] = useState<{ when: Date | null; channel: string; note: string }>({ when: null, channel: "call", note: "" });
  const [tab, setTab] = useState<"activity" | "deals">("activity");

  const { data, loading, error, reload, refresh, refreshing } = useData(async () => {
    const [lead, recs, acts, follows, deals, quotes, tasks] = await Promise.all([
      supabase.from("contacts").select("*, owner:profiles!contacts_assigned_to_fkey(full_name)").eq("id", id).maybeSingle(),
      supabase.from("lead_service_recommendations").select("id,confidence,reason,basis,service:services(name,base_price)").eq("contact_id", id).order("confidence", { ascending: false }),
      supabase.from("deal_activities").select("id,type,description,created_at,by:profiles!deal_activities_created_by_fkey(full_name)").eq("contact_id", id).order("created_at", { ascending: false }).limit(40),
      supabase.from("follow_ups").select("id,due_at,channel,note,status").eq("contact_id", id).eq("status", "pending").order("due_at"),
      supabase.from("deals").select("id,title,value,stage,probability").eq("contact_id", id).order("created_at", { ascending: false }),
      supabase.from("quotations").select("id,number,status,total,issue_date").eq("contact_id", id).order("created_at", { ascending: false }),
      supabase.from("tasks").select("id,title,status,due_at,priority").eq("contact_id", id).in("status", ["todo", "in_progress"]).order("due_at"),
    ]);
    const l = check(lead) as unknown as Lead | null;
    if (!l) throw new Error("This lead doesn't exist or you don't have access to it.");
    return {
      lead: l,
      recs: (check(recs) ?? []) as unknown as { id: string; confidence: number; reason: string; basis: string; service: { name: string; base_price: number | null } | null }[],
      acts: (check(acts) ?? []) as unknown as { id: string; type: string; description: string; created_at: string; by: { full_name: string } | null }[],
      follows: (check(follows) ?? []) as { id: string; due_at: string; channel: string; note: string | null }[],
      deals: (check(deals) ?? []) as { id: string; title: string; value: number; stage: string; probability: number }[],
      quotes: (check(quotes) ?? []) as { id: string; number: string; status: string; total: number; issue_date: string }[],
      tasks: (check(tasks) ?? []) as { id: string; title: string; status: string; due_at: string | null; priority: string }[],
    };
  }, [id]);

  const [assignees, setAssignees] = useState<{ id: string; full_name: string; role: string }[]>([]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <Screen><ErrorBox message={error} onRetry={reload} /></Screen>;
  const { lead } = data!;
  const me = profile!.id;

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await fn(); await reload(); if (done) Alert.alert(done); }
    catch (e) { Alert.alert("Couldn't save", e instanceof Error ? e.message : "Unknown error"); }
    finally { setBusy(false); }
  };

  const blocked = () => {
    if (!lead.do_not_contact) return false;
    Alert.alert("Do not contact", "This lead asked not to be contacted. Outreach is blocked.");
    return true;
  };

  const call = (num: string) => {
    if (blocked()) return;
    Linking.openURL(`tel:${num}`);
    logActivity(lead.id, me, "call", `Call started to ${formatPhone(num)} from the mobile app`).then(reload, () => {});
  };
  const whatsapp = () => {
    if (blocked() || !lead.mobile) return;
    Linking.openURL(`https://wa.me/${lead.mobile.replace("+", "")}`).catch(() => Alert.alert("WhatsApp is not installed"));
    // Opening a chat does NOT mean a message was sent — record it honestly.
    logActivity(lead.id, me, "whatsapp", "WhatsApp chat opened from the mobile app (not confirmed sent)").then(reload, () => {});
  };
  const email = () => { if (!blocked() && lead.email) Linking.openURL(`mailto:${lead.email}`); };
  const open = (url: string) => Linking.openURL(url).catch(() => Alert.alert("Couldn't open the link"));

  const quick: { icon: IconName; label: string; onPress: () => void; show: boolean }[] = [
    { icon: "call", label: "Call", onPress: () => lead.mobile ? call(lead.mobile) : lead.landline && call(lead.landline), show: !!(lead.mobile || lead.landline) },
    { icon: "logo-whatsapp", label: "WhatsApp", onPress: whatsapp, show: !!lead.mobile },
    { icon: "mail", label: "Email", onPress: email, show: !!lead.email },
    { icon: "globe", label: "Website", onPress: () => open(lead.website!), show: !!lead.website },
    { icon: "logo-facebook", label: "Facebook", onPress: () => open(lead.facebook_url!), show: !!lead.facebook_url },
  ];

  const typeIcon: Record<string, IconName> = { note: "document-text-outline", call: "call-outline", whatsapp: "logo-whatsapp", email: "mail-outline", meeting: "people-outline", stage_change: "swap-horizontal-outline", assignment: "person-add-outline", import: "cloud-upload-outline", system: "flash-outline" };

  return (
    <>
      <Stack.Screen options={{ title: lead.company_name, headerRight: () => <IconButton icon="create-outline" label="Edit lead" onPress={() => router.push({ pathname: "/lead/edit", params: { id: lead.id } })} /> }} />
      <Screen refreshing={refreshing} onRefresh={refresh}>
        {/* Header */}
        <Card style={{ gap: space.md }}>
          <Row style={{ alignItems: "flex-start" }}>
            <View style={{ flex: 1, gap: 4 }}>
              <AppText variant="heading" selectable>{lead.company_name}</AppText>
              <AppText muted>{[lead.industry, lead.city, lead.district].filter(Boolean).join(" · ") || "—"}</AppText>
            </View>
            <View style={{ alignItems: "center" }}>
              <AppText variant="title" color={lead.lead_score >= 70 ? t.success : lead.lead_score >= 45 ? t.warning : t.textMuted}>{lead.lead_score}</AppText>
              <AppText variant="caption" muted>score</AppText>
            </View>
          </Row>
          <Row wrap gap={8}>
            <Pressable onPress={() => setSheet("stage")}><Badge label={`${stageLabel(lead.stage)}  ▾`} tone={stageTone(lead.stage)} /></Pressable>
            <Pressable disabled={!isManager} onPress={async () => { setAssignees(await loadAssignees()); setSheet("assign"); }}>
              <Badge label={`👤 ${lead.owner?.full_name ?? "Unassigned"}${isManager ? "  ▾" : ""}`} tone="neutral" />
            </Pressable>
            {lead.estimated_value ? <Badge label={money(lead.estimated_value)} tone="success" /> : null}
            {lead.do_not_contact && <Badge label="Do not contact" tone="danger" icon="hand-left" />}
            {lead.email_status && lead.email_status !== "ok" && <Badge label={`Email ${lead.email_status}`} tone="warning" />}
          </Row>
          {quick.some((q) => q.show) && (
            <Row gap={isTablet ? space.lg : space.sm} style={{ justifyContent: isTablet ? "flex-start" : "space-around" }}>
              {quick.filter((q) => q.show).map((q) => (
                <Pressable key={q.label} onPress={q.onPress} style={({ pressed }) => ({ alignItems: "center", gap: 4, opacity: pressed ? 0.6 : 1, minWidth: 60 })}>
                  <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: q.icon === "logo-whatsapp" ? "#25D366" : t.primarySoft, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name={q.icon} size={21} color={q.icon === "logo-whatsapp" ? "#fff" : t.primary} />
                  </View>
                  <AppText variant="caption" muted>{q.label}</AppText>
                </Pressable>
              ))}
            </Row>
          )}
        </Card>

        {/* Actions */}
        <Row wrap gap={8}>
          <Button small icon="create-outline" title="Add note" variant="secondary" onPress={() => setSheet("note")} />
          <Button small icon="alarm-outline" title="Follow-up" variant="secondary" onPress={() => setSheet("follow")} />
          <Button small icon="checkbox-outline" title="Task" variant="secondary" onPress={() => router.push({ pathname: "/task/new", params: { contact: lead.id, name: lead.company_name } })} />
          <Button small icon="document-text-outline" title="Quotation" variant="secondary" onPress={() => router.push({ pathname: "/quotations/new", params: { contact: lead.id, name: lead.company_name } })} />
          {lead.email && <Button small icon="return-down-back-outline" title="They replied" variant="secondary" loading={busy}
            onPress={() => act(async () => check(await supabase.rpc("mark_email_replied", { p_contact: lead.id })), "Marked as replied — email follow-ups stopped.")} />}
        </Row>

        {/* Pending follow-ups */}
        {data!.follows.length > 0 && (
          <Card style={{ gap: 4 }}>
            <AppText variant="subheading">Upcoming follow-ups</AppText>
            {data!.follows.map((f) => (
              <ListItem key={f.id} icon="alarm-outline" title={`${f.channel} · ${formatDate(f.due_at, true)}`} subtitle={f.note}
                right={<Row gap={4}>
                  <IconButton icon="checkmark-circle" color={t.success} label="Done" onPress={() => act(async () => check(await supabase.from("follow_ups").update({ status: "done", completed_at: new Date().toISOString() }).eq("id", f.id)))} />
                  <IconButton icon="close-circle-outline" color={t.textMuted} label="Cancel" onPress={() => act(async () => check(await supabase.from("follow_ups").update({ status: "cancelled", completed_at: new Date().toISOString() }).eq("id", f.id)))} />
                </Row>} chevron={false} />
            ))}
          </Card>
        )}

        <View style={{ flexDirection: isTablet ? "row" : "column", gap: space.lg, alignItems: "flex-start" }}>
          {/* Details */}
          <Card style={{ flex: 1, alignSelf: "stretch", gap: 2 }}>
            <AppText variant="subheading" style={{ marginBottom: 4 }}>Contact details</AppText>
            <KeyValue icon="person-outline" label="Contact person" value={lead.contact_person} />
            <KeyValue icon="call-outline" label="Mobile" value={formatPhone(lead.mobile)} onPress={lead.mobile ? () => call(lead.mobile!) : undefined} />
            <KeyValue icon="call-outline" label="Landline" value={formatPhone(lead.landline)} onPress={lead.landline ? () => call(lead.landline!) : undefined} />
            <KeyValue icon="mail-outline" label="Email" value={lead.email} onPress={lead.email ? email : undefined} />
            <KeyValue icon="globe-outline" label="Website" value={lead.website} onPress={lead.website ? () => open(lead.website!) : undefined} />
            <KeyValue icon="location-outline" label="Address" value={lead.address} onPress={lead.address ? () => open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lead.company_name} ${lead.address}`)}`) : undefined} />
            <KeyValue icon="reader-outline" label="Notes" value={lead.notes} />
            <KeyValue icon="time-outline" label="Last contacted" value={lead.last_contacted_at ? formatDate(lead.last_contacted_at, true) : null} />
            <KeyValue icon="calendar-outline" label="Added" value={formatDate(lead.created_at)} />
          </Card>

          {/* Recommendations & score */}
          <Card style={{ flex: 1, alignSelf: "stretch", gap: space.sm }}>
            <AppText variant="subheading">Recommended PIXhub services</AppText>
            {data!.recs.length === 0 ? <AppText muted>No recommendations yet.</AppText> : data!.recs.map((r) => (
              <View key={r.id} style={{ gap: 2, paddingVertical: 4 }}>
                <Row style={{ justifyContent: "space-between" }}>
                  <AppText style={{ fontWeight: "600", flex: 1 }}>{r.service?.name ?? "Service"}</AppText>
                  <Badge label={`${r.confidence}%`} tone={r.confidence >= 70 ? "success" : "warning"} />
                </Row>
                <AppText variant="caption" muted>{r.reason}{r.service?.base_price ? ` · from ${money(r.service.base_price)}` : ""}</AppText>
              </View>
            ))}
            {Array.isArray(lead.score_breakdown) && lead.score_breakdown.length > 0 && (
              <>
                <Divider />
                <AppText variant="label" muted>Why this score</AppText>
                {lead.score_breakdown.slice(0, 8).map((b, i) => (
                  <Row key={i} style={{ justifyContent: "space-between" }}>
                    <AppText variant="caption" style={{ flex: 1 }}>{b.factor ?? "—"}{b.kind ? ` (${b.kind})` : ""}</AppText>
                    {b.points !== undefined && <AppText variant="caption" color={b.points >= 0 ? t.success : t.danger}>{b.points > 0 ? "+" : ""}{b.points}</AppText>}
                  </Row>
                ))}
              </>
            )}
          </Card>
        </View>

        <Chips value={tab} onChange={setTab} options={[{ value: "activity", label: "Timeline", count: data!.acts.length }, { value: "deals", label: "Deals, quotes & tasks", count: data!.deals.length + data!.quotes.length + data!.tasks.length }]} />
        {tab === "activity" ? (
          <Card style={{ gap: 0 }}>
            {data!.acts.length === 0 ? <AppText muted>No activity yet.</AppText> : data!.acts.map((a, i) => (
              <View key={a.id} style={{ flexDirection: "row", gap: space.md, paddingVertical: 10 }}>
                <View style={{ alignItems: "center" }}>
                  <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: t.primarySoft, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name={typeIcon[a.type] ?? "ellipse-outline"} size={15} color={t.primary} />
                  </View>
                  {i < data!.acts.length - 1 && <View style={{ width: 2, flex: 1, backgroundColor: t.border, marginTop: 4 }} />}
                </View>
                <View style={{ flex: 1, gap: 2, paddingBottom: 4 }}>
                  <AppText selectable>{a.description}</AppText>
                  <AppText variant="caption" faint>{a.by?.full_name ?? "System"} · {relative(a.created_at)}</AppText>
                </View>
              </View>
            ))}
          </Card>
        ) : (
          <View style={{ gap: space.md }}>
            <SectionHeader title="Deals" />
            <Card padded={false} style={{ paddingHorizontal: space.lg }}>
              {data!.deals.length === 0 ? <AppText muted style={{ paddingVertical: space.lg }}>No deals.</AppText> : data!.deals.map((d) => (
                <ListItem key={d.id} icon="briefcase-outline" title={d.title} subtitle={`${money(d.value)} · ${d.probability}%`} right={<Badge label={stageLabel(d.stage)} tone={stageTone(d.stage)} />} chevron={false} />
              ))}
            </Card>
            <SectionHeader title="Quotations" />
            <Card padded={false} style={{ paddingHorizontal: space.lg }}>
              {data!.quotes.length === 0 ? <AppText muted style={{ paddingVertical: space.lg }}>No quotations.</AppText> : data!.quotes.map((q) => (
                <ListItem key={q.id} icon="document-text-outline" title={q.number} subtitle={`${money(q.total)} · ${formatDate(q.issue_date)}`} right={<Badge label={quotationLabel(q.status)} tone={quotationTone(q.status)} />} onPress={() => router.push(`/quotations/${q.id}`)} />
              ))}
            </Card>
            <SectionHeader title="Open tasks" />
            <Card padded={false} style={{ paddingHorizontal: space.lg }}>
              {data!.tasks.length === 0 ? <AppText muted style={{ paddingVertical: space.lg }}>No open tasks.</AppText> : data!.tasks.map((tk) => (
                <ListItem key={tk.id} icon="checkbox-outline" title={tk.title} subtitle={tk.due_at ? formatDate(tk.due_at, true) : "No due date"} onPress={() => router.push(`/task/${tk.id}`)} />
              ))}
            </Card>
          </View>
        )}
      </Screen>

      <PickerSheet visible={sheet === "stage"} title="Move to stage" value={lead.stage} onClose={() => setSheet(null)}
        options={STAGES.map((s) => ({ value: s.value, label: s.label }))}
        onSelect={(v) => v !== lead.stage && act(() => changeStage(lead.id, me, lead.stage, v))} />

      <PickerSheet visible={sheet === "assign"} title="Assign to" value={lead.assigned_to ?? "none"} onClose={() => setSheet(null)}
        options={[{ value: "none", label: "Unassigned" }, ...assignees.map((a) => ({ value: a.id, label: a.full_name, subtitle: a.role.replace("_", " ") }))]}
        onSelect={(v) => act(async () => {
          const to = v === "none" ? null : v;
          check(await supabase.from("contacts").update({ assigned_to: to }).eq("id", lead.id));
          const name = assignees.find((a) => a.id === to)?.full_name ?? "nobody";
          await logActivity(lead.id, me, "assignment", `Assigned to ${name} by ${profile!.full_name}`);
          if (to && to !== me) await supabase.from("notifications").insert({ user_id: to, title: `Lead assigned to you: ${lead.company_name}`, body: `Assigned by ${profile!.full_name}`, link: `/leads/${lead.id}` });
        })} />

      <Sheet visible={sheet === "note"} title="Add note" onClose={() => setSheet(null)}>
        <Input value={note} onChangeText={setNote} multiline placeholder="What happened? e.g. Spoke to the owner, wants a website quote next week." autoFocus />
        <Button title="Save note" loading={busy} disabled={!note.trim()} onPress={() => act(async () => { await logActivity(lead.id, me, "note", note.trim()); setNote(""); setSheet(null); })} />
      </Sheet>

      <Sheet visible={sheet === "follow"} title="Schedule follow-up" onClose={() => setSheet(null)}>
        <Chips value={fu.channel} onChange={(channel) => setFu({ ...fu, channel })} options={FOLLOW_UP_CHANNELS} />
        <DateTimeField label="When" value={fu.when} onChange={(when) => setFu({ ...fu, when })} />
        <Input label="Note (optional)" value={fu.note} onChangeText={(n) => setFu({ ...fu, note: n })} placeholder="e.g. Send website samples" />
        <Notice icon="notifications-outline">You&apos;ll get a reminder notification an hour before it&apos;s due.</Notice>
        <Button title="Schedule" loading={busy} disabled={!fu.when} onPress={() => act(async () => {
          check(await supabase.from("follow_ups").insert({ contact_id: lead.id, due_at: fu.when!.toISOString(), channel: fu.channel, note: fu.note.trim() || null, assigned_to: me, created_by: me }));
          await logActivity(lead.id, me, "system", `Follow-up scheduled (${fu.channel}) for ${formatDate(fu.when, true)}`);
          setFu({ when: null, channel: "call", note: "" }); setSheet(null);
        })} />
      </Sheet>
    </>
  );
}
