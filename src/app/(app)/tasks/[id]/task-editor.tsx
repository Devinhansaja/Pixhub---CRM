"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Card, CardHeader, Input, Label, Select, Textarea } from "@/components/ui";
import { PRIORITIES, TASK_STATUSES } from "@/lib/constants";
import { useAction } from "@/lib/use-action";
import { fromColomboInput, toColomboInput } from "@/lib/utils";
import { addTaskComment, deleteTask, setTaskStatus, updateTask } from "../actions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function TaskEditor({ task, assignees, canManage, canDelete }: { task: any; assignees: { id: string; full_name: string }[]; canManage: boolean; canDelete: boolean }) {
  const router = useRouter();
  const save = useAction();
  const status = useAction();
  const [busy, start] = useTransition();
  const [delError, setDelError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader title="Task" action={
        <Select className="h-8 w-40" value={task.status} disabled={status.pending} onChange={(e) => status.run(() => setTaskStatus(task.id, e.target.value))}>
          {TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
      } />
      <form className="space-y-3 p-5" onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        for (const k of ["due_at", "remind_at"]) {
          const v = String(fd.get(`${k}_local`) ?? "");
          fd.set(k, v ? fromColomboInput(v) : "");
        }
        save.run(() => updateTask(task.id, fd));
      }}>
        <div><Label>Title</Label><Input name="title" defaultValue={task.title} required maxLength={300} /></div>
        <div><Label>Description</Label><Textarea name="description" rows={5} defaultValue={task.description ?? ""} maxLength={5000} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Due</Label><Input name="due_at_local" type="datetime-local" defaultValue={task.due_at ? toColomboInput(new Date(task.due_at)) : ""} /></div>
          <div><Label>Reminder</Label><Input name="remind_at_local" type="datetime-local" defaultValue={task.remind_at ? toColomboInput(new Date(task.remind_at)) : ""} /></div>
          <div><Label>Priority</Label><Select name="priority" defaultValue={task.priority}>{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></div>
          <div><Label>Assignee</Label>
            <Select name="assigned_to" defaultValue={task.assigned_to ?? ""} disabled={!canManage}>
              {assignees.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </Select>
          </div>
        </div>
        {(save.error || save.message || status.error) && <Alert kind={save.error || status.error ? "error" : "success"}>{save.error ?? status.error ?? save.message}</Alert>}
        <div className="flex justify-between">
          <Button disabled={save.pending}>{save.pending ? "Saving…" : "Save"}</Button>
          {canDelete && (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => start(async () => {
              if (!confirm("Delete this task?")) return;
              const r = await deleteTask(task.id);
              if (r.ok) router.push("/tasks"); else setDelError(r.error);
            })}>Delete</Button>
          )}
        </div>
        {delError && <Alert kind="error">{delError}</Alert>}
      </form>
    </Card>
  );
}

export function CommentForm({ taskId }: { taskId: string }) {
  const [text, setText] = useState("");
  const { run, pending, error } = useAction();
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(() => addTaskComment(taskId, text), () => setText("")); }}>
      <Textarea rows={2} placeholder="Add a comment" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
      <div className="mt-2 flex justify-end"><Button size="sm" disabled={pending || !text.trim()}>Comment</Button></div>
      {error && <Alert kind="error">{error}</Alert>}
    </form>
  );
}
