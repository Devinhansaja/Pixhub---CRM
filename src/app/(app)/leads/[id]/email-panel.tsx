"use client";

import Link from "next/link";
import { Mail } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader } from "@/components/ui";
import { useAction } from "@/lib/use-action";
import { formatDate } from "@/lib/utils";
import { markEmailReplied } from "../../campaigns/actions";

export interface EmailRow {
  id: string; step: number; status: string; subject: string | null; sent_at: string | null; due_at: string; error: string | null;
  campaign: { id: string; name: string } | null;
}

export function EmailPanel({ contactId, email, emailStatus, dnc, rows, canSeeCampaigns }: {
  contactId: string; email: string | null; emailStatus: string; dnc: boolean; rows: EmailRow[]; canSeeCampaigns: boolean;
}) {
  const { run, pending, error, message } = useAction();
  const hasSent = rows.some((r) => ["sent", "delivered", "opened"].includes(r.status));
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Mail className="h-4 w-4 text-brand-600" /> Email</span>}
        description={email ? `${email}${emailStatus !== "unknown" ? ` · ${emailStatus}` : ""}` : "No email address on file"}
        action={hasSent && !dnc ? <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markEmailReplied(contactId))}>They replied</Button> : undefined} />
      <div className="p-5 text-sm">
        {dnc && <p className="mb-2 text-rose-600">Opted out — no campaign emails will be sent.</p>}
        {emailStatus === "bounced" && <p className="mb-2 text-rose-600">This address bounced. Correct it in “Edit lead details” to email again.</p>}
        {(error || message) && <div className="mb-2"><Alert kind={error ? "error" : "success"}>{error ?? message}</Alert></div>}
        {rows.length === 0 ? <p className="text-slate-500">No campaign emails yet.</p> : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate">{r.subject ?? (r.step === 0 ? "First email" : `Follow-up ${r.step}`)}</p>
                  <p className="text-xs text-slate-500">
                    {r.campaign && (canSeeCampaigns ? <Link href={`/campaigns/${r.campaign.id}`} className="hover:text-brand-600">{r.campaign.name}</Link> : r.campaign.name)}
                    {" · "}{r.sent_at ? formatDate(r.sent_at, true) : r.status === "queued" ? `scheduled ${formatDate(r.due_at)}` : "—"}
                    {r.error ? ` · ${r.error}` : ""}
                  </p>
                </div>
                <Badge className={r.status === "replied" ? "bg-emerald-50 text-emerald-700" : ["bounced", "failed", "ai_rejected", "complained"].includes(r.status) ? "bg-rose-50 text-rose-700" : ""}>{r.status.replace("_", " ")}</Badge>
              </li>
            ))}
          </ul>
        )}
        {hasSent && <p className="mt-3 text-xs text-slate-400">Replies go to your reply-to inbox. Click “They replied” to stop follow-ups and move the lead to Interested.</p>}
      </div>
    </Card>
  );
}
