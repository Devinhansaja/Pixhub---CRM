import { useRouter } from "expo-router";
import { View } from "react-native";
import { AppText, Badge, Card, EmptyState, ErrorBox, Loading, Notice, Row, Screen } from "@/components/ui";
import { useData } from "@/hooks/useData";
import { CAMPAIGN_STATUSES } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { check, supabase } from "@/lib/supabase";
import { space } from "@/theme";

interface C { id: string; name: string; status: string; daily_limit: number; min_gap_minutes: number; max_gap_minutes: number; created_at: string; paused_reason: string | null }

export default function Campaigns() {
  const router = useRouter();
  const { data, loading, error, refresh, refreshing, reload } = useData(async () => {
    const rows = (check(await supabase.from("email_campaigns").select("id,name,status,daily_limit,min_gap_minutes,max_gap_minutes,created_at,paused_reason").order("created_at", { ascending: false }).limit(50)) ?? []) as C[];
    const stats = await Promise.all(rows.map((c) => supabase.rpc("campaign_stats", { p_campaign: c.id }).then((r) => (r.data ?? {}) as Record<string, number>)));
    return rows.map((c, i) => ({ ...c, s: stats[i] }));
  });

  if (loading && !data) return <Loading />;
  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Notice icon="information-circle-outline">Create and write new campaigns in the web CRM. Here you can follow progress, approve, pause and resume.</Notice>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {(data ?? []).length === 0 ? <EmptyState icon="mail-outline" title="No campaigns yet" /> : data!.map((c) => {
        const st = CAMPAIGN_STATUSES[c.status] ?? { label: c.status, tone: "neutral" as const };
        return (
          <Card key={c.id} onPress={() => router.push(`/campaigns/${c.id}`)} style={{ gap: space.sm }}>
            <Row>
              <View style={{ flex: 1 }}>
                <AppText variant="subheading" numberOfLines={1}>{c.name}</AppText>
                <AppText variant="caption" muted>{c.daily_limit}/day · {c.min_gap_minutes}–{c.max_gap_minutes} min breaks · {formatDate(c.created_at)}</AppText>
              </View>
              <Badge label={st.label} tone={st.tone} />
            </Row>
            <Row wrap gap={12}>
              <AppText variant="caption">✉️ {c.s.sent ?? 0} sent</AppText>
              <AppText variant="caption">⏳ {c.s.queued ?? 0} waiting</AppText>
              <AppText variant="caption">💬 {c.s.replied ?? 0} replied</AppText>
              {(c.s.bounced ?? 0) > 0 && <AppText variant="caption">⚠️ {c.s.bounced} bounced</AppText>}
            </Row>
            {c.status === "paused" && c.paused_reason && <AppText variant="caption" muted>Paused: {c.paused_reason}</AppText>}
          </Card>
        );
      })}
    </Screen>
  );
}
