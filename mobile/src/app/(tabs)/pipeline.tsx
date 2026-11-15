import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { LEAD_SUMMARY_COLUMNS, LeadCard, type LeadSummary } from "@/components/LeadCard";
import { AppText, Badge, Chips, EmptyState, ErrorBox, Loading, PickerSheet, Row, Screen } from "@/components/ui";
import { useData } from "@/hooks/useData";
import { useResponsive } from "@/hooks/useResponsive";
import { useAuth } from "@/lib/auth";
import { OPEN_STAGES, STAGES, stageLabel, stageTone } from "@/lib/constants";
import { money } from "@/lib/format";
import { changeStage } from "@/lib/leads";
import { check, supabase } from "@/lib/supabase";
import { radius, space, useTheme } from "@/theme";

const BOARD = [...OPEN_STAGES, "won"];
const PER_STAGE = 25;

/** Kanban pipeline: columns side by side on tablets, one stage at a time on phones. Long-press a card to move it. */
export default function Pipeline() {
  const t = useTheme();
  const router = useRouter();
  const { profile, isManager } = useAuth();
  const { isTablet, width } = useResponsive();
  const [mine, setMine] = useState(!isManager);
  const [phoneStage, setPhoneStage] = useState("interested");
  const [moving, setMoving] = useState<LeadSummary | null>(null);

  const { data, loading, error, refresh, refreshing, reload } = useData(async () => {
    const results = await Promise.all(BOARD.map(async (stage) => {
      let q = supabase.from("contacts").select(LEAD_SUMMARY_COLUMNS + ",estimated_value", { count: "exact" }).eq("stage", stage);
      if (mine) q = q.eq("assigned_to", profile!.id);
      const res = await q.order("lead_score", { ascending: false }).limit(PER_STAGE);
      return { stage, rows: (check(res) ?? []) as unknown as (LeadSummary & { estimated_value: number | null })[], count: res.count ?? 0 };
    }));
    return results;
  }, [mine]);

  if (loading && !data) return <Loading />;

  const move = async (lead: LeadSummary, to: string) => {
    try { await changeStage(lead.id, profile!.id, lead.stage, to); reload(); }
    catch (e) { Alert.alert("Couldn't move", e instanceof Error ? e.message : ""); }
  };

  const column = (c: NonNullable<typeof data>[number], colWidth?: number) => {
    const value = c.rows.reduce((s, r) => s + Number(r.estimated_value ?? 0), 0);
    return (
      <View key={c.stage} style={{ width: colWidth, gap: space.md, backgroundColor: isTablet ? t.cardAlt : "transparent", borderRadius: radius.lg, padding: isTablet ? space.md : 0 }}>
        <Row style={{ justifyContent: "space-between" }}>
          <Badge label={`${stageLabel(c.stage)} · ${c.count.toLocaleString("en-US")}`} tone={stageTone(c.stage)} />
          {value > 0 && <AppText variant="caption" muted>{money(value)}</AppText>}
        </Row>
        {c.rows.length === 0 ? <AppText variant="caption" faint>No leads here</AppText> : c.rows.map((r) => (
          <LeadCard key={r.id} lead={r} compact onPress={() => router.push(`/lead/${r.id}`)} onLongPress={() => setMoving(r)} />
        ))}
        {c.count > c.rows.length && <AppText variant="caption" faint>+{c.count - c.rows.length} more (top {PER_STAGE} by score shown)</AppText>}
      </View>
    );
  };

  const filters = (
    <Row style={{ justifyContent: "space-between" }} wrap>
      {isManager ? <Chips value={mine ? "mine" : "all"} onChange={(v) => setMine(v === "mine")} options={[{ value: "all", label: "Everyone" }, { value: "mine", label: "My leads" }]} /> : <View />}
      <AppText variant="caption" muted>Long-press a lead to move it to another stage.</AppText>
    </Row>
  );

  const mover = (
    <PickerSheet visible={!!moving} title={`Move ${moving?.company_name ?? ""}`} value={moving?.stage} onClose={() => setMoving(null)}
      options={STAGES.map((s) => ({ value: s.value, label: s.label }))} onSelect={(v) => moving && v !== moving.stage && move(moving, v)} />
  );

  if (isTablet) {
    const colW = Math.max(280, Math.min(340, width / 3.2));
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ padding: space.lg, paddingBottom: 0 }}>{filters}</View>
        {error && <View style={{ padding: space.lg }}><ErrorBox message={error} onRetry={reload} /></View>}
        <ScrollView horizontal contentContainerStyle={{ padding: space.lg, gap: space.lg, alignItems: "flex-start" }}>
          {(data ?? []).map((c) => (
            <ScrollView key={c.stage} style={{ maxHeight: "100%" }} showsVerticalScrollIndicator={false}>{column(c, colW)}</ScrollView>
          ))}
        </ScrollView>
        {mover}
      </View>
    );
  }

  const current = data?.find((c) => c.stage === phoneStage);
  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {filters}
      {error && <ErrorBox message={error} onRetry={reload} />}
      <Chips value={phoneStage} onChange={setPhoneStage} options={(data ?? []).map((c) => ({ value: c.stage, label: stageLabel(c.stage), count: c.count }))} />
      {current ? column(current) : <EmptyState title="Nothing here" />}
      {mover}
    </Screen>
  );
}
