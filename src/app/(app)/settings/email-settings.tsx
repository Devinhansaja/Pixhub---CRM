"use client";

import { Alert, Badge, Button, Card, CardHeader, Input, Label } from "@/components/ui";
import { useAction } from "@/lib/use-action";
import { saveEmailSettings } from "../campaigns/actions";

export function EmailSettings({ value, status }: {
  value: { from_name?: string; from_email?: string; reply_to?: string; footer?: string };
  status: { resend: boolean; webhook: boolean; cron: boolean; ai: boolean; fromOverride: string | null };
}) {
  const a = useAction();
  const chip = (ok: boolean, label: string) => <Badge className={ok ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}>{label}: {ok ? "ready" : "not set"}</Badge>;
  return (
    <Card>
      <CardHeader title="Email sending (campaigns)" description="Sender details used for every campaign email. The sender domain must be verified in Resend." />
      <div className="flex flex-wrap gap-2 px-5 pt-4">
        {chip(status.resend, "Resend key")}{chip(status.webhook, "Delivery tracking")}{chip(status.cron, "Scheduler secret")}{chip(status.ai, "AI review")}
      </div>
      <form className="grid gap-3 p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); a.run(() => saveEmailSettings(fd)); }}>
        <div><Label>Sender name</Label><Input name="from_name" defaultValue={value.from_name ?? "PIXhub.lk"} /></div>
        <div><Label>Sender email (on your verified domain)</Label><Input name="from_email" type="email" defaultValue={value.from_email ?? ""} required />
          {status.fromOverride && <p className="mt-1 text-xs text-slate-500">Overridden on the server by EMAIL_FROM_ADDRESS = {status.fromOverride}</p>}</div>
        <div><Label>Replies go to</Label><Input name="reply_to" type="email" defaultValue={value.reply_to ?? ""} /></div>
        <div className="sm:col-span-2"><Label>Footer (business name and address — required for bulk email)</Label><Input name="footer" defaultValue={value.footer ?? ""} required /></div>
        <div className="sm:col-span-2"><Button disabled={a.pending}>Save email settings</Button></div>
        {(a.error || a.message) && <div className="sm:col-span-2"><Alert kind={a.error ? "error" : "success"}>{a.error ?? a.message}</Alert></div>}
      </form>
    </Card>
  );
}
