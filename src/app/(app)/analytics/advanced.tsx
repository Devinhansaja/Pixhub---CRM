import Link from "next/link";
import { Card, CardHeader } from "@/components/ui";
import { HBar, type NameValue } from "@/components/charts";
import { formatLKR, formatNumber } from "@/lib/utils";

export interface Advanced {
  outreach_funnel: NameValue[];
  score_bands: { band: string; leads: number; contacted: number; interested: number; won: number }[];
  reply_by_industry: { name: string; contacted: number; replied: number }[];
  reply_by_template: { name: string; contacted: number; replied: number }[];
  avg_days_to_win: number | null;
  avg_days_deal_close: number | null;
  win_rate_by_service: { name: string; won: number; lost: number; revenue: number; avg_deal: number | null }[];
  activity_30d: { name: string; messages: number; notes: number; tasks_done: number; follow_ups_done: number; deals_won: number }[];
  going_cold: number;
  enrichment: { checked: number; live: number; offline: number; no_website: number };
  opted_in: number;
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "—");

function RateTable({ rows, label }: { rows: { name: string; contacted: number; replied: number }[]; label: string }) {
  return (
    <table className="table-base">
      <thead><tr><th>{label}</th><th className="text-right">Contacted</th><th className="text-right">Replied</th><th className="text-right">Reply rate</th></tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-slate-500">Not enough data yet</td></tr>}
        {rows.map((r) => (
          <tr key={r.name}><td>{r.name}</td><td className="text-right tabular-nums">{formatNumber(r.contacted)}</td><td className="text-right tabular-nums">{formatNumber(r.replied)}</td><td className="text-right tabular-nums">{pct(r.replied, r.contacted)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

export function AdvancedAnalytics({ a }: { a: Advanced }) {
  return (
    <>
      <h2 className="mb-3 mt-10 text-lg font-semibold">Advanced analytics</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ["Avg. days lead → won", a.avg_days_to_win ?? "—"],
          ["Avg. days to close a deal", a.avg_days_deal_close ?? "—"],
          ["Leads going cold", formatNumber(a.going_cold)],
          ["WhatsApp opt-ins", formatNumber(a.opted_in)],
          ["Websites checked", `${formatNumber(a.enrichment.checked)} (${formatNumber(a.enrichment.offline)} offline)`],
        ].map(([l, v]) => (
          <Card key={String(l)} className="p-4"><p className="text-xs text-slate-500">{l}</p><p className="mt-1 text-lg font-semibold tabular-nums">{v}</p></Card>
        ))}
      </div>
      {a.going_cold > 0 && <p className="mt-2 text-xs text-slate-500">Going cold = interested or later, no contact for 14+ days, no follow-up scheduled. <Link href="/assistant" className="text-brand-600 hover:underline">Ask the AI assistant which to chase first</Link>.</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="WhatsApp outreach funnel" description="Distinct leads reaching each step (confirmed statuses only)" />
          <div className="p-4"><HBar data={a.outreach_funnel} height={220} /></div></Card>
        <Card className="overflow-x-auto"><CardHeader title="Does the lead score work?" description="Conversion by score band — higher bands should convert better" />
          <table className="table-base">
            <thead><tr><th>Score</th><th className="text-right">Leads</th><th className="text-right">Contacted</th><th className="text-right">Interested+</th><th className="text-right">Won</th><th className="text-right">Win rate*</th></tr></thead>
            <tbody>
              {[...a.score_bands].reverse().map((b) => (
                <tr key={b.band}><td>{b.band}</td><td className="text-right tabular-nums">{formatNumber(b.leads)}</td><td className="text-right tabular-nums">{formatNumber(b.contacted)}</td>
                  <td className="text-right tabular-nums">{formatNumber(b.interested)}</td><td className="text-right tabular-nums">{formatNumber(b.won)}</td><td className="text-right tabular-nums">{pct(b.won, b.contacted)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-slate-500">*Won ÷ contacted.</p>
        </Card>
        <Card className="overflow-x-auto"><CardHeader title="Reply rate by message template" /><RateTable rows={a.reply_by_template} label="Template" /></Card>
        <Card className="overflow-x-auto"><CardHeader title="Reply rate by industry" description="Industries with 5+ contacted leads" /><RateTable rows={a.reply_by_industry} label="Industry" /></Card>
        <Card className="overflow-x-auto"><CardHeader title="Win rate by service" description="Closed deals" />
          <table className="table-base">
            <thead><tr><th>Service</th><th className="text-right">Won</th><th className="text-right">Lost</th><th className="text-right">Win rate</th><th className="text-right">Avg. deal</th><th className="text-right">Revenue</th></tr></thead>
            <tbody>
              {a.win_rate_by_service.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-500">No closed deals yet</td></tr>}
              {a.win_rate_by_service.map((s) => (
                <tr key={s.name}><td>{s.name}</td><td className="text-right tabular-nums">{s.won}</td><td className="text-right tabular-nums">{s.lost}</td><td className="text-right tabular-nums">{pct(s.won, s.won + s.lost)}</td>
                  <td className="text-right tabular-nums">{s.avg_deal ? formatLKR(s.avg_deal) : "—"}</td><td className="text-right tabular-nums">{formatLKR(s.revenue)}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card className="overflow-x-auto"><CardHeader title="Team activity (last 30 days)" />
          <table className="table-base">
            <thead><tr><th>Salesperson</th><th className="text-right">Messages</th><th className="text-right">Notes</th><th className="text-right">Tasks done</th><th className="text-right">Follow-ups</th><th className="text-right">Deals won</th></tr></thead>
            <tbody>
              {a.activity_30d.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-500">No assigned salespeople yet</td></tr>}
              {a.activity_30d.map((p) => (
                <tr key={p.name}><td>{p.name}</td><td className="text-right tabular-nums">{p.messages}</td><td className="text-right tabular-nums">{p.notes}</td><td className="text-right tabular-nums">{p.tasks_done}</td><td className="text-right tabular-nums">{p.follow_ups_done}</td><td className="text-right tabular-nums">{p.deals_won}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
