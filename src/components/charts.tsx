"use client";

import {
  Bar, BarChart, CartesianGrid, Cell, Funnel, FunnelChart, LabelList, Line, LineChart,
  Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { stageLabel, STAGES } from "@/lib/constants";

const BLUE = "#0052CC";
const PALETTE = ["#0052CC", "#2684FF", "#4C9AFF", "#00875A", "#36B37E", "#FF991F", "#DE350B", "#6554C0", "#00B8D9", "#97A0AF"];
const axis = { fontSize: 11, fill: "#64748b" };
const tooltipStyle = { borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 };

export type NameValue = { name: string; value: number };

const compact = (v: number) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(0)}k` : String(v));

export function HBar({ data, height = 280, label = "Leads", currency = false }: { data: NameValue[]; height?: number; label?: string; currency?: boolean }) {
  if (!data.length) return <NoData />;
  const rows = data.map((d) => ({ ...d, value: Number(d.value) }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 24 }}>
        <CartesianGrid horizontal={false} stroke="#e2e8f0" strokeDasharray="3 3" />
        <XAxis type="number" tick={axis} allowDecimals={false} tickFormatter={currency ? compact : undefined} />
        <YAxis type="category" dataKey="name" width={130} tick={axis} interval={0} />
        <Tooltip contentStyle={tooltipStyle} formatter={currency ? (v: number) => `LKR ${new Intl.NumberFormat("en-LK").format(v)}` : undefined} />
        <Bar dataKey="value" name={label} fill={BLUE} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StageFunnel({ data }: { data: NameValue[] }) {
  const order = ["new", "researching", "contacted", "interested", "meeting_scheduled", "quotation_sent", "negotiation", "won"];
  const map = new Map(data.map((d) => [d.name, Number(d.value)]));
  // Cumulative: a lead in a later stage has passed through earlier ones.
  let running = 0;
  const rows = [...order].reverse().map((s) => {
    running += map.get(s) ?? 0;
    return { name: stageLabel(s), value: running };
  }).reverse().filter((r) => r.value > 0);
  if (!rows.length) return <NoData />;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <FunnelChart>
        <Tooltip contentStyle={tooltipStyle} />
        <Funnel dataKey="value" data={rows} isAnimationActive={false}>
          {rows.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          <LabelList position="right" dataKey="name" fill="#475569" stroke="none" fontSize={11} />
          <LabelList position="center" dataKey="value" fill="#fff" stroke="none" fontSize={11} />
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  );
}

export function StageBars({ data }: { data: NameValue[] }) {
  const map = new Map(data.map((d) => [d.name, Number(d.value)]));
  const rows = STAGES.map((s) => ({ name: s.label, value: map.get(s.value) ?? 0 }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={rows} margin={{ bottom: 40 }}>
        <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
        <XAxis dataKey="name" tick={axis} angle={-35} textAnchor="end" interval={0} />
        <YAxis tick={axis} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Bar dataKey="value" name="Leads" fill={BLUE} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Monthly({ data }: { data: { month: string; new_leads: number; won: number; revenue: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data}>
        <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
        <XAxis dataKey="month" tick={axis} />
        <YAxis yAxisId="l" tick={axis} allowDecimals={false} />
        <YAxis yAxisId="r" orientation="right" tick={axis} tickFormatter={compact} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line yAxisId="l" type="monotone" dataKey="new_leads" name="New leads" stroke="#4C9AFF" strokeWidth={2} dot={false} />
        <Line yAxisId="l" type="monotone" dataKey="won" name="Won" stroke="#00875A" strokeWidth={2} dot={false} />
        <Line yAxisId="r" type="monotone" dataKey="revenue" name="Revenue (LKR)" stroke="#FF991F" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function NoData() {
  return <div className="grid h-48 place-items-center text-sm text-slate-400">No data yet</div>;
}
