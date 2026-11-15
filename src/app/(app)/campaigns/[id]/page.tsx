import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient, requireRole } from "@/lib/supabase/server";
import { aiEnabled } from "@/lib/ai";
import { mailerConfigured } from "@/lib/mailer";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/utils";
import { CampaignEditor, type Options } from "../editor";
import { campaignStatusLabel, campaignStatusStyle, loadCampaignOptions } from "../options";
import { CampaignActions } from "./campaign-actions";
import type { CampaignInput } from "../actions";

export default async function CampaignPage({ params, searchParams }: { params: { id: string }; searchParams: { show?: string } }) {
  const me = await requireRole(["admin", "sales_manager"]);
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const supabase = createClient();
  const { data: c } = await supabase.from("email_campaigns").select("*, author:profiles!email_campaigns_created_by_fkey(full_name), approver:profiles!email_campaigns_approved_by_fkey(full_name)").eq("id", params.id).maybeSingle();
  if (!c) notFound();
  const show = ["ai_rejected", "failed", "bounced", "queued", "replied"].includes(searchParams.show ?? "") ? searchParams.show! : null;
  let mq = supabase.from("email_messages").select("id,step,to_email,status,sent_at,due_at,error,ai_review,subject,contact:contacts(id,company_name)")
    .eq("campaign_id", c.id).order("updated_at", { ascending: false }).limit(100);
  if (show) mq = mq.eq("status", show);
  const [{ data: stats }, { data: messages }, options] = await Promise.all([
    supabase.rpc("campaign_stats", { p_campaign: c.id }), mq, loadCampaignOptions() as Promise<Options>,
  ]);
  const s = (stats ?? {}) as Record<string, number>;
  const canApprove = me.role === "admin" || (me.role === "sales_manager" && c.created_by !== me.id);
  const locked = c.status !== "draft";
  type Msg = { id: string; step: number; to_email: string; status: string; sent_at: string | null; due_at: string; error: string | null; ai_review: { score?: number; issues?: string[] } | null; subject: string | null; contact: { id: string; company_name: string } | null };

  const tiles: [string, number, string?][] = [
    ["Waiting to send", s.queued ?? 0, "queued"], ["Sent", s.sent ?? 0], ["Sent today", s.sent_today ?? 0], ["Delivered", s.delivered ?? 0],
    ["Opened*", s.opened ?? 0], ["Replied", s.replied ?? 0, "replied"], ["Bounced", s.bounced ?? 0, "bounced"],
    ["AI held back", s.ai_rejected ?? 0, "ai_rejected"], ["Failed", s.failed ?? 0, "failed"], ["Follow-ups sent", s.followups_sent ?? 0],
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/campaigns" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600"><ArrowLeft className="h-4 w-4" /> Campaigns</Link>
      <PageHeader title={c.name} description={`Created by ${c.author?.full_name ?? "—"} on ${formatDate(c.created_at)}${c.approver ? ` · approved by ${c.approver.full_name}` : ""}`} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge className={campaignStatusStyle[c.status]}>{campaignStatusLabel(c.status)}</Badge>
        {c.status === "sending" && c.next_send_at && <span className="text-sm text-slate-500">Next email after {formatDate(c.next_send_at, true)}</span>}
      </div>
      {c.status === "paused" && c.paused_reason && <div className="mb-4"><Alert kind="warn"><strong>Paused:</strong> {c.paused_reason}</Alert></div>}
      {c.status === "draft" && c.review_note && <div className="mb-4"><Alert kind="warn"><strong>Changes requested:</strong> {c.review_note}</Alert></div>}
      {!mailerConfigured() && <div className="mb-4"><Alert kind="warn">Email sending isn&apos;t connected yet (no SMTP mailbox or Resend key on the server), so this campaign can&apos;t start.</Alert></div>}

      <CampaignActions id={c.id} status={c.status} canApprove={canApprove} isCreator={c.created_by === me.id} isAdmin={me.role === "admin"} />

      {c.status !== "draft" && (
        <div className="my-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {tiles.map(([label, n, filter]) => (
            <Card key={label} className="p-3">
              {filter ? <Link href={`/campaigns/${c.id}?show=${filter}`} className="text-xs text-brand-600 hover:underline">{label}</Link> : <p className="text-xs text-slate-500">{label}</p>}
              <p className="mt-1 text-xl font-semibold tabular-nums">{formatNumber(n)}</p>
            </Card>
          ))}
        </div>
      )}

      {c.status !== "draft" && (
        <Card className="mb-6 overflow-x-auto">
          <CardHeader title={show ? `Emails: ${show.replace("_", " ")}` : "Latest activity"} action={show ? <Link href={`/campaigns/${c.id}`} className="text-xs text-brand-600">Show all</Link> : undefined} />
          <table className="table-base">
            <thead><tr><th>Company</th><th>Email</th><th>Step</th><th>Status</th><th>When</th><th>Notes</th></tr></thead>
            <tbody>
              {((messages ?? []) as unknown as Msg[]).map((m) => (
                <tr key={m.id}>
                  <td>{m.contact ? <Link href={`/leads/${m.contact.id}`} className="hover:text-brand-600">{m.contact.company_name}</Link> : "—"}</td>
                  <td className="text-slate-500">{m.to_email}</td>
                  <td>{m.step === 0 ? "First" : `Follow-up ${m.step}`}</td>
                  <td><Badge className={m.status === "ai_rejected" || m.status === "bounced" || m.status === "failed" ? "bg-rose-50 text-rose-700" : m.status === "replied" ? "bg-emerald-50 text-emerald-700" : ""}>{m.status.replace("_", " ")}</Badge></td>
                  <td className="whitespace-nowrap text-xs">{m.sent_at ? formatDate(m.sent_at, true) : m.status === "queued" ? `due ${formatDate(m.due_at, true)}` : "—"}</td>
                  <td className="max-w-[320px] text-xs text-slate-500">{m.ai_review?.issues?.length ? `AI: ${m.ai_review.issues.join("; ")}` : m.error ?? ""}</td>
                </tr>
              ))}
              {(messages ?? []).length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-500">Nothing here yet.</td></tr>}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-slate-400">*Opens are approximate (some email apps block tracking). Replies arrive in your reply-to inbox — record them on the lead page with “They replied” to stop follow-ups.</p>
        </Card>
      )}

      <CampaignEditor
        initial={{ ...(c as unknown as CampaignInput), id: c.id, min_gap_minutes: Number(c.min_gap_minutes), max_gap_minutes: Number(c.max_gap_minutes), max_bounce_rate: Number(c.max_bounce_rate),
          followup1_subject: c.followup1_subject ?? "", followup1_body: c.followup1_body ?? "", followup2_subject: c.followup2_subject ?? "", followup2_body: c.followup2_body ?? "" }}
        options={options} locked={locked} aiAvailable={aiEnabled() || c.ai_review}
      />
    </div>
  );
}
