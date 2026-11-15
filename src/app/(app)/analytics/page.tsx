import { createClient, requireProfile } from "@/lib/supabase/server";
import { Alert, Card, CardHeader, PageHeader } from "@/components/ui";
import { HBar, Monthly, StageBars, StageFunnel } from "@/components/charts";
import { conversionRate, type Breakdowns, type DashboardStats } from "@/lib/stats";
import { formatLKR, formatNumber } from "@/lib/utils";
import { QUOTATION_STATUSES, STAGES } from "@/lib/constants";
import { AdvancedAnalytics, type Advanced } from "./advanced";

export default async function AnalyticsPage() {
  const profile = await requireProfile();
  const supabase = createClient();
  const [{ data: s, error }, { data: bd }, { data: adv }] = await Promise.all([supabase.rpc("dashboard_stats"), supabase.rpc("dashboard_breakdowns"), supabase.rpc("advanced_analytics")]);
  if (error) return <Alert kind="error">{error.message}</Alert>;
  const st = s as DashboardStats;
  const b = (bd ?? {}) as Breakdowns;

  const kpis: [string, string][] = [
    ["Total leads", formatNumber(st.total_leads)], ["New (7 days)", formatNumber(st.new_leads_7d)],
    ["Qualified", formatNumber(st.qualified)], ["Contacted", formatNumber(st.contacted)],
    ["Interested", formatNumber(st.interested)], ["Quotations sent", formatNumber(st.quotations_sent)],
    ["Won", formatNumber(st.won)], ["Lost", formatNumber(st.lost)],
    ["Revenue", formatLKR(st.revenue)], ["Pipeline value", formatLKR(st.pipeline_value)],
    ["Weighted pipeline", formatLKR(st.weighted_pipeline)], ["Open deals", formatNumber(st.open_deals)],
    ["Conversion rate", `${conversionRate(st)}%`], ["Overdue follow-ups", formatNumber(st.overdue_follow_ups)],
  ];

  return (
    <>
      <PageHeader title="Analytics & Reports" description={profile.role === "admin" ? "Company-wide, live from the database." : "Scoped to the leads you can access."} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {kpis.map(([l, v]) => (
          <Card key={l} className="p-4">
            <p className="text-xs text-slate-500">{l}</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{v}</p>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Monthly sales performance" /><div className="p-4"><Monthly data={b.monthly ?? []} /></div></Card>
        <Card><CardHeader title="Lead conversion funnel" /><div className="p-4"><StageFunnel data={b.by_stage ?? []} /></div></Card>
        <Card><CardHeader title="Leads by stage" /><div className="p-4"><StageBars data={b.by_stage ?? []} /></div></Card>
        <Card><CardHeader title="Service demand" /><div className="p-4"><HBar data={b.by_service ?? []} height={300} /></div></Card>
        <Card><CardHeader title="Industry distribution (top 10)" /><div className="p-4"><HBar data={b.by_industry ?? []} height={300} /></div></Card>
        <Card><CardHeader title="District-wise leads (top 15)" /><div className="p-4"><HBar data={b.by_district ?? []} height={380} /></div></Card>
      </div>

      <Card className="mt-6 overflow-x-auto">
        <CardHeader title="Salesperson performance" />
        <table className="table-base">
          <thead><tr><th>Salesperson</th><th className="text-right">Leads</th><th className="text-right">Contacted</th><th className="text-right">Won</th><th className="text-right">Win rate</th><th className="text-right">Revenue</th></tr></thead>
          <tbody>
            {(b.by_owner ?? []).map((o) => (
              <tr key={o.name}>
                <td className="font-medium">{o.name}</td>
                <td className="text-right tabular-nums">{formatNumber(o.leads)}</td>
                <td className="text-right tabular-nums">{formatNumber(o.contacted)}</td>
                <td className="text-right tabular-nums">{formatNumber(o.won)}</td>
                <td className="text-right tabular-nums">{o.contacted ? Math.round((o.won / o.contacted) * 1000) / 10 : 0}%</td>
                <td className="text-right tabular-nums">{formatLKR(o.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Revenue by service" description="Won deals" />
          <div className="p-4"><HBar data={b.revenue_by_service ?? []} height={300} label="Revenue" currency /></div>
        </Card>
        <Card className="overflow-x-auto">
          <CardHeader title="Deals by stage" />
          <table className="table-base">
            <thead><tr><th>Stage</th><th className="text-right">Deals</th><th className="text-right">Value</th></tr></thead>
            <tbody>
              {STAGES.map((st) => {
                const r = (b.deals_by_stage ?? []).find((x) => x.name === st.value);
                return r ? <tr key={st.value}><td>{st.label}</td><td className="text-right tabular-nums">{formatNumber(r.count)}</td><td className="text-right tabular-nums">{formatLKR(r.value)}</td></tr> : null;
              })}
              {(b.deals_by_stage ?? []).length === 0 && <tr><td colSpan={3} className="py-6 text-center text-slate-500">No deals yet</td></tr>}
            </tbody>
          </table>
        </Card>
        <Card className="overflow-x-auto">
          <CardHeader title="Quotations by status" />
          <table className="table-base">
            <thead><tr><th>Status</th><th className="text-right">Count</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {QUOTATION_STATUSES.map((st) => {
                const r = (b.quotations_by_status ?? []).find((x) => x.name === st.value);
                return r ? <tr key={st.value}><td>{st.label}</td><td className="text-right tabular-nums">{formatNumber(r.value)}</td><td className="text-right tabular-nums">{formatLKR(r.amount)}</td></tr> : null;
              })}
              {(b.quotations_by_status ?? []).length === 0 && <tr><td colSpan={3} className="py-6 text-center text-slate-500">No quotations yet</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>
      {adv && <AdvancedAnalytics a={adv as Advanced} />}
    </>
  );
}
