import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient, requireRole } from "@/lib/supabase/server";
import { mailerConfigured } from "@/lib/mailer";
import { Alert, Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDate, formatNumber } from "@/lib/utils";
import { campaignStatusLabel, campaignStatusStyle } from "./options";

export default async function CampaignsPage() {
  await requireRole(["admin", "sales_manager"]);
  const supabase = createClient();
  const { data: campaigns } = await supabase.from("email_campaigns")
    .select("id,name,status,daily_limit,min_gap_minutes,max_gap_minutes,created_at,paused_reason,author:profiles!email_campaigns_created_by_fkey(full_name)")
    .order("created_at", { ascending: false }).limit(100);
  const stats = await Promise.all((campaigns ?? []).map((c) => supabase.rpc("campaign_stats", { p_campaign: c.id }).then((r) => (r.data ?? {}) as Record<string, number>)));

  return (
    <>
      <PageHeader title="Email Campaigns" description="Personalised emails to your leads, sent slowly with random breaks, checked by AI, approved by a manager, with automatic follow-ups."
        actions={<Link href="/campaigns/new"><Button><Plus className="h-4 w-4" /> New campaign</Button></Link>} />
      {!mailerConfigured() && <div className="mb-4"><Alert kind="warn">Sending isn&apos;t connected yet. You can create and approve campaigns, but emails will only go out once a mailbox (SMTP) or Resend key is added on the server (see Settings → Email sending).</Alert></div>}
      {(campaigns ?? []).length === 0 ? (
        <EmptyState title="No campaigns yet">Create one, choose who receives it (for example a file you uploaded), write the email, and set the sending speed.</EmptyState>
      ) : (
        <Card className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Campaign</th><th>Status</th><th className="text-right">Sent</th><th className="text-right">Waiting</th><th className="text-right">Replied</th><th className="text-right">Bounced</th><th className="text-right">AI held</th><th>Pace</th><th>Created</th></tr></thead>
            <tbody>
              {(campaigns ?? []).map((c, i) => {
                const s = stats[i];
                return (
                  <tr key={c.id}>
                    <td><Link href={`/campaigns/${c.id}`} className="font-medium text-brand-600 hover:underline">{c.name}</Link>
                      <div className="text-xs text-slate-500">{(c.author as unknown as { full_name: string } | null)?.full_name}</div></td>
                    <td><Badge className={campaignStatusStyle[c.status]}>{campaignStatusLabel(c.status)}</Badge>
                      {c.status === "paused" && c.paused_reason && <div className="max-w-[220px] truncate text-xs text-orange-700" title={c.paused_reason}>{c.paused_reason}</div>}</td>
                    <td className="text-right tabular-nums">{formatNumber(s.sent ?? 0)}</td>
                    <td className="text-right tabular-nums">{formatNumber(s.queued ?? 0)}</td>
                    <td className="text-right tabular-nums">{formatNumber(s.replied ?? 0)}</td>
                    <td className="text-right tabular-nums">{formatNumber(s.bounced ?? 0)}</td>
                    <td className="text-right tabular-nums">{formatNumber(s.ai_rejected ?? 0)}</td>
                    <td className="whitespace-nowrap text-xs text-slate-500">{c.daily_limit}/day · {Number(c.min_gap_minutes)}–{Number(c.max_gap_minutes)} min</td>
                    <td className="whitespace-nowrap">{formatDate(c.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
