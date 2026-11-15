import Link from "next/link";
import { AlertTriangle, CalendarClock, MessageCircle, Phone, Users } from "lucide-react";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { Alert, Card, CardHeader, PageHeader, ScoreBadge } from "@/components/ui";
import { HBar, Monthly, StageFunnel } from "@/components/charts";
import { formatDate, formatLKR, formatNumber } from "@/lib/utils";
import { conversionRate, type Breakdowns, type DashboardStats } from "@/lib/stats";
import { formatPhone } from "@/lib/phone";

export default async function DashboardPage({ searchParams }: { searchParams: { error?: string } }) {
  const profile = await requireProfile();
  const supabase = createClient();

  const now = new Date().toISOString();
  const [statsRes, bdRes, followRes, hotRes] = await Promise.all([
    supabase.rpc("dashboard_stats"),
    supabase.rpc("dashboard_breakdowns"),
    supabase
      .from("follow_ups")
      .select("id,due_at,channel,note,contact:contacts(id,company_name,mobile)")
      .eq("status", "pending")
      .eq("assigned_to", profile.id)
      .order("due_at")
      .limit(8),
    supabase
      .from("contacts")
      .select("id,company_name,industry,lead_score,mobile")
      .eq("do_not_contact", false)
      .in("stage", ["new", "researching"])
      .order("lead_score", { ascending: false })
      .limit(8),
  ]);

  if (statsRes.error) {
    return (
      <Alert kind="error">
        Could not load dashboard: {statsRes.error.message}. Have the database migrations been applied?
      </Alert>
    );
  }
  const s = statsRes.data as DashboardStats;
  const b = (bdRes.data ?? {}) as Breakdowns;

  const kpis = [
    { label: "Total leads", value: formatNumber(s.total_leads), sub: `${formatNumber(s.new_leads_7d)} added in 7 days` },
    { label: "Qualified (score ≥ 60)", value: formatNumber(s.qualified), sub: `${formatNumber(s.valid_mobiles)} with valid mobile` },
    { label: "Contacted", value: formatNumber(s.contacted), sub: `${formatNumber(s.interested)} interested` },
    { label: "Quotations sent", value: formatNumber(s.quotations_sent), sub: `${formatNumber(s.pending_quotations)} quotations open` },
    { label: "Won / Lost", value: `${formatNumber(s.won)} / ${formatNumber(s.lost)}`, sub: `${conversionRate(s)}% conversion of contacted` },
    { label: "Revenue (won)", value: formatLKR(s.revenue), sub: "Won deals + won leads without deals" },
    { label: "Pipeline value", value: formatLKR(s.pipeline_value), sub: `${formatLKR(s.weighted_pipeline)} weighted · ${formatNumber(s.open_deals)} open deals` },
    { label: "Overdue follow-ups", value: formatNumber(s.overdue_follow_ups), sub: `${formatNumber(s.follow_ups_today)} due today`, warn: s.overdue_follow_ups > 0 },
  ];

  return (
    <>
      <PageHeader
        title={`Good day, ${profile.full_name.split(" ")[0]}`}
        description={profile.role === "sales_executive" ? "Figures cover the leads assigned to you." : profile.role === "sales_manager" ? "Figures cover your team's and unassigned leads." : "Company-wide figures."}
      />
      {searchParams.error === "forbidden" && <div className="mb-4"><Alert kind="warn">You don&apos;t have access to that page.</Alert></div>}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { href: "/tasks", label: "Follow-ups today", value: s.follow_ups_today, warn: false },
          { href: "/tasks", label: "Overdue follow-ups", value: s.overdue_follow_ups, warn: s.overdue_follow_ups > 0 },
          { href: "/tasks?view=list&status=todo", label: "Tasks due today", value: s.tasks_due_today, sub: s.tasks_overdue ? `${s.tasks_overdue} overdue` : undefined, warn: s.tasks_overdue > 0 },
          { href: "/tasks", label: "Upcoming meetings", value: s.meetings_upcoming, warn: false },
          profile.role === "sales_executive"
            ? { href: "/quotations", label: "Open quotations", value: s.pending_quotations, warn: false }
            : { href: "/quotations?status=pending_approval", label: "Awaiting your approval", value: s.quotations_awaiting_approval, warn: s.quotations_awaiting_approval > 0 },
        ].map((d) => (
          <Link key={d.label} href={d.href} className="rounded-xl border border-brand-100 bg-brand-50/60 p-4 transition-colors hover:bg-brand-50 dark:border-brand-700/30 dark:bg-brand-700/10">
            <p className="text-xs font-medium text-brand-700 dark:text-brand-100">{d.label}</p>
            <p className={`mt-1 text-2xl font-semibold tabular-nums ${d.warn ? "text-rose-600" : ""}`}>{formatNumber(d.value)}</p>
            {"sub" in d && d.sub && <p className="text-xs text-rose-600">{d.sub}</p>}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="p-4">
            <p className="text-xs font-medium text-slate-500">{k.label}</p>
            <p className={`mt-1 text-xl font-semibold tabular-nums sm:text-2xl ${k.warn ? "text-rose-600" : ""}`}>{k.value}</p>
            <p className="mt-1 truncate text-xs text-slate-500">{k.sub}</p>
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="My follow-ups"
            description="Pending, oldest first"
            action={<Link href="/tasks" className="text-xs text-brand-600 hover:underline">View all</Link>}
          />
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {(followRes.data ?? []).length === 0 && <li className="px-5 py-8 text-center text-sm text-slate-500">No pending follow-ups.</li>}
            {(followRes.data ?? []).map((f) => {
              const c = f.contact as unknown as { id: string; company_name: string; mobile: string | null } | null;
              const overdue = f.due_at < now;
              return (
                <li key={f.id} className="flex items-center gap-3 px-5 py-3">
                  {overdue ? <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" /> : <CalendarClock className="h-4 w-4 shrink-0 text-slate-400" />}
                  <div className="min-w-0 flex-1">
                    <Link href={`/leads/${c?.id}`} className="block truncate text-sm font-medium hover:text-brand-600">{c?.company_name}</Link>
                    <p className="truncate text-xs text-slate-500">{f.channel} · {f.note || "No note"}</p>
                  </div>
                  <span className={`whitespace-nowrap text-xs ${overdue ? "font-medium text-rose-600" : "text-slate-500"}`}>{formatDate(f.due_at, true)}</span>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Calls to make"
            description="Highest-scoring leads not yet contacted"
            action={<Link href="/leads?stage=new&sort=score" className="text-xs text-brand-600 hover:underline">View all</Link>}
          />
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {(hotRes.data ?? []).length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-slate-500">
                No new leads. <Link href="/import" className="text-brand-600 hover:underline">Import a database</Link>.
              </li>
            )}
            {(hotRes.data ?? []).map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                {c.mobile ? <Phone className="h-4 w-4 shrink-0 text-slate-400" /> : <Users className="h-4 w-4 shrink-0 text-slate-300" />}
                <div className="min-w-0 flex-1">
                  <Link href={`/leads/${c.id}`} className="block truncate text-sm font-medium hover:text-brand-600">{c.company_name}</Link>
                  <p className="truncate text-xs text-slate-500">{c.industry || "Unknown industry"} · {formatPhone(c.mobile) || "No mobile"}</p>
                </div>
                <ScoreBadge score={c.lead_score} />
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Monthly performance" description="New leads, won deals and revenue (last 12 months)" />
          <div className="p-4"><Monthly data={b.monthly ?? []} /></div>
        </Card>
        <Card>
          <CardHeader title="Lead conversion funnel" description="Leads that reached each stage" />
          <div className="p-4"><StageFunnel data={b.by_stage ?? []} /></div>
        </Card>
        <Card>
          <CardHeader title="Service demand" description="Recommended services across leads" />
          <div className="p-4"><HBar data={b.by_service ?? []} height={320} /></div>
        </Card>
        <Card>
          <CardHeader title="Top industries" />
          <div className="p-4"><HBar data={b.by_industry ?? []} height={320} /></div>
        </Card>
      </div>

      <p className="mt-6 flex items-center gap-2 text-xs text-slate-500">
        <MessageCircle className="h-3.5 w-3.5" /> All figures are calculated live from database records.
      </p>
    </>
  );
}
