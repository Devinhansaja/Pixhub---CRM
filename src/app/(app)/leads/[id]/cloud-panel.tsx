"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Input, Select, Textarea } from "@/components/ui";
import { useAction } from "@/lib/use-action";
import { formatDate } from "@/lib/utils";
import { recordOptIn, revokeOptIn, sendReply, sendTemplateMessage } from "../../whatsapp/cloud-actions";

export interface WaTemplate { id: string; name: string; language: string; body_preview: string }

export function CloudApiPanel({ contact, configured, templates }: {
  contact: { id: string; mobile: string | null; do_not_contact: boolean; whatsapp_opt_in_at: string | null; whatsapp_opt_in_source: string | null; last_inbound_at: string | null };
  configured: boolean;
  templates: WaTemplate[];
}) {
  const optIn = useAction();
  const send = useAction();
  const [source, setSource] = useState("");
  const [tpl, setTpl] = useState(templates[0]?.id ?? "");
  const [reply, setReply] = useState("");
  const windowOpen = !!contact.last_inbound_at && Date.now() - new Date(contact.last_inbound_at).getTime() < 24 * 3600 * 1000;
  const chosen = templates.find((t) => t.id === tpl);

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-600" /> WhatsApp Business API</span>}
        description="Official API: approved templates to opted-in contacts, replies within 24h of their last message." />
      <div className="space-y-4 p-5 text-sm">
        {contact.do_not_contact ? <Alert kind="error">Opted out — no messages can be sent.</Alert> : (
          <div>
            <p className="mb-1 font-medium">Consent</p>
            {contact.whatsapp_opt_in_at ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-emerald-100 text-emerald-700">Opted in {formatDate(contact.whatsapp_opt_in_at)}</Badge>
                <span className="text-xs text-slate-500">{contact.whatsapp_opt_in_source}</span>
                <Button size="sm" variant="ghost" disabled={optIn.pending} onClick={() => optIn.run(() => revokeOptIn(contact.id))}>Withdraw</Button>
              </div>
            ) : (
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); optIn.run(() => recordOptIn(contact.id, source), () => setSource("")); }}>
                <Input className="h-9" placeholder="How did they agree? e.g. 'Asked for offers on call, 14 Nov'" value={source} onChange={(e) => setSource(e.target.value)} maxLength={300} />
                <Button size="sm" disabled={optIn.pending}>Record opt-in</Button>
              </form>
            )}
            {optIn.error && <p className="mt-1 text-xs text-rose-600">{optIn.error}</p>}
          </div>
        )}

        {!configured ? (
          <p className="text-slate-500">The Business API isn&apos;t connected yet. An administrator can add the WhatsApp credentials (see README). Until then, use the click-to-chat panel.</p>
        ) : !contact.do_not_contact && contact.mobile && (
          <>
            <div className="space-y-2">
              <p className="font-medium">Send approved template</p>
              {templates.length === 0 ? <p className="text-slate-500">No templates set up. Admins add Meta-approved templates on the WhatsApp Outreach page.</p> : (
                <>
                  <Select className="h-9" value={tpl} onChange={(e) => setTpl(e.target.value)}>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}
                  </Select>
                  {chosen && <p className="rounded bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-400">{chosen.body_preview}</p>}
                  <Button size="sm" disabled={send.pending || !contact.whatsapp_opt_in_at || !tpl}
                    onClick={() => confirm("Send this template to the customer now via the WhatsApp Business API?") && send.run(() => sendTemplateMessage(contact.id, tpl))}>
                    Send template
                  </Button>
                  {!contact.whatsapp_opt_in_at && <p className="text-xs text-amber-700">Record opt-in first.</p>}
                </>
              )}
            </div>
            <div className="space-y-2">
              <p className="font-medium">Reply {windowOpen ? <Badge className="ml-1 bg-emerald-50 text-emerald-700">24h window open</Badge> : <Badge className="ml-1">window closed</Badge>}</p>
              {windowOpen ? (
                <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); send.run(() => sendReply(contact.id, reply), () => setReply("")); }}>
                  <Textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={4096} placeholder="Type your reply" />
                  <Button size="sm" disabled={send.pending || !reply.trim()}>Send reply</Button>
                </form>
              ) : <p className="text-xs text-slate-500">Free-text replies open for 24 hours after the customer messages you.</p>}
            </div>
          </>
        )}
        {(send.error || send.message) && <Alert kind={send.error ? "error" : "success"}>{send.error ?? send.message}</Alert>}
      </div>
    </Card>
  );
}
