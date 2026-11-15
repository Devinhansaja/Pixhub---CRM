"use client";

import { useState } from "react";
import { CheckCircle2, ExternalLink, MessageCircle, Trash2, XCircle } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Input, Label, Select, Textarea } from "@/components/ui";
import { STAGES, outreachLabel } from "@/lib/constants";
import { useAction } from "@/lib/use-action";
import { renderTemplate, waLink } from "@/lib/whatsapp";
import { cn, formatDate, toColomboInput } from "@/lib/utils";
import {
  addFollowUp, addNote, addRecommendation, assignLeads, logOutreach, recordVerification,
  removeRecommendation, rescheduleFollowUp, setDoNotContact, setFollowUpStatus, updateLeadDetails,
  updateStage, verifyRecommendation,
} from "../actions";

function Feedback({ error, message }: { error: string | null; message?: string | null }) {
  if (error) return <div className="mt-3"><Alert kind="error">{error}</Alert></div>;
  if (message) return <div className="mt-3"><Alert kind="success">{message}</Alert></div>;
  return null;
}

export function StageControl({ contactId, stage }: { contactId: string; stage: string }) {
  const { run, pending, error } = useAction();
  return (
    <div>
      <Label>Sales stage</Label>
      <Select value={stage} disabled={pending} onChange={(e) => run(() => updateStage(contactId, e.target.value))} className="w-48">
        {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </Select>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

export function AssignControl({ contactId, assignedTo, assignees, canManage }: {
  contactId: string; assignedTo: string | null; assignees: { id: string; full_name: string }[]; canManage: boolean;
}) {
  const { run, pending, error } = useAction();
  if (!canManage) return null;
  return (
    <div>
      <Label>Assigned to</Label>
      <Select value={assignedTo ?? ""} disabled={pending} className="w-48"
        onChange={(e) => run(() => assignLeads([contactId], e.target.value || null))}>
        <option value="">Unassigned</option>
        {assignees.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
      </Select>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

export function NoteForm({ contactId }: { contactId: string }) {
  const [text, setText] = useState("");
  const { run, pending, error } = useAction();
  return (
    <form onSubmit={(e) => { e.preventDefault(); run(() => addNote(contactId, text), () => setText("")); }}>
      <Textarea rows={2} placeholder="Add a note (call summary, requirement, objection…)" value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} />
      <div className="mt-2 flex justify-end"><Button size="sm" disabled={pending || !text.trim()}>{pending ? "Saving…" : "Add note"}</Button></div>
      <Feedback error={error} />
    </form>
  );
}

export interface Template { id: string; name: string; category: string; body: string }

export function WhatsAppPanel({ contact, services, templates, sender, comms, compact }: {
  contact: { id: string; company_name: string; contact_person: string | null; city: string | null; mobile: string | null; do_not_contact: boolean };
  services: string[];
  templates: Template[];
  sender: string;
  comms?: { id: string; status: string; direction: string; body: string | null; created_at: string; source: string; delivery_status?: string | null }[];
  compact?: boolean;
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const tpl = templates.find((t) => t.id === templateId);
  const initial = tpl ? renderTemplate(tpl.body, { company: contact.company_name, contact_person: contact.contact_person, city: contact.city, services, sender }) : "";
  const [text, setText] = useState(initial);
  const [opened, setOpened] = useState(false);
  const { run, pending, error } = useAction();
  const link = waLink(contact.mobile, text);

  const pick = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) setText(renderTemplate(t.body, { company: contact.company_name, contact_person: contact.contact_person, city: contact.city, services, sender }));
  };

  const body = (
    <div className={compact ? "" : "p-5"}>
      {contact.do_not_contact ? (
        <Alert kind="error">This contact has opted out / is marked do-not-contact. Outreach is disabled.</Alert>
      ) : !contact.mobile ? (
        <Alert kind="warn">No valid Sri Lankan mobile number — a WhatsApp link cannot be created. Edit the lead to add one.</Alert>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
            <div>
              <Label>Template</Label>
              <Select value={templateId} onChange={(e) => pick(e.target.value)}>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Message (editable)</Label>
              <Textarea rows={compact ? 4 : 5} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => logOutreach(contact.id, "prepared", text, templateId))}>Mark prepared</Button>
            <a
              href={link ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => { setOpened(true); run(() => logOutreach(contact.id, "chat_opened", text, templateId)); }}
            >
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700"><MessageCircle className="h-4 w-4" /> Open WhatsApp</Button>
            </a>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Opening the chat does <strong>not</strong> send the message. After you press send in WhatsApp, confirm below.
          </p>
          <div className={cn("mt-3 flex flex-wrap gap-2 rounded-lg border border-dashed p-3", opened ? "border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20" : "border-slate-200 dark:border-slate-700")}>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => logOutreach(contact.id, "contacted", text, templateId))}>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" /> I sent it — mark contacted
            </Button>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => logOutreach(contact.id, "replied"))}>Customer replied</Button>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => logOutreach(contact.id, "interested"))}>Interested</Button>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => logOutreach(contact.id, "follow_up_required"))}>Follow-up required</Button>
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => logOutreach(contact.id, "not_interested"))}>Not interested</Button>
          </div>
        </>
      )}
      <Feedback error={error} />
      {comms && comms.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-xs">
          {comms.slice(0, 8).map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 text-slate-600 dark:text-slate-400">
              <span>
                {m.direction === "inbound" ? "←" : "→"} {outreachLabel(m.status)} <span className="text-slate-400">({m.source === "whatsapp_cloud_api" ? "Business API" : m.source})</span>
                {m.delivery_status && <span className={m.delivery_status === "failed" ? "ml-1 text-rose-600" : "ml-1 text-emerald-700"}>· {m.delivery_status}</span>}
                {m.direction === "inbound" && m.body && <span className="block text-slate-500">“{m.body.slice(0, 160)}”</span>}
              </span>
              <span className="whitespace-nowrap text-slate-400">{formatDate(m.created_at, true)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  if (compact) return body;
  return (
    <Card>
      <CardHeader title="WhatsApp outreach" description="Manual click-to-chat. Statuses are recorded only when you confirm them." />
      {body}
    </Card>
  );
}

export function RecommendationsPanel({ contactId, recs, services }: {
  contactId: string;
  recs: { id: string; confidence: number; basis: string; reason: string; is_verified: boolean; service: { id: string; name: string } | null }[];
  services: { id: string; name: string }[];
}) {
  const { run, pending, error } = useAction();
  const [serviceId, setServiceId] = useState("");
  const [reason, setReason] = useState("");
  return (
    <Card>
      <CardHeader title="Recommended services" description="Rule-based suggestions are assumptions until verified" />
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {recs.length === 0 && <li className="px-5 py-4 text-sm text-slate-500">No recommendations yet.</li>}
        {recs.map((r) => (
          <li key={r.id} className="px-5 py-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{r.service?.name}</span>
              <div className="flex items-center gap-1">
                <Badge className="tabular-nums">{r.confidence}%</Badge>
                {!r.is_verified && (
                  <button title="Confirm this recommendation" disabled={pending} onClick={() => run(() => verifyRecommendation(r.id, contactId))} className="rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950">
                    <CheckCircle2 className="h-4 w-4" />
                  </button>
                )}
                <button title="Remove" disabled={pending} onClick={() => run(() => removeRecommendation(r.id, contactId))} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-1 flex items-start gap-2">
              <Badge className={r.is_verified ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"}>
                {r.is_verified ? "verified" : r.basis.replace("_", " ")}
              </Badge>
              <span className="text-xs text-slate-500">{r.reason}</span>
            </div>
          </li>
        ))}
      </ul>
      <form className="space-y-2 border-t border-slate-100 p-4 dark:border-slate-800"
        onSubmit={(e) => { e.preventDefault(); run(() => addRecommendation(contactId, serviceId, reason), () => { setServiceId(""); setReason(""); }); }}>
        <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          <option value="">Add a confirmed need…</option>
          {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Input placeholder="Evidence (e.g. owner said on call)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <Button size="sm" disabled={pending || !serviceId || !reason.trim()}>Add</Button>
        <Feedback error={error} />
      </form>
    </Card>
  );
}

export function FollowUpPanel({ contactId, followUps, assignees, me, canManage, names }: {
  contactId: string;
  followUps: { id: string; due_at: string; channel: string; note: string | null; status: string; assigned_to: string | null }[];
  assignees: { id: string; full_name: string }[];
  me: string; canManage: boolean; names: Record<string, string>;
}) {
  const { run, pending, error } = useAction();
  const defaultDue = toColomboInput(new Date(Date.now() + 24 * 3600 * 1000));
  const now = new Date().toISOString();
  return (
    <Card>
      <CardHeader title="Follow-ups" />
      <form
        className="grid gap-2 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          run(() => addFollowUp(contactId, fd), () => form.reset());
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <Input type="datetime-local" name="due_at" defaultValue={defaultDue} required />
          <Select name="channel" defaultValue="whatsapp">
            <option value="whatsapp">WhatsApp</option><option value="call">Call</option><option value="email">Email</option>
            <option value="meeting">Meeting</option><option value="visit">Visit</option>
          </Select>
        </div>
        {canManage && (
          <Select name="assigned_to" defaultValue={me}>
            {assignees.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </Select>
        )}
        <Input name="note" placeholder="What to do" maxLength={1000} />
        <Button size="sm" disabled={pending}>Schedule follow-up</Button>
        <Feedback error={error} />
      </form>
      <ul className="divide-y divide-slate-100 border-t border-slate-100 text-sm dark:divide-slate-800 dark:border-slate-800">
        {followUps.map((f) => (
          <li key={f.id} className="flex items-start justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <p className={cn("font-medium", f.status === "pending" && f.due_at < now && "text-rose-600")}>
                {formatDate(f.due_at, true)} · {f.channel}
              </p>
              <p className="truncate text-xs text-slate-500">{f.note || "—"} · {f.assigned_to ? names[f.assigned_to] : ""}</p>
            </div>
            {f.status === "pending" ? (
              <div className="flex shrink-0 gap-1">
                <button title="Done" disabled={pending} onClick={() => run(() => setFollowUpStatus(f.id, "done"))} className="rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950"><CheckCircle2 className="h-4 w-4" /></button>
                <button title="Postpone 1 day" disabled={pending} onClick={() => run(() => rescheduleFollowUp(f.id, toColomboInput(new Date(new Date(f.due_at).getTime() + 86400000))))} className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">+1d</button>
                <button title="Cancel" disabled={pending} onClick={() => run(() => setFollowUpStatus(f.id, "cancelled"))} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"><XCircle className="h-4 w-4" /></button>
              </div>
            ) : <Badge>{f.status}</Badge>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function VerificationPanel({ contact }: { contact: any }) {
  const { run, pending, error } = useAction();
  const [kind, setKind] = useState<"website" | "facebook">("website");
  const [url, setUrl] = useState<string>(contact.website ?? "");
  const row = (label: string, at: string | null, src: string | null, live: boolean | null) => (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span>{label}</span>
      {at ? (
        <span className="text-right text-xs">
          <Badge className={live ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}>{live ? "live / active" : "not live"}</Badge>
          <span className="ml-1 text-slate-500">{formatDate(at)}</span>
          {src && <a href={src} target="_blank" rel="noopener noreferrer" className="ml-1 inline-flex text-brand-600"><ExternalLink className="h-3 w-3" /></a>}
        </span>
      ) : <span className="text-xs text-slate-400">Not verified</span>}
    </div>
  );
  return (
    <Card>
      <CardHeader title="Online presence checks" description="Record only what you actually checked" />
      <div className="space-y-2 p-4">
        {row("Website", contact.website_verified_at, contact.website_verified_source, contact.website_is_live)}
        {row("Facebook page", contact.facebook_verified_at, contact.facebook_verified_source, contact.facebook_is_active)}
      </div>
      <div className="space-y-2 border-t border-slate-100 p-4 dark:border-slate-800">
        <Select value={kind} onChange={(e) => { const k = e.target.value as "website" | "facebook"; setKind(k); setUrl((k === "website" ? contact.website : contact.facebook_url) ?? ""); }}>
          <option value="website">Website</option>
          <option value="facebook">Facebook page</option>
        </Select>
        <Input placeholder="URL you checked" value={url} onChange={(e) => setUrl(e.target.value)} />
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={pending || !url} onClick={() => run(() => recordVerification(contact.id, kind, true, url))}>Live / active</Button>
          <Button size="sm" variant="outline" disabled={pending || !url} onClick={() => run(() => recordVerification(contact.id, kind, false, url))}>Not live</Button>
        </div>
        <Feedback error={error} />
      </div>
    </Card>
  );
}

export function DncControl({ contactId, dnc, reason, optedOutAt }: { contactId: string; dnc: boolean; reason: string | null; optedOutAt: string | null }) {
  const { run, pending, error } = useAction();
  const [why, setWhy] = useState("");
  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold">Privacy</h3>
      {dnc ? (
        <>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Opted out {formatDate(optedOutAt)} — {reason}</p>
          <Button size="sm" variant="outline" className="mt-3" disabled={pending} onClick={() => run(() => setDoNotContact(contactId, false))}>Remove do-not-contact</Button>
        </>
      ) : (
        <div className="mt-2 space-y-2">
          <Input placeholder="Reason (e.g. replied STOP)" value={why} onChange={(e) => setWhy(e.target.value)} maxLength={300} />
          <Button size="sm" variant="danger" disabled={pending} onClick={() => run(() => setDoNotContact(contactId, true, why))}>Mark do-not-contact</Button>
        </div>
      )}
      <Feedback error={error} />
    </Card>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function DetailsForm({ contact }: { contact: any }) {
  const { run, pending, error, message } = useAction();
  const fields: [string, string, string?][] = [
    ["company_name", "Company name"], ["industry", "Industry / category"], ["contact_person", "Contact person"],
    ["mobile", "Mobile"], ["landline", "Landline"], ["email", "Email", "email"], ["district", "District"], ["city", "City"],
    ["website", "Website"], ["facebook_url", "Facebook URL"], ["estimated_value", "Estimated deal value (LKR)", "number"],
  ];
  return (
    <Card>
      <CardHeader title="Edit lead details" />
      <form className="grid gap-3 p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); run(() => updateLeadDetails(contact.id, fd)); }}>
        {fields.map(([name, label, type]) => (
          <div key={name}>
            <Label htmlFor={name}>{label}</Label>
            <Input id={name} name={name} type={type ?? "text"} min={type === "number" ? 0 : undefined} defaultValue={contact[name] ?? ""} />
          </div>
        ))}
        <div className="sm:col-span-2">
          <Label htmlFor="address">Address</Label>
          <Input id="address" name="address" defaultValue={contact.address ?? ""} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" name="notes" rows={2} defaultValue={contact.notes ?? ""} />
        </div>
        <div className="sm:col-span-2"><Button disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button></div>
        <div className="sm:col-span-2"><Feedback error={error} message={message} /></div>
      </form>
    </Card>
  );
}
