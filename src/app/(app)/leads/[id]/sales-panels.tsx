"use client";

import Link from "next/link";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Input, Label, Select } from "@/components/ui";
import { STAGES, priorityColor, quotationColor, quotationLabel, stageColor, stageLabel, PRIORITIES } from "@/lib/constants";
import { useAction } from "@/lib/use-action";
import { formatDate, formatLKR, fromColomboInput } from "@/lib/utils";
import { createDeal, deleteDeal, updateDeal } from "../../pipeline/actions";
import { createTask } from "../../tasks/actions";

export interface Deal {
  id: string; title: string; value: number; probability: number; stage: string; expected_close_date: string | null;
  service_id: string | null; assigned_to: string | null; service: { name: string } | null;
}

function DealForm({ deal, services, assignees, canManage, onSubmit, pending, onCancel }: {
  deal?: Deal; services: { id: string; name: string }[]; assignees: { id: string; full_name: string }[];
  canManage: boolean; onSubmit: (fd: FormData) => void; pending: boolean; onCancel: () => void;
}) {
  return (
    <form className="grid gap-2 border-t border-slate-100 p-4 dark:border-slate-800"
      onSubmit={(e) => { e.preventDefault(); onSubmit(new FormData(e.currentTarget)); }}>
      <Input name="title" placeholder="Deal title, e.g. E-commerce website" defaultValue={deal?.title} required maxLength={200} />
      <Select name="service_id" defaultValue={deal?.service_id ?? ""}>
        <option value="">Service…</option>
        {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      <div className="grid grid-cols-2 gap-2">
        <div><Label>Value (LKR)</Label><Input name="value" type="number" min={0} step="0.01" defaultValue={deal?.value ?? ""} required /></div>
        <div><Label>Probability % (blank = auto)</Label><Input name="probability" type="number" min={0} max={100} defaultValue={deal ? deal.probability : ""} /></div>
        <div><Label>Stage</Label>
          <Select name="stage" defaultValue={deal?.stage ?? "interested"}>{STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
        </div>
        <div><Label>Expected close</Label><Input name="expected_close_date" type="date" defaultValue={deal?.expected_close_date ?? ""} /></div>
      </div>
      {canManage && (
        <Select name="assigned_to" defaultValue={deal?.assigned_to ?? ""}>
          <option value="">Salesperson (default: me)</option>
          {assignees.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
        </Select>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={pending}>{deal ? "Save deal" : "Create deal"}</Button>
        <Button size="sm" type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export function DealsPanel({ contactId, deals, services, assignees, canManage }: {
  contactId: string; deals: Deal[]; services: { id: string; name: string }[];
  assignees: { id: string; full_name: string }[]; canManage: boolean;
}) {
  const { run, pending, error } = useAction();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const names = new Map(assignees.map((a) => [a.id, a.full_name]));
  return (
    <Card>
      <CardHeader title={`Deals (${deals.length})`} description="One company can have several deals"
        action={editing !== "new" && <Button size="sm" variant="outline" onClick={() => setEditing("new")}><Plus className="h-3.5 w-3.5" /> New deal</Button>} />
      {error && <div className="p-4 pb-0"><Alert kind="error">{error}</Alert></div>}
      {editing === "new" && (
        <DealForm services={services} assignees={assignees} canManage={canManage} pending={pending} onCancel={() => setEditing(null)}
          onSubmit={(fd) => run(() => createDeal(contactId, fd), () => setEditing(null))} />
      )}
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {deals.length === 0 && editing !== "new" && <li className="px-5 py-4 text-sm text-slate-500">No deals yet.</li>}
        {deals.map((d) => editing === d.id ? (
          <li key={d.id}>
            <DealForm deal={d} services={services} assignees={assignees} canManage={canManage} pending={pending} onCancel={() => setEditing(null)}
              onSubmit={(fd) => run(() => updateDeal(d.id, fd), () => setEditing(null))} />
          </li>
        ) : (
          <li key={d.id} className="px-5 py-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{d.title}</p>
                <p className="text-xs text-slate-500">{d.service?.name ?? "No service"} · {d.assigned_to ? names.get(d.assigned_to) : "Unassigned"}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button onClick={() => setEditing(d.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" aria-label="Edit deal"><Pencil className="h-3.5 w-3.5" /></button>
                {canManage && <button disabled={pending} onClick={() => confirm(`Delete deal "${d.title}"?`) && run(() => deleteDeal(d.id))} className="rounded p-1 text-slate-400 hover:text-rose-600" aria-label="Delete deal"><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <Badge className={stageColor(d.stage)}>{stageLabel(d.stage)}</Badge>
              <span className="font-medium tabular-nums">{formatLKR(d.value)}</span>
              <span className="text-slate-500">{d.probability}%</span>
              {d.expected_close_date && <span className="text-slate-500">· close {formatDate(d.expected_close_date)}</span>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function QuotationsList({ contactId, quotations }: {
  contactId: string; quotations: { id: string; number: string; status: string; total: number; expiry_date: string }[];
}) {
  return (
    <Card>
      <CardHeader title={`Quotations (${quotations.length})`}
        action={<Link href={`/quotations/new?contact=${contactId}`}><Button size="sm" variant="outline"><Plus className="h-3.5 w-3.5" /> New</Button></Link>} />
      <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {quotations.length === 0 && <li className="px-5 py-4 text-slate-500">No quotations yet.</li>}
        {quotations.map((q) => (
          <li key={q.id}>
            <Link href={`/quotations/${q.id}`} className="flex items-center justify-between gap-2 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <span className="font-medium">{q.number}</span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{formatLKR(q.total)}</span>
                <Badge className={quotationColor(q.status)}>{quotationLabel(q.status)}</Badge>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function LeadTasksPanel({ contactId, tasks, assignees, me, canManage }: {
  contactId: string;
  tasks: { id: string; title: string; status: string; priority: string; due_at: string | null }[];
  assignees: { id: string; full_name: string }[]; me: string; canManage: boolean;
}) {
  const { run, pending, error } = useAction();
  const [open, setOpen] = useState(false);
  const now = new Date().toISOString();
  return (
    <Card>
      <CardHeader title="Tasks" action={!open && <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> Task</Button>} />
      {open && (
        <form className="grid gap-2 p-4" onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          fd.set("contact_id", contactId);
          const due = String(fd.get("due_local") ?? "");
          if (due) fd.set("due_at", fromColomboInput(due));
          run(() => createTask(fd), () => setOpen(false));
        }}>
          <Input name="title" placeholder="Task title" required maxLength={300} />
          <div className="grid grid-cols-2 gap-2">
            <Input name="due_local" type="datetime-local" />
            <Select name="priority" defaultValue="medium">{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select>
          </div>
          {canManage && (
            <Select name="assigned_to" defaultValue={me}>{assignees.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}</Select>
          )}
          <div className="flex gap-2"><Button size="sm" disabled={pending}>Create task</Button><Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
          {error && <Alert kind="error">{error}</Alert>}
        </form>
      )}
      <ul className="divide-y divide-slate-100 border-t border-slate-100 text-sm dark:divide-slate-800 dark:border-slate-800">
        {tasks.length === 0 && <li className="px-5 py-4 text-slate-500">No tasks.</li>}
        {tasks.map((t) => (
          <li key={t.id}>
            <Link href={`/tasks/${t.id}`} className="flex items-center justify-between gap-2 px-5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <span className={t.status === "done" ? "text-slate-400 line-through" : ""}>{t.title}</span>
              <span className="flex shrink-0 items-center gap-1 text-xs">
                <Badge className={priorityColor(t.priority)}>{t.priority}</Badge>
                {t.due_at && <span className={t.status !== "done" && t.due_at < now ? "text-rose-600" : "text-slate-500"}>{formatDate(t.due_at)}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
