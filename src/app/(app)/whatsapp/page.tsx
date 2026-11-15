import Link from "next/link";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { Alert, Badge, Card, EmptyState, PageHeader, ScoreBadge } from "@/components/ui";
import { formatPhone } from "@/lib/phone";
import { OUTREACH, outreachLabel } from "@/lib/constants";
import { WhatsAppPanel } from "../leads/[id]/panels";
import { BusinessApiSection } from "./business-api";
import { waConfigured, webhookConfigured } from "@/lib/whatsapp-cloud";

const QUEUES = [
  { key: "todo", label: "Not started", statuses: ["none", "prepared"] },
  { key: "opened", label: "Opened — confirm sent", statuses: ["chat_opened"] },
  { key: "awaiting", label: "Awaiting reply", statuses: ["contacted"] },
  { key: "followup", label: "Follow-up required", statuses: ["follow_up_required", "replied"] },
  { key: "interested", label: "Interested", statuses: ["interested"] },
] as const;

export default async function WhatsAppPage({ searchParams }: { searchParams: { queue?: string; owner?: string } }) {
  const profile = await requireProfile();
  const supabase = createClient();
  const queue = QUEUES.find((q) => q.key === searchParams.queue) ?? QUEUES[0];

  let query = supabase
    .from("contacts")
    .select("id,company_name,contact_person,city,industry,mobile,do_not_contact,lead_score,whatsapp_status,recs:lead_service_recommendations(confidence,service:services(name))")
    .not("mobile", "is", null)
    .eq("do_not_contact", false)
    .not("stage", "in", "(won,lost,not_interested)")
    .in("whatsapp_status", queue.statuses as unknown as string[])
    .order("lead_score", { ascending: false })
    .limit(25);
  if (searchParams.owner !== "all") query = query.eq("assigned_to", profile.id);

  const [{ data: leads, error }, { data: templates }, counts] = await Promise.all([
    query,
    supabase.from("message_templates").select("id,name,category,body").eq("is_active", true).order("name"),
    Promise.all(QUEUES.map(async (q) => {
      let c = supabase.from("contacts").select("id", { count: "exact", head: true })
        .not("mobile", "is", null).eq("do_not_contact", false)
        .not("stage", "in", "(won,lost,not_interested)")
        .in("whatsapp_status", q.statuses as unknown as string[]);
      if (searchParams.owner !== "all") c = c.eq("assigned_to", profile.id);
      return (await c).count ?? 0;
    })),
  ]);

  const [{ data: waTemplates }, { count: optedIn }] = await Promise.all([
    supabase.from("whatsapp_templates").select("id,name,language,category,body_preview,params,is_active").order("name"),
    supabase.from("contacts").select("id", { count: "exact", head: true }).not("whatsapp_opt_in_at", "is", null),
  ]);
  const ownerQs = searchParams.owner === "all" ? "&owner=all" : "";
  type Lead = { id: string; company_name: string; contact_person: string | null; city: string | null; industry: string | null; mobile: string; do_not_contact: boolean; lead_score: number; whatsapp_status: string; recs: { confidence: number; service: { name: string } | null }[] };

  return (
    <>
      <PageHeader
        title="WhatsApp Outreach"
        description="Personalised click-to-chat messages. Nothing is sent automatically — you send each message in WhatsApp and confirm it here."
      />
      <div className="mb-4"><Alert kind="info">
        Statuses: <em>{OUTREACH.slice(1).map((o) => o.label).join(" → ")}</em>. Opening a chat is not the same as sending.
        For opted-in contacts you can also send approved templates through the official Business API from the lead page.
      </Alert></div>

      {profile.role !== "sales_executive" && (
        <BusinessApiSection
          configured={waConfigured()} webhook={webhookConfigured()} isAdmin={profile.role === "admin"}
          templates={(waTemplates ?? []) as never} optedIn={optedIn ?? 0}
          webhookUrl={`${process.env.NEXT_PUBLIC_SITE_URL ?? "https://your-app"}/api/whatsapp/webhook`}
        />
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {QUEUES.map((q, i) => (
          <Link key={q.key} href={`/whatsapp?queue=${q.key}${ownerQs}`}
            className={`rounded-full px-3 py-1.5 text-sm ${q.key === queue.key ? "bg-brand-600 text-white" : "bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300"}`}>
            {q.label} <span className="ml-1 opacity-70">{counts[i]}</span>
          </Link>
        ))}
        {profile.role !== "sales_executive" && (
          <Link href={`/whatsapp?queue=${queue.key}${searchParams.owner === "all" ? "" : "&owner=all"}`} className="ml-auto text-sm text-brand-600 hover:underline">
            {searchParams.owner === "all" ? "Show only my leads" : "Show all accessible leads"}
          </Link>
        )}
      </div>

      {error && <Alert kind="error">{error.message}</Alert>}
      {!error && (leads ?? []).length === 0 && (
        <EmptyState title="Nothing in this queue">
          {searchParams.owner !== "all" ? "Only leads assigned to you are shown. Ask a manager to assign leads, or switch to all leads." : "Try another queue."}
        </EmptyState>
      )}

      <div className="space-y-4">
        {((leads ?? []) as unknown as Lead[]).map((l) => {
          const services = [...l.recs].sort((a, b) => b.confidence - a.confidence).map((r) => r.service?.name).filter(Boolean) as string[];
          return (
            <Card key={l.id} className="p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Link href={`/leads/${l.id}`} className="font-semibold hover:text-brand-600">{l.company_name}</Link>
                <ScoreBadge score={l.lead_score} />
                <span className="text-sm text-slate-500">{formatPhone(l.mobile)} · {l.industry ?? "—"} · {l.city ?? "—"}</span>
                <Badge className="ml-auto">{outreachLabel(l.whatsapp_status)}</Badge>
              </div>
              <WhatsAppPanel compact contact={l} services={services} templates={templates ?? []} sender={profile.full_name} />
            </Card>
          );
        })}
      </div>
    </>
  );
}
