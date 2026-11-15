import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { loadAssignees } from "@/lib/leads-query";
import { Card, CardHeader } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { CommentForm, TaskEditor } from "./task-editor";

export default async function TaskPage({ params }: { params: { id: string } }) {
  const me = await requireProfile();
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const supabase = createClient();
  const { data: t } = await supabase
    .from("tasks")
    .select("*, contact:contacts(id,company_name), creator:profiles!tasks_created_by_fkey(full_name)")
    .eq("id", params.id).maybeSingle();
  if (!t) notFound();
  const [{ data: events }, assignees] = await Promise.all([
    supabase.from("task_events").select("id,type,description,created_at,author:profiles!task_events_created_by_fkey(full_name)")
      .eq("task_id", t.id).order("created_at", { ascending: false }).limit(100),
    loadAssignees(supabase),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/tasks" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600"><ArrowLeft className="h-4 w-4" /> Tasks</Link>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TaskEditor task={t} assignees={assignees} canManage={me.role !== "sales_executive"} canDelete={me.role !== "sales_executive" || t.created_by === me.id} />
        </div>
        <div className="space-y-6">
          <Card className="space-y-2 p-5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Created by</span><span>{t.creator?.full_name ?? "—"}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Created</span><span>{formatDate(t.created_at, true)}</span></div>
            {t.completed_at && <div className="flex justify-between"><span className="text-slate-500">Completed</span><span>{formatDate(t.completed_at, true)}</span></div>}
            {t.contact && <div className="flex justify-between"><span className="text-slate-500">Lead</span><Link href={`/leads/${t.contact.id}`} className="text-brand-600 hover:underline">{t.contact.company_name}</Link></div>}
          </Card>
          <Card>
            <CardHeader title="Activity" />
            <div className="p-5">
              <CommentForm taskId={t.id} />
              <ol className="mt-4 space-y-3">
                {(events ?? []).map((e) => (
                  <li key={e.id} className="text-sm">
                    <p className={e.type === "comment" ? "whitespace-pre-wrap rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60" : "text-slate-600 dark:text-slate-400"}>{e.description}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{e.type === "comment" ? `${(e.author as unknown as { full_name: string } | null)?.full_name ?? ""} · ` : ""}{formatDate(e.created_at, true)}</p>
                  </li>
                ))}
              </ol>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
