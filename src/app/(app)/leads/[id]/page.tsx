import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Ban, Globe, Facebook, Mail, MapPin, Phone, User } from "lucide-react";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { loadAssignees } from "@/lib/leads-query";
import { Badge, Card, CardHeader, ScoreBadge } from "@/components/ui";
import { formatPhone } from "@/lib/phone";
import { formatDate } from "@/lib/utils";
import { outreachLabel, stageColor, stageLabel } from "@/lib/constants";
import {
  AssignControl, DetailsForm, DncControl, FollowUpPanel, NoteForm, RecommendationsPanel,
  StageControl, VerificationPanel, WhatsAppPanel,
} from "./panels";
import { DealsPanel, LeadTasksPanel, QuotationsList, type Deal } from "./sales-panels";
import { AiPanel } from "./ai-panel";
import { EnrichPanel, type Enrichment } from "./enrich-panel";
import { CloudApiPanel } from "./cloud-panel";
import { aiEnabled } from "@/lib/ai";
import { waConfigured } from "@/lib/whatsapp-cloud";

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const profile = await requireProfile();
  const supabase = createClient();

  const { data: c } = await supabase.from("contacts").select("*").eq("id", params.id).maybeSingle();
  if (!c) notFound();

  const [recs, activities, followUps, comms, templates, services, assignees, deals, quotations, tasks, enrichment, waTemplates] = await Promise.all([
    supabase.from("lead_service_recommendations")
      .select("id,confidence,basis,reason,is_verified,service:services(id,name,category)")
      .eq("contact_id", c.id).order("confidence", { ascending: false }),
    supabase.from("deal_activities")
      .select("id,type,description,created_at,author:profiles!deal_activities_created_by_fkey(full_name)")
      .eq("contact_id", c.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("follow_ups").select("id,due_at,channel,note,status,assigned_to")
      .eq("contact_id", c.id).order("due_at", { ascending: false }).limit(50),
    supabase.from("communication_logs").select("id,status,direction,body,created_at,source,delivery_status")
      .eq("contact_id", c.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("message_templates").select("id,name,category,body").eq("is_active", true).order("name"),
    supabase.from("services").select("id,name").eq("is_active", true).order("sort_order"),
    loadAssignees(supabase),
    supabase.from("deals").select("id,title,value,probability,stage,expected_close_date,service_id,assigned_to,service:services(name)")
      .eq("contact_id", c.id).order("created_at", { ascending: false }),
    supabase.from("quotations").select("id,number,status,total,expiry_date").eq("contact_id", c.id).order("created_at", { ascending: false }),
    supabase.from("tasks").select("id,title,status,priority,due_at").eq("contact_id", c.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("lead_enrichment").select("*").eq("contact_id", c.id).order("checked_at", { ascending: false }).limit(1),
    supabase.from("whatsapp_templates").select("id,name,language,body_preview").eq("is_active", true).order("name"),
  ]);
  const { data: allServices } = await supabase.from("services").select("slug,name");
  const slugNames = Object.fromEntries((allServices ?? []).map((s) => [s.slug, s.name]));

  type Rec = { id: string; confidence: number; basis: string; reason: string; is_verified: boolean; service: { id: string; name: string; category: string } | null };
  const recList = (recs.data ?? []) as unknown as Rec[];
  const serviceNames = recList.map((r) => r.service?.name).filter(Boolean) as string[];
  const factors = (c.score_breakdown ?? []) as { factor: string; points: number; kind: string; evidence: string }[];
  const canManage = profile.role !== "sales_executive";
  const names = new Map(assignees.map((a) => [a.id, a.full_name]));

  return (
    <div className="mx-auto max-w-7xl">
      <Link href="/leads" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> All leads
      </Link>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{c.company_name}</h1>
            <Badge className={stageColor(c.stage)}>{stageLabel(c.stage)}</Badge>
            {c.do_not_contact && <Badge className="bg-rose-100 text-rose-700"><Ban className="mr-1 h-3 w-3" /> Do not contact</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {[c.industry, c.city, c.district].filter(Boolean).join(" · ") || "No category or location"}
            {" · "}Outreach: {outreachLabel(c.whatsapp_status)}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <StageControl contactId={c.id} stage={c.stage} />
          <AssignControl contactId={c.id} assignedTo={c.assigned_to} assignees={assignees} canManage={canManage} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Contact information" />
            <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2">
              <Info icon={User} label="Contact person" value={c.contact_person} />
              <Info icon={Phone} label="Mobile" value={c.mobile ? `${formatPhone(c.mobile)} (format valid — WhatsApp not verified)` : c.mobile_raw ? `Invalid: ${c.mobile_raw}` : null} />
              <Info icon={Phone} label="Landline" value={formatPhone(c.landline)} />
              <Info icon={Mail} label="Email" value={c.email} href={c.email ? `mailto:${c.email}` : undefined} />
              <Info icon={Globe} label="Website" value={c.website} href={c.website ?? undefined} />
              <Info icon={Facebook} label="Facebook" value={c.facebook_url} href={c.facebook_url ?? undefined} />
              <Info icon={MapPin} label="Address" value={[c.address, c.city, c.district].filter(Boolean).join(", ")} />
              <Info icon={User} label="Assigned to" value={c.assigned_to ? names.get(c.assigned_to) : "Unassigned"} />
            </dl>
            {c.notes && <p className="border-t border-slate-100 px-5 py-4 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400"><span className="font-medium">Imported notes:</span> {c.notes}</p>}
          </Card>

          <WhatsAppPanel
            contact={{ id: c.id, company_name: c.company_name, contact_person: c.contact_person, city: c.city, mobile: c.mobile, do_not_contact: c.do_not_contact }}
            services={serviceNames}
            templates={templates.data ?? []}
            sender={profile.full_name}
            comms={comms.data ?? []}
          />
          <CloudApiPanel
            contact={{ id: c.id, mobile: c.mobile, do_not_contact: c.do_not_contact, whatsapp_opt_in_at: c.whatsapp_opt_in_at, whatsapp_opt_in_source: c.whatsapp_opt_in_source, last_inbound_at: c.last_inbound_at }}
            configured={waConfigured()}
            templates={waTemplates.data ?? []}
          />

          <Card>
            <CardHeader title="Activity history" />
            <div className="p-5">
              <NoteForm contactId={c.id} />
              <ol className="mt-5 space-y-4 border-l border-slate-200 pl-5 dark:border-slate-800">
                {(activities.data ?? []).length === 0 && <li className="text-sm text-slate-500">No activity yet.</li>}
                {(activities.data ?? []).map((a) => (
                  <li key={a.id} className="relative">
                    <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500 ring-4 ring-white dark:ring-slate-900" />
                    <p className="whitespace-pre-wrap text-sm">{a.description}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {a.type.replace("_", " ")} · {(a.author as unknown as { full_name: string } | null)?.full_name ?? "System"} · {formatDate(a.created_at, true)}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </Card>

          <DetailsForm contact={c} />
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Lead score" description="Explainable — facts vs. assumptions" action={<ScoreBadge score={c.lead_score} />} />
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {factors.length === 0 && <li className="px-5 py-4 text-slate-500">No scoring factors yet.</li>}
              {factors.map((f, i) => (
                <li key={i} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{f.factor}</span>
                    <span className="tabular-nums text-slate-600 dark:text-slate-300">{f.points > 0 ? "+" : ""}{f.points}</span>
                  </div>
                  <div className="mt-1 flex items-start gap-2">
                    <Badge className={f.kind === "fact" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"}>{f.kind}</Badge>
                    <span className="text-xs text-slate-500">{f.evidence}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <AiPanel contactId={c.id} enabled={aiEnabled()} dnc={c.do_not_contact} serviceNames={slugNames} />
          <DealsPanel contactId={c.id} deals={(deals.data ?? []) as unknown as Deal[]} services={services.data ?? []} assignees={assignees} canManage={canManage} />
          <QuotationsList contactId={c.id} quotations={quotations.data ?? []} />
          <LeadTasksPanel contactId={c.id} tasks={tasks.data ?? []} assignees={assignees} me={profile.id} canManage={canManage} />
          <RecommendationsPanel contactId={c.id} recs={recList} services={services.data ?? []} />
          <FollowUpPanel contactId={c.id} followUps={followUps.data ?? []} assignees={assignees} me={profile.id} canManage={canManage} names={Object.fromEntries(names)} />
          <EnrichPanel contactId={c.id} hasWebsite={!!c.website} latest={(enrichment.data?.[0] ?? null) as Enrichment | null} />
          <VerificationPanel contact={c} />
          <DncControl contactId={c.id} dnc={c.do_not_contact} reason={c.opt_out_reason} optedOutAt={c.opted_out_at} />

        </div>
      </div>
    </div>
  );
}

function Info({ icon: Icon, label, value, href }: { icon: React.ElementType; label: string; value?: string | null; href?: string }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0">
        <dt className="text-xs text-slate-500">{label}</dt>
        <dd className="break-words">
          {value ? (href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">{value}</a> : value) : <span className="text-slate-400">—</span>}
        </dd>
      </div>
    </div>
  );
}
