"use client";

import { useState } from "react";
import { Alert, Button, Card, CardHeader, Input, Label, Select, Textarea } from "@/components/ui";
import { useAction } from "@/lib/use-action";
import { renderTemplate } from "@/lib/whatsapp";
import { changePassword, saveOrganization, saveService, saveTemplate, updateMyProfile } from "./actions";

function Msg({ error, message }: { error: string | null; message: string | null }) {
  if (!error && !message) return null;
  return <Alert kind={error ? "error" : "success"}>{error ?? message}</Alert>;
}

export function ProfileForm({ profile }: { profile: { full_name: string; phone: string | null; email: string } }) {
  const a = useAction();
  return (
    <Card>
      <CardHeader title="My profile" description={profile.email} />
      <form className="space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); a.run(() => updateMyProfile(fd)); }}>
        <div><Label>Full name (used as {"{{sender}}"} in messages)</Label><Input name="full_name" defaultValue={profile.full_name} required /></div>
        <div><Label>Phone</Label><Input name="phone" defaultValue={profile.phone ?? ""} /></div>
        <Button disabled={a.pending}>Save</Button>
        <Msg error={a.error} message={a.message} />
      </form>
    </Card>
  );
}

export function PasswordForm() {
  const a = useAction();
  return (
    <Card>
      <CardHeader title="Set password" description="Invited users set their password here after following the email link." />
      <form className="space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const fd = new FormData(f); a.run(() => changePassword(fd), () => f.reset()); }}>
        <div><Label>New password</Label><Input name="password" type="password" autoComplete="new-password" minLength={10} required /></div>
        <div><Label>Confirm password</Label><Input name="confirm" type="password" autoComplete="new-password" required /></div>
        <Button disabled={a.pending}>Update password</Button>
        <Msg error={a.error} message={a.message} />
      </form>
    </Card>
  );
}

type Tpl = { id: string; name: string; category: string; body: string; is_active: boolean };
const CATS = ["website", "software", "social_media", "ecommerce", "follow_up", "meeting", "general"];

export function TemplatesEditor({ templates, canEdit }: { templates: Tpl[]; canEdit: boolean }) {
  const a = useAction();
  const [sel, setSel] = useState<Tpl | null>(templates[0] ?? null);
  const [body, setBody] = useState(sel?.body ?? "");
  const choose = (t: Tpl | null) => { setSel(t); setBody(t?.body ?? ""); };
  const preview = renderTemplate(body, { company: "Ceylon Spice Cafe", contact_person: "Mr. Perera", city: "Kandy", services: ["POS System", "Social Media Management"], sender: "Nimal" });

  return (
    <Card>
      <CardHeader
        title="WhatsApp message templates"
        description="Placeholders: {{company}} {{contact_person}} {{services}} {{city}} {{sender}}"
        action={canEdit ? <Button size="sm" variant="outline" onClick={() => choose(null)}>New template</Button> : undefined}
      />
      <div className="grid gap-0 md:grid-cols-[240px_1fr]">
        <ul className="border-b border-slate-100 dark:border-slate-800 md:border-b-0 md:border-r">
          {templates.map((t) => (
            <li key={t.id}>
              <button onClick={() => choose(t)} className={`w-full px-5 py-2.5 text-left text-sm ${sel?.id === t.id ? "bg-brand-50 font-medium text-brand-700 dark:bg-brand-700/20 dark:text-brand-100" : "hover:bg-slate-50 dark:hover:bg-slate-800/50"} ${t.is_active ? "" : "opacity-50"}`}>
                {t.name}
              </button>
            </li>
          ))}
        </ul>
        <form key={sel?.id ?? "new"} className="space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); a.run(() => saveTemplate(fd)); }}>
          <input type="hidden" name="id" value={sel?.id ?? ""} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Name</Label><Input name="name" defaultValue={sel?.name ?? ""} disabled={!canEdit} required /></div>
            <div><Label>Category</Label><Select name="category" defaultValue={sel?.category ?? "general"} disabled={!canEdit}>{CATS.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}</Select></div>
          </div>
          <div><Label>Message</Label><Textarea name="body" rows={5} value={body} onChange={(e) => setBody(e.target.value)} disabled={!canEdit} required /></div>
          <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"><span className="text-xs font-medium uppercase tracking-wide opacity-70">Preview</span><p className="mt-1 whitespace-pre-wrap">{preview}</p></div>
          {canEdit && (
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={sel?.is_active ?? true} /> Active</label>
              <Button disabled={a.pending}>Save template</Button>
            </div>
          )}
          <Msg error={a.error} message={a.message} />
        </form>
      </div>
    </Card>
  );
}

type Svc = { id: string; name: string; category: string; description: string | null; base_price: number | null; is_active: boolean };

function ServiceRow({ s }: { s: Svc }) {
  const a = useAction();
  return (
    <form className="grid items-center gap-2 border-b border-slate-100 px-5 py-2 last:border-0 dark:border-slate-800 md:grid-cols-[1.2fr_2fr_140px_70px_auto]"
      onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); a.run(() => saveService(s.id, fd)); }}>
      <span className="text-sm font-medium">{s.name} <span className="text-xs font-normal text-slate-400">{s.category}</span></span>
      <Input name="description" defaultValue={s.description ?? ""} className="h-8" placeholder="Package description" />
      <Input name="base_price" type="number" min={0} step="0.01" defaultValue={s.base_price ?? ""} className="h-8 text-right" placeholder="Price LKR" />
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="is_active" defaultChecked={s.is_active} /> Active</label>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={a.pending}>Save</Button>
        {a.error && <span className="text-xs text-rose-600">{a.error}</span>}
        {a.message && <span className="text-xs text-emerald-600">✓</span>}
      </div>
    </form>
  );
}

export function ServicesEditor({ services }: { services: Svc[] }) {
  return (
    <Card>
      <CardHeader title="Services & package pricing" description="Base prices pre-fill quotation items; salespeople can still adjust them." />
      <div>{services.map((s) => <ServiceRow key={s.id} s={s} />)}</div>
    </Card>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function OrgForm({ org, defaultTax }: { org: any; defaultTax: number }) {
  const a = useAction();
  const fields: [string, string][] = [["name", "Display name"], ["legal_name", "Legal name"], ["address", "Address"], ["phone", "Phone"], ["email", "Email"], ["website", "Website"], ["tax_reg_no", "VAT / Tax reg. no."]];
  return (
    <Card>
      <CardHeader title="Company details" description="Printed on quotation PDFs" />
      <form className="grid gap-3 p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); a.run(() => saveOrganization(fd)); }}>
        <input type="hidden" name="id" value={org.id} />
        {fields.map(([k, l]) => <div key={k}><Label>{l}</Label><Input name={k} defaultValue={org[k] ?? ""} /></div>)}
        <div><Label>Default tax rate % for new quotations</Label><Input name="default_tax_rate" type="number" min={0} max={100} step="0.01" defaultValue={defaultTax} /></div>
        <div className="sm:col-span-2"><Button disabled={a.pending}>Save</Button></div>
        <div className="sm:col-span-2"><Msg error={a.error} message={a.message} /></div>
      </form>
    </Card>
  );
}
