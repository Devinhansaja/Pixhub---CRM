import Link from "next/link";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { loadAssignees } from "@/lib/leads-query";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader, Select, Button } from "@/components/ui";
import { PRIORITIES, TASK_STATUSES, priorityColor, taskStatusLabel } from "@/lib/constants";
import { cn, formatDate } from "@/lib/utils";
import { FollowUpActions } from "./follow-up-actions";
import { NewTaskButton, TaskBoard, TaskItem, type TaskRow } from "./task-ui";

type Params = { view?: string; scope?: string; status?: string; priority?: string; owner?: string };

export default async function TasksPage({ searchParams }: { searchParams: Params }) {
  const profile = await requireProfile();
  const supabase = createClient();
  const canManage = profile.role !== "sales_executive";
  const team = searchParams.scope === "team" && canManage;
  const view = ["day", "board", "list"].includes(searchParams.view ?? "") ? searchParams.view! : "day";

  const taskSelect = "id,title,status,priority,due_at,assigned_to,contact:contacts(id,company_name),owner:profiles!tasks_assigned_to_fkey(full_name)";
  let tq = supabase.from("tasks").select(taskSelect).order("due_at", { ascending: true, nullsFirst: false }).limit(500);
  if (!team) tq = tq.eq("assigned_to", profile.id);
  if (view !== "list" || !searchParams.status) tq = view === "board" ? tq.in("status", ["todo", "in_progress", "done"]) : view === "day" ? tq.in("status", ["todo", "in_progress"]) : tq;
  if (view === "list") {
    if (TASK_STATUSES.some((s) => s.value === searchParams.status)) tq = tq.eq("status", searchParams.status!);
    if (PRIORITIES.some((p) => p.value === searchParams.priority)) tq = tq.eq("priority", searchParams.priority!);
    if (team && searchParams.owner && /^[0-9a-f-]{36}$/i.test(searchParams.owner)) tq = tq.eq("assigned_to", searchParams.owner);
  }
  if (view === "board") tq = tq.or(`status.neq.done,completed_at.gt.${new Date(Date.now() - 7 * 86400000).toISOString()}`);

  let fq = supabase.from("follow_ups")
    .select("id,due_at,channel,note,contact:contacts(id,company_name),owner:profiles!follow_ups_assigned_to_fkey(full_name)")
    .eq("status", "pending").order("due_at").limit(300);
  if (!team) fq = fq.eq("assigned_to", profile.id);

  const [{ data: tdata, error }, { data: fdata }, assignees] = await Promise.all([tq, view === "day" ? fq : Promise.resolve({ data: [] }), loadAssignees(supabase)]);
  const tasks = (tdata ?? []) as unknown as TaskRow[];
  type FU = { id: string; due_at: string; channel: string; note: string | null; contact: { id: string; company_name: string } | null; owner: { full_name: string } | null };
  const follows = (fdata ?? []) as unknown as FU[];

  const qs = (patch: Partial<Params>) => {
    const u = new URLSearchParams(Object.entries({ ...searchParams, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/tasks?${u}`;
  };
  const tab = (v: string, label: string) => (
    <Link href={qs({ view: v })} className={cn("rounded-lg px-3 py-1.5 text-sm", view === v ? "bg-brand-600 text-white" : "bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300")}>{label}</Link>
  );

  return (
    <>
      <PageHeader
        title="Tasks & Follow-ups"
        description={team ? "Your team's work" : "Your work"}
        actions={<NewTaskButton assignees={assignees} me={profile.id} canManage={canManage} />}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tab("day", "My day")}{tab("board", "Board")}{tab("list", "List")}
        {canManage && (
          <Link href={qs({ scope: team ? undefined : "team" })} className="ml-auto text-sm text-brand-600 hover:underline">{team ? "Show only mine" : "Show my team"}</Link>
        )}
      </div>
      {error && <Alert kind="error">{error.message}</Alert>}

      {view === "day" && <DayView tasks={tasks} follows={follows} team={team} />}
      {view === "board" && <TaskBoard tasks={tasks} showOwner={team} />}
      {view === "list" && (
        <>
          <Card className="mb-4 p-4">
            <form method="get" className="flex flex-wrap gap-3">
              <input type="hidden" name="view" value="list" />
              {team && <input type="hidden" name="scope" value="team" />}
              <Select name="status" defaultValue={searchParams.status ?? ""} className="w-44"><option value="">All statuses</option>{TASK_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</Select>
              <Select name="priority" defaultValue={searchParams.priority ?? ""} className="w-44"><option value="">All priorities</option>{PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select>
              {team && <Select name="owner" defaultValue={searchParams.owner ?? ""} className="w-52"><option value="">Everyone</option>{assignees.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}</Select>}
              <Button type="submit">Filter</Button>
            </form>
          </Card>
          {tasks.length === 0 ? <EmptyState title="No tasks match" /> : (
            <Card className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Task</th><th>Status</th><th>Priority</th><th>Due</th><th>Lead</th><th>Assignee</th></tr></thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.id}>
                      <td><Link href={`/tasks/${t.id}`} className="font-medium hover:text-brand-600">{t.title}</Link></td>
                      <td>{taskStatusLabel(t.status)}</td>
                      <td><Badge className={priorityColor(t.priority)}>{t.priority}</Badge></td>
                      <td className={cn("whitespace-nowrap", t.status !== "done" && t.due_at && t.due_at < new Date().toISOString() && "text-rose-600")}>{formatDate(t.due_at, true)}</td>
                      <td>{t.contact ? <Link href={`/leads/${t.contact.id}`} className="hover:text-brand-600">{t.contact.company_name}</Link> : "—"}</td>
                      <td>{t.owner?.full_name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </>
  );
}

function DayView({ tasks, follows, team }: {
  tasks: TaskRow[];
  follows: { id: string; due_at: string; channel: string; note: string | null; contact: { id: string; company_name: string } | null; owner: { full_name: string } | null }[];
  team: boolean;
}) {
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date());
  const startToday = new Date(`${todayStr}T00:00:00+05:30`).toISOString();
  const startTomorrow = new Date(new Date(startToday).getTime() + 86400000).toISOString();
  type Item = { kind: "task"; due: string | null; t: TaskRow } | { kind: "fu"; due: string; f: (typeof follows)[number] };
  const all: Item[] = [...tasks.map((t) => ({ kind: "task" as const, due: t.due_at, t })), ...follows.map((f) => ({ kind: "fu" as const, due: f.due_at, f }))]
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  const groups = [
    { title: "Overdue", items: all.filter((i) => i.due && i.due < startToday), danger: true },
    { title: "Today", items: all.filter((i) => i.due && i.due >= startToday && i.due < startTomorrow) },
    { title: "Upcoming & no date", items: all.filter((i) => !i.due || i.due >= startTomorrow) },
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {groups.map((g) => (
        <Card key={g.title}>
          <CardHeader title={<span className={g.danger && g.items.length ? "text-rose-600" : ""}>{g.title} ({g.items.length})</span>} />
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {g.items.length === 0 && <li className="px-5 py-8 text-center text-sm text-slate-500">Nothing here.</li>}
            {g.items.slice(0, 100).map((i) => (
              <li key={i.kind + (i.kind === "task" ? i.t.id : i.f.id)} className="px-5 py-3">
                {i.kind === "task" ? <TaskItem t={i.t} showOwner={team} /> : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/leads/${i.f.contact?.id}`} className="block truncate text-sm font-medium hover:text-brand-600">
                        <Badge className="mr-1.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{i.f.channel}</Badge>{i.f.contact?.company_name}
                      </Link>
                      <p className="mt-1 text-xs text-slate-500">{formatDate(i.f.due_at, true)}{team && i.f.owner ? ` · ${i.f.owner.full_name}` : ""}{i.f.note ? ` · ${i.f.note}` : ""}</p>
                    </div>
                    <FollowUpActions id={i.f.id} due={i.f.due_at} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
