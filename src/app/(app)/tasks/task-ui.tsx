"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Plus } from "lucide-react";
import { Alert, Badge, Button, Card, Input, Label, Select, Textarea } from "@/components/ui";
import { PRIORITIES, TASK_STATUSES, priorityColor } from "@/lib/constants";
import { useAction } from "@/lib/use-action";
import { cn, formatDate, fromColomboInput, toColomboInput } from "@/lib/utils";
import { createTask, rescheduleTask, setTaskStatus } from "./actions";

export interface TaskRow {
  id: string; title: string; status: string; priority: string; due_at: string | null;
  assigned_to: string | null; contact: { id: string; company_name: string } | null; owner: { full_name: string } | null;
}

export function NewTaskButton({ assignees, me, canManage }: { assignees: { id: string; full_name: string }[]; me: string; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const { run, pending, error } = useAction();
  if (!open) return <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New task</Button>;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setOpen(false)}>
      <Card className="w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold">New task</h2>
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          for (const k of ["due_at", "remind_at"]) {
            const v = String(fd.get(`${k}_local`) ?? "");
            if (v) fd.set(k, fromColomboInput(v));
          }
          run(() => createTask(fd), () => setOpen(false));
        }}>
          <div><Label>Title *</Label><Input name="title" required maxLength={300} autoFocus /></div>
          <div><Label>Description</Label><Textarea name="description" rows={3} maxLength={5000} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Due</Label><Input name="due_at_local" type="datetime-local" defaultValue={toColomboInput(new Date(Date.now() + 86400000))} /></div>
            <div><Label>Remind me at</Label><Input name="remind_at_local" type="datetime-local" /></div>
            <div><Label>Priority</Label><Select name="priority" defaultValue="medium">{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></div>
            <div><Label>Assign to</Label>
              <Select name="assigned_to" defaultValue={me} disabled={!canManage}>
                {(canManage ? assignees : assignees.filter((a) => a.id === me)).map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
              </Select>
            </div>
          </div>
          <p className="text-xs text-slate-500">Without a reminder time, a reminder is sent one hour before the due time. Link a task to a lead from the lead&apos;s page.</p>
          {error && <Alert kind="error">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={pending}>{pending ? "Creating…" : "Create task"}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export function TaskItem({ t, showOwner }: { t: TaskRow; showOwner?: boolean }) {
  const { run, pending, error } = useAction();
  const done = t.status === "done";
  const overdue = !done && t.due_at && t.due_at < new Date().toISOString();
  return (
    <div className="flex items-start gap-3">
      <button disabled={pending} onClick={() => run(() => setTaskStatus(t.id, done ? "todo" : "done"))} aria-label={done ? "Mark not done" : "Mark done"}
        className={cn("mt-0.5 shrink-0", done ? "text-emerald-600" : "text-slate-300 hover:text-emerald-600")}>
        {done ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
      </button>
      <div className="min-w-0 flex-1">
        <Link href={`/tasks/${t.id}`} className={cn("block text-sm font-medium hover:text-brand-600", done && "text-slate-400 line-through")}>{t.title}</Link>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <Badge className={priorityColor(t.priority)}>{t.priority}</Badge>
          {t.due_at && <span className={overdue ? "font-medium text-rose-600" : ""}>{formatDate(t.due_at, true)}</span>}
          {t.contact && <Link href={`/leads/${t.contact.id}`} className="hover:text-brand-600">{t.contact.company_name}</Link>}
          {showOwner && t.owner && <span>· {t.owner.full_name}</span>}
        </div>
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
      {!done && (
        <button disabled={pending} title="Postpone 1 day" className="shrink-0 rounded px-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          onClick={() => run(() => rescheduleTask(t.id, new Date(Math.max(Date.now(), new Date(t.due_at ?? Date.now()).getTime()) + 86400000).toISOString()))}>+1d</button>
      )}
    </div>
  );
}

export function TaskBoard({ tasks, showOwner }: { tasks: TaskRow[]; showOwner: boolean }) {
  const [items, setItems] = useState(tasks);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const { run, error } = useAction();
  useEffect(() => setItems(tasks), [tasks]);
  const columns = TASK_STATUSES.filter((s) => s.value !== "cancelled");

  const drop = (status: string) => {
    if (!dragId) return;
    const t = items.find((x) => x.id === dragId);
    if (!t || t.status === status) return;
    setItems((xs) => xs.map((x) => (x.id === dragId ? { ...x, status } : x)));
    run(() => setTaskStatus(dragId, status));
  };

  return (
    <>
      {error && <div className="mb-3"><Alert kind="error">{error}</Alert></div>}
      <div className="grid gap-4 md:grid-cols-3">
        {columns.map((c) => {
          const col = items.filter((t) => t.status === c.value);
          return (
            <div key={c.value}
              onDragOver={(e) => { e.preventDefault(); setOver(c.value); }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); drop(c.value); setDragId(null); }}
              className={cn("rounded-xl bg-slate-100 p-2 dark:bg-slate-900/60", over === c.value && "ring-2 ring-brand-500")}>
              <p className="px-2 py-2 text-sm font-semibold">{c.label} <span className="font-normal text-slate-500">{col.length}</span></p>
              <div className="min-h-[120px] space-y-2">
                {col.map((t) => (
                  <div key={t.id} draggable onDragStart={() => setDragId(t.id)}
                    className="cursor-grab rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <TaskItem t={t} showOwner={showOwner} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
