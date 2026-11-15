"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Ban, MessageCircle } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, ScoreBadge, Select } from "@/components/ui";
import { stageColor, stageLabel } from "@/lib/constants";
import { formatPhone } from "@/lib/phone";
import { waLink } from "@/lib/whatsapp";
import { cn, formatDate, formatLKR } from "@/lib/utils";
import { assignLeads } from "./actions";

export interface LeadRow {
  id: string; company_name: string; industry: string | null; district: string | null; city: string | null;
  mobile: string | null; landline: string | null; lead_score: number; stage: string; assigned_to: string | null;
  last_contacted_at: string | null; next_follow_up_at: string | null; estimated_value: number | null;
  do_not_contact: boolean; whatsapp_status: string;
  recs: { confidence: number; service: { name: string } | null }[];
}

export function LeadsTable({ rows, assignees, canManage }: {
  rows: LeadRow[]; assignees: { id: string; full_name: string }[]; canManage: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignee, setAssignee] = useState("");
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const names = new Map(assignees.map((a) => [a.id, a.full_name]));
  const now = new Date().toISOString();

  if (!rows.length) {
    return (
      <EmptyState title="No leads found">
        Try different filters, <Link className="text-brand-600 hover:underline" href="/import">import a database</Link> or add a lead manually.
      </EmptyState>
    );
  }

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allChecked = selected.size === rows.length;

  const doAssign = () => start(async () => {
    const res = await assignLeads([...selected], assignee === "none" ? null : assignee);
    setMsg(res.ok ? { kind: "success", text: res.message ?? "Assigned" } : { kind: "error", text: res.error });
    if (res.ok) { setSelected(new Set()); router.refresh(); }
  });

  return (
    <>
      {msg && <div className="mb-3"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      {canManage && selected.size > 0 && (
        <Card className="mb-3 flex flex-wrap items-center gap-3 p-3">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-56">
            <option value="">Assign to…</option>
            <option value="none">— Unassign —</option>
            {assignees.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </Select>
          <Button size="sm" disabled={!assignee || pending} onClick={doAssign}>{pending ? "Assigning…" : "Assign"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </Card>
      )}
      <Card className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              {canManage && (
                <th className="w-8">
                  <input type="checkbox" aria-label="Select all" checked={allChecked}
                    onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))} />
                </th>
              )}
              <th>Company</th><th>Industry</th><th>District</th><th>Phone</th><th>Recommended services</th>
              <th>Score</th><th>Assigned</th><th>Stage</th><th>Last contacted</th><th>Next follow-up</th><th className="text-right">Est. value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const services = [...(r.recs ?? [])].sort((a, b) => b.confidence - a.confidence).map((x) => x.service?.name).filter(Boolean) as string[];
              const wa = !r.do_not_contact ? waLink(r.mobile) : null;
              return (
                <tr key={r.id}>
                  {canManage && <td><input type="checkbox" aria-label={`Select ${r.company_name}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>}
                  <td className="max-w-[240px]">
                    <Link href={`/leads/${r.id}`} className="block truncate font-medium text-slate-900 hover:text-brand-600 dark:text-slate-100">{r.company_name}</Link>
                    {r.city && <span className="text-xs text-slate-500">{r.city}</span>}
                  </td>
                  <td className="max-w-[160px] truncate text-slate-600 dark:text-slate-400">{r.industry ?? "—"}</td>
                  <td className="whitespace-nowrap">{r.district ?? "—"}</td>
                  <td className="whitespace-nowrap">
                    {r.do_not_contact ? (
                      <span className="inline-flex items-center gap-1 text-xs text-rose-600"><Ban className="h-3.5 w-3.5" /> Do not contact</span>
                    ) : r.mobile ? (
                      <span className="inline-flex items-center gap-2">
                        {formatPhone(r.mobile)}
                        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" title="Open WhatsApp chat (does not send)" className="text-emerald-600 hover:text-emerald-700"><MessageCircle className="h-4 w-4" /></a>}
                      </span>
                    ) : r.landline ? <span className="text-slate-500">{formatPhone(r.landline)}</span> : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="max-w-[260px]">
                    <div className="flex flex-wrap gap-1">
                      {services.slice(0, 2).map((s) => <Badge key={s} className="bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100">{s}</Badge>)}
                      {services.length > 2 && <Badge>+{services.length - 2}</Badge>}
                    </div>
                  </td>
                  <td><ScoreBadge score={r.lead_score} /></td>
                  <td className="whitespace-nowrap text-slate-600 dark:text-slate-400">{r.assigned_to ? names.get(r.assigned_to) ?? "—" : <span className="text-slate-400">Unassigned</span>}</td>
                  <td><Badge className={stageColor(r.stage)}>{stageLabel(r.stage)}</Badge></td>
                  <td className="whitespace-nowrap text-slate-500">{formatDate(r.last_contacted_at)}</td>
                  <td className={cn("whitespace-nowrap", r.next_follow_up_at && r.next_follow_up_at < now ? "font-medium text-rose-600" : "text-slate-500")}>{formatDate(r.next_follow_up_at)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{r.estimated_value ? formatLKR(r.estimated_value) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
