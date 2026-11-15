"use client";

import { Alert, Badge, Button, Card, CardHeader, Input, Label, Select, Textarea } from "@/components/ui";
import { useAction } from "@/lib/use-action";
import { saveWaTemplate, toggleWaTemplate } from "./cloud-actions";

interface Tpl { id: string; name: string; language: string; category: string; body_preview: string; params: string[]; is_active: boolean }

export function BusinessApiSection({ configured, webhook, isAdmin, templates, optedIn, webhookUrl }: {
  configured: boolean; webhook: boolean; isAdmin: boolean; templates: Tpl[]; optedIn: number; webhookUrl: string;
}) {
  const add = useAction();
  const toggle = useAction();
  return (
    <Card className="mb-6">
      <CardHeader title="WhatsApp Business API (official)" description="Approved templates to opted-in contacts, one at a time. No bulk or unsolicited messaging." />
      <div className="space-y-4 p-5 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge className={configured ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}>Sending: {configured ? "connected" : "not configured"}</Badge>
          <Badge className={webhook ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}>Webhook: {webhook ? "configured" : "not configured"}</Badge>
          <Badge>{optedIn} opted-in contacts</Badge>
        </div>
        {isAdmin && !webhook && (
          <p className="text-xs text-slate-500">Webhook URL for Meta: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{webhookUrl}</code> (subscribe to <code>messages</code>). See README for setup.</p>
        )}
        <div>
          <p className="mb-2 font-medium">Approved templates</p>
          {templates.length === 0 && <p className="text-slate-500">None yet.</p>}
          <ul className="space-y-2">
            {templates.map((t) => (
              <li key={t.id} className={`rounded-lg border border-slate-200 p-3 dark:border-slate-700 ${t.is_active ? "" : "opacity-50"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">{t.name} · {t.language} · {t.category}</span>
                  {isAdmin && <Button size="sm" variant="ghost" disabled={toggle.pending} onClick={() => toggle.run(() => toggleWaTemplate(t.id, !t.is_active))}>{t.is_active ? "Disable" : "Enable"}</Button>}
                </div>
                <p className="mt-1 text-slate-600 dark:text-slate-400">{t.body_preview}</p>
                {t.params.length > 0 && <p className="mt-1 text-xs text-slate-500">{t.params.map((p, i) => `{{${i + 1}}} = ${p}`).join(" · ")}</p>}
              </li>
            ))}
          </ul>
        </div>
        {isAdmin && (
          <form className="grid gap-3 rounded-lg bg-slate-50 p-4 dark:bg-slate-800/40 md:grid-cols-4"
            onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const fd = new FormData(f); add.run(() => saveWaTemplate(fd), () => f.reset()); }}>
            <p className="md:col-span-4 text-xs text-slate-500">Add a template only after Meta has approved it in WhatsApp Manager. Name and language must match exactly.</p>
            <div><Label>Template name</Label><Input name="name" placeholder="pixhub_website_intro" required /></div>
            <div><Label>Language</Label><Input name="language" defaultValue="en" required /></div>
            <div><Label>Category</Label><Select name="category" defaultValue="marketing"><option value="marketing">Marketing</option><option value="utility">Utility</option></Select></div>
            <div><Label>Variables, in order</Label><Input name="params" placeholder="contact_person, company" /></div>
            <div className="md:col-span-4"><Label>Approved body text</Label><Textarea name="body_preview" rows={3} placeholder="Hello {{1}}, we help businesses like {{2}}…" required /></div>
            <div className="md:col-span-4"><Button size="sm" disabled={add.pending}>Add template</Button></div>
          </form>
        )}
        {(add.error || add.message || toggle.error) && <Alert kind={add.error || toggle.error ? "error" : "success"}>{add.error ?? toggle.error ?? add.message}</Alert>}
      </div>
    </Card>
  );
}
