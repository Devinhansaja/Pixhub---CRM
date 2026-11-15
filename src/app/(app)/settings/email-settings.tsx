"use client";

import { Alert, Badge, Button, Card, CardHeader, Input, Label } from "@/components/ui";
import { useAction } from "@/lib/use-action";
import { saveEmailSettings } from "../campaigns/actions";

export function EmailSettings({ value, status }: {
  value: { from_name?: string; from_email?: string; reply_to?: string; footer?: string };
  status: { provider: "smtp" | "resend" | null; smtpUser: string | null; dailyCap: number | null; webhook: boolean; cron: boolean; ai: boolean; fromOverride: string | null };
}) {
  const a = useAction();
  const chip = (ok: boolean, label: string, okText = "ready") => <Badge className={ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}>{label}: {ok ? okText : "not set"}</Badge>;
  const smtp = status.provider === "smtp";
  return (
    <Card>
      <CardHeader title="Email sending (campaigns)" description={smtp
        ? `Emails are sent from the mailbox ${status.smtpUser} (SMTP). Replies come back to that inbox.`
        : "Sender details used for every campaign email. With Resend, the sender domain must be verified."} />
      <div className="flex flex-wrap gap-2 px-5 pt-4">
        {chip(!!status.provider, "Sending", smtp ? "mailbox (SMTP)" : "Resend")}
        {smtp && status.dailyCap !== null && <Badge className="bg-slate-100 text-slate-700">Max {status.dailyCap} emails/day (all campaigns)</Badge>}
        {!smtp && chip(status.webhook, "Delivery tracking")}
        {chip(status.cron, "Scheduler secret")}{chip(status.ai, "AI review")}
      </div>
      {smtp && <div className="px-5 pt-3"><Alert kind="info">Mailbox sending can&apos;t track deliveries or opens automatically. Bounced emails arrive in the mailbox inbox — mark those leads in the CRM. When a lead replies, press &ldquo;They replied&rdquo; on the lead to stop follow-ups.</Alert></div>}
      <form className="grid gap-3 p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); a.run(() => saveEmailSettings(fd)); }}>
        <div><Label>Sender name</Label><Input name="from_name" defaultValue={value.from_name ?? "PIXhub.lk"} /></div>
        <div><Label>{smtp ? "Sender email (used only with Resend)" : "Sender email (on your verified domain)"}</Label><Input name="from_email" type="email" defaultValue={value.from_email ?? status.smtpUser ?? ""} required />
          {smtp && <p className="mt-1 text-xs text-slate-500">With SMTP, emails always go out from {status.smtpUser}.</p>}
          {!smtp && status.fromOverride && <p className="mt-1 text-xs text-slate-500">Overridden on the server by EMAIL_FROM_ADDRESS = {status.fromOverride}</p>}</div>
        <div><Label>Replies go to</Label><Input name="reply_to" type="email" defaultValue={value.reply_to ?? ""} /></div>
        <div className="sm:col-span-2"><Label>Footer (business name and address — required for bulk email)</Label><Input name="footer" defaultValue={value.footer ?? ""} required /></div>
        <div className="sm:col-span-2"><Button disabled={a.pending}>Save email settings</Button></div>
        {(a.error || a.message) && <div className="sm:col-span-2"><Alert kind={a.error ? "error" : "success"}>{a.error ?? a.message}</Alert></div>}
      </form>
    </Card>
  );
}
