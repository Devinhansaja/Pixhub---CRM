import { View } from "react-native";
import { AppText, BarList, Card, ErrorBox, Grid, Loading, Row, Screen, StatCard } from "@/components/ui";
import { useData } from "@/hooks/useData";
import { useResponsive } from "@/hooks/useResponsive";
import { quotationLabel, stageLabel } from "@/lib/constants";
import { compact, money } from "@/lib/format";
import { check, supabase } from "@/lib/supabase";
import { space, useTheme } from "@/theme";

type NV = { name: string; value: number };
interface BD {
  by_stage: NV[]; by_industry: NV[]; by_district: NV[]; by_service: NV[]; revenue_by_service: NV[];
  monthly: { month: string; new_leads: number; won: number; revenue: number }[];
  quotations_by_status: { name: string; value: number; amount: number }[];
}
interface Adv {
  score_bands: { band: string; leads: number; contacted: number; interested: number; won: number }[];
  avg_days_to_win: number | null; going_cold: number;
  win_rate_by_service: { name: string; won: number; lost: number; revenue: number }[];
}

export default function Analytics() {
  const t = useTheme();
  const { columns } = useResponsive();
  const { data, loading, error, refresh, refreshing, reload } = useData(async () => {
    const [s, b, a] = await Promise.all([supabase.rpc("dashboard_stats"), supabase.rpc("dashboard_breakdowns"), supabase.rpc("advanced_analytics")]);
    return { s: check(s) as Record<string, number>, b: check(b) as BD, a: (a.data ?? null) as Adv | null };
  });
  if (loading && !data) return <Loading />;
  if (!data) return <Screen><ErrorBox message={error ?? "Couldn't load"} onRetry={reload} /></Screen>;
  const { s, b, a } = data;
  const conv = s.total_leads ? ((s.won / s.total_leads) * 100).toFixed(1) : "0";
  const maxMonth = Math.max(1, ...b.monthly.map((m) => Number(m.new_leads)));

  const panel = (title: string, body: React.ReactNode) => (
    <Card style={{ flex: 1, minWidth: 300, gap: space.md }}><AppText variant="subheading">{title}</AppText>{body}</Card>
  );

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {error && <ErrorBox message={error} onRetry={reload} />}
      <Grid columns={columns}>
        {[
          <StatCard key="r" label="Revenue (won)" value={money(s.revenue)} icon="cash-outline" tone="success" />,
          <StatCard key="p" label="Weighted pipeline" value={money(s.weighted_pipeline)} icon="trending-up-outline" tone="violet" />,
          <StatCard key="c" label="Lead → won" value={`${conv}%`} icon="analytics-outline" tone="primary" />,
          <StatCard key="d" label="Avg days to win" value={a?.avg_days_to_win ?? "—"} icon="time-outline" tone="sky" hint={a ? `${a.going_cold} leads going cold` : undefined} />,
        ]}
      </Grid>

      <Card style={{ gap: space.md }}>
        <AppText variant="subheading">Last 12 months — new leads & wins</AppText>
        <Row style={{ alignItems: "flex-end", height: 140, gap: 4 }}>
          {b.monthly.map((m) => (
            <View key={m.month} style={{ flex: 1, alignItems: "center", gap: 4 }}>
              <View style={{ width: "70%", height: Math.max(2, (Number(m.new_leads) / maxMonth) * 110), backgroundColor: t.primary, borderRadius: 4 }} />
              <AppText variant="caption" faint style={{ fontSize: 9 }}>{m.month.slice(5)}</AppText>
            </View>
          ))}
        </Row>
        <AppText variant="caption" muted>Won this year: {b.monthly.reduce((x, m) => x + Number(m.won), 0)} · Revenue: {money(b.monthly.reduce((x, m) => x + Number(m.revenue), 0))}</AppText>
      </Card>

      <Row wrap gap={space.lg} style={{ alignItems: "flex-start" }}>
        {panel("Leads by stage", <BarList items={b.by_stage.map((x) => ({ name: stageLabel(x.name), value: Number(x.value) })).sort((p, q) => q.value - p.value)} format={compact} />)}
        {panel("Top industries", <BarList items={b.by_industry.map((x) => ({ name: x.name, value: Number(x.value) }))} format={compact} />)}
      </Row>
      <Row wrap gap={space.lg} style={{ alignItems: "flex-start" }}>
        {panel("Most recommended services", <BarList items={b.by_service.map((x) => ({ name: x.name, value: Number(x.value) }))} format={compact} />)}
        {panel("Revenue by service", <BarList items={b.revenue_by_service.map((x) => ({ name: x.name, value: Number(x.value) }))} format={(n) => money(n)} />)}
      </Row>
      <Row wrap gap={space.lg} style={{ alignItems: "flex-start" }}>
        {panel("Quotations", <BarList items={b.quotations_by_status.map((x) => ({ name: `${quotationLabel(x.name)} (${money(x.amount)})`, value: Number(x.value) }))} />)}
        {a && panel("Does the score predict wins?", (
          <View style={{ gap: 8 }}>
            {a.score_bands.map((x) => (
              <Row key={x.band} style={{ justifyContent: "space-between" }}>
                <AppText style={{ fontWeight: "600", width: 70 }}>{x.band}</AppText>
                <AppText variant="caption" muted style={{ flex: 1 }}>{compact(x.leads)} leads · {x.interested} interested · {x.won} won</AppText>
              </Row>
            ))}
          </View>
        ))}
      </Row>
    </Screen>
  );
}
