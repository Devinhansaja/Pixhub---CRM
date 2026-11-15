"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2, Users } from "lucide-react";
import { Alert, Button, Card, CardHeader, Input, Label, Select, Textarea } from "@/components/ui";
import { STAGES } from "@/lib/constants";
import { fillTemplate } from "@/lib/email-core";
import { formatNumber } from "@/lib/utils";
import { previewAudience, saveCampaign, type Audience, type CampaignInput } from "./actions";

export interface Options {
  imports: { id: string; file_name: string }[]; industries: string[]; districts: string[];
  services: { id: string; name: string }[]; assignees: { id: string; full_name: string }[];
}

const DAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]] as const;
const PLACEHOLDERS = "{{company}} {{contact_person}} {{services}} {{city}} {{sender}}";

export const DEFAULT_CAMPAIGN: CampaignInput = {
  name: "", subject: "A website for {{company}}?",
  body: "Hello {{contact_person}},\n\nI'm {{sender}} from PIXhub.lk. We help businesses in {{city}} win more customers online — mobile-friendly websites with WhatsApp contact start from LKR 15,000, and we also run Facebook & Instagram for local brands.\n\nWould a short call this week be useful to see what would suit {{company}}?\n\nThank you,\n{{sender}}\nPIXhub.lk · https://pixhub.lk",
  audience: {}, followup_enabled: true, followup_days: 4,
  followup1_subject: "Re: A website for {{company}}?",
  followup1_body: "Hello {{contact_person}},\n\nJust following up on my earlier email. If it helps, I can send two or three examples of websites we've built for similar businesses — no obligation.\n\nThanks,\n{{sender}}",
  followup2_subject: "", followup2_body: "",
  daily_limit: 50, min_gap_minutes: 1, max_gap_minutes: 3, send_start_hour: 9, send_end_hour: 17, send_days: [1, 2, 3, 4, 5],
  ai_review: true, max_bounce_rate: 5,
};

export function CampaignEditor({ initial, options, locked, aiAvailable }: { initial: CampaignInput; options: Options; locked: boolean; aiAvailable: boolean }) {
  const router = useRouter();
  const [c, setC] = useState<CampaignInput>({ ...initial, ai_review: aiAvailable ? initial.ai_review : false });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [aud, setAud] = useState<{ count: number; sample: { company_name: string; email: string; city: string | null }[] } | null>(null);
  const [audLoading, startAud] = useTransition();
  const set = <K extends keyof CampaignInput>(k: K, v: CampaignInput[K]) => setC((x) => ({ ...x, [k]: v }));
  const setA = (k: keyof Audience, v: string) => setC((x) => ({ ...x, audience: { ...x.audience, [k]: v || undefined } }));

  useEffect(() => {
    const t = setTimeout(() => startAud(async () => { const r = await previewAudience(c.audience); if (r.ok && r.data) setAud(r.data); }), 400);
    return () => clearTimeout(t);
  }, [c.audience]);

  const save = () => startSave(async () => {
    setError(null); setMessage(null);
    const r = await saveCampaign(c);
    if (!r.ok) { setError(r.error); return; }
    setMessage(r.message ?? "Saved");
    if (!initial.id && r.data?.id) router.push(`/campaigns/${r.data.id}`); else router.refresh();
  });

  const sample = aud?.sample[0];
  const vars = { company: sample?.company_name ?? "Sample Company", contact_person: null, city: sample?.city ?? "Colombo", services: ["Business Website"], sender: "You" };
  const perDayAtFull = Math.floor(((c.send_end_hour - c.send_start_hour) * 60) / ((c.min_gap_minutes + c.max_gap_minutes) / 2 || 1));
  const days = aud ? Math.ceil(aud.count / Math.max(1, Math.min(c.daily_limit, perDayAtFull))) : 0;

  return (
    <div className="space-y-6">
      {locked && <Alert kind="info">This campaign is approved: the audience and email text are locked. You can still change its name, speed and schedule.</Alert>}
      <Card className="p-5">
        <Label>Campaign name</Label>
        <Input value={c.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Kandy restaurants — website offer, Nov" maxLength={150} />
      </Card>

      <Card>
        <CardHeader title="1. Who receives it" description="Only leads with an email address who haven't opted out or bounced are included." />
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2"><Label>Uploaded file</Label>
            <Select disabled={locked} value={c.audience.import ?? ""} onChange={(e) => setA("import", e.target.value)}>
              <option value="">All files</option>{options.imports.map((i) => <option key={i.id} value={i.id}>{i.file_name}</option>)}
            </Select></div>
          <div><Label>Industry</Label>
            <Select disabled={locked} value={c.audience.industry ?? ""} onChange={(e) => setA("industry", e.target.value)}>
              <option value="">All</option>{options.industries.map((i) => <option key={i}>{i}</option>)}
            </Select></div>
          <div><Label>District</Label>
            <Select disabled={locked} value={c.audience.district ?? ""} onChange={(e) => setA("district", e.target.value)}>
              <option value="">All</option>{options.districts.map((i) => <option key={i}>{i}</option>)}
            </Select></div>
          <div><Label>City contains</Label><Input disabled={locked} value={c.audience.city ?? ""} onChange={(e) => setA("city", e.target.value)} /></div>
          <div><Label>Recommended service</Label>
            <Select disabled={locked} value={c.audience.service ?? ""} onChange={(e) => setA("service", e.target.value)}>
              <option value="">Any</option>{options.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select></div>
          <div><Label>Stage</Label>
            <Select disabled={locked} value={c.audience.stage ?? ""} onChange={(e) => setA("stage", e.target.value)}>
              <option value="">Any</option>{STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select></div>
          <div><Label>Minimum score</Label>
            <Select disabled={locked} value={c.audience.min_score ?? ""} onChange={(e) => setA("min_score", e.target.value)}>
              <option value="">Any</option><option value="40">40+</option><option value="60">60+</option><option value="75">75+</option>
            </Select></div>
          <div><Label>Owner</Label>
            <Select disabled={locked} value={c.audience.owner ?? ""} onChange={(e) => setA("owner", e.target.value)}>
              <option value="">Anyone</option><option value="unassigned">Unassigned</option>
              {options.assignees.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </Select></div>
        </div>
        <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-3 text-sm dark:border-slate-800">
          {audLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4 text-brand-600" />}
          <span><strong>{formatNumber(aud?.count ?? 0)}</strong> leads will receive this campaign</span>
          {aud && aud.count > 0 && <span className="text-slate-500">· e.g. {aud.sample.map((s) => s.company_name).slice(0, 3).join(", ")}</span>}
        </div>
      </Card>

      <Card>
        <CardHeader title="2. The email" description={`Personalise with ${PLACEHOLDERS}. An unsubscribe link and your footer are added automatically.`} />
        <div className="grid gap-4 p-5 lg:grid-cols-2">
          <div className="space-y-3">
            <div><Label>Subject</Label><Input disabled={locked} value={c.subject} onChange={(e) => set("subject", e.target.value)} maxLength={200} /></div>
            <div><Label>Message</Label><Textarea disabled={locked} rows={12} value={c.body} onChange={(e) => set("body", e.target.value)} maxLength={8000} /></div>
          </div>
          <div>
            <Label>Preview{sample ? ` (${sample.company_name})` : ""}</Label>
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-800 dark:border-slate-700">
              <p className="mb-3 font-semibold">{fillTemplate(c.subject, vars)}</p>
              <p className="whitespace-pre-wrap">{fillTemplate(c.body, vars)}</p>
              <p className="mt-4 border-t pt-2 text-xs text-slate-500">Footer · Unsubscribe link</p>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="3. Automatic follow-ups" description="Sent only if the lead hasn't replied, moved forward in the pipeline, or unsubscribed." />
        <div className="space-y-3 p-5">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={locked} checked={c.followup_enabled} onChange={(e) => set("followup_enabled", e.target.checked)} /> Send follow-ups</label>
          {c.followup_enabled && (
            <>
              <div className="w-48"><Label>Wait before each follow-up (days)</Label><Input type="number" min={1} max={30} value={c.followup_days} onChange={(e) => set("followup_days", Number(e.target.value))} /></div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-2"><Label>Follow-up 1 subject</Label><Input disabled={locked} value={c.followup1_subject ?? ""} onChange={(e) => set("followup1_subject", e.target.value)} />
                  <Label>Follow-up 1 message</Label><Textarea disabled={locked} rows={6} value={c.followup1_body ?? ""} onChange={(e) => set("followup1_body", e.target.value)} /></div>
                <div className="space-y-2"><Label>Follow-up 2 subject (optional)</Label><Input disabled={locked} value={c.followup2_subject ?? ""} onChange={(e) => set("followup2_subject", e.target.value)} />
                  <Label>Follow-up 2 message (optional)</Label><Textarea disabled={locked} rows={6} value={c.followup2_body ?? ""} onChange={(e) => set("followup2_body", e.target.value)} /></div>
              </div>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="4. Speed & schedule (breaks)" description="A random break between emails makes sending look natural and protects pixhub.lk from spam filters." />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
          <div><Label>Max emails per day</Label><Input type="number" min={1} max={2000} value={c.daily_limit} onChange={(e) => set("daily_limit", Number(e.target.value))} /></div>
          <div><Label>Shortest break (minutes)</Label><Input type="number" min={1} step="0.5" value={c.min_gap_minutes} onChange={(e) => set("min_gap_minutes", Number(e.target.value))} /></div>
          <div><Label>Longest break (minutes)</Label><Input type="number" min={1} step="0.5" value={c.max_gap_minutes} onChange={(e) => set("max_gap_minutes", Number(e.target.value))} /></div>
          <div><Label>Auto-pause if bounces exceed (%)</Label><Input type="number" min={0.5} max={50} step="0.5" value={c.max_bounce_rate} onChange={(e) => set("max_bounce_rate", Number(e.target.value))} /></div>
          <div><Label>Send from (hour)</Label>
            <Select value={c.send_start_hour} onChange={(e) => set("send_start_hour", Number(e.target.value))}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</Select></div>
          <div><Label>Send until (hour)</Label>
            <Select value={c.send_end_hour} onChange={(e) => set("send_end_hour", Number(e.target.value))}>{Array.from({ length: 24 }, (_, h) => <option key={h + 1} value={h + 1}>{String(h + 1).padStart(2, "0")}:00</option>)}</Select></div>
          <div className="sm:col-span-2"><Label>Sending days (Sri Lanka time)</Label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map(([d, l]) => (
                <label key={d} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${c.send_days.includes(d) ? "border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-100" : "border-slate-300 dark:border-slate-700"}`}>
                  <input type="checkbox" className="hidden" checked={c.send_days.includes(d)} onChange={(e) => set("send_days", e.target.checked ? [...c.send_days, d] : c.send_days.filter((x) => x !== d))} />{l}
                </label>
              ))}
            </div></div>
        </div>
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500 dark:border-slate-800">
          At this pace: up to {formatNumber(Math.min(c.daily_limit, perDayAtFull))} emails per sending day{aud?.count ? `, so about ${formatNumber(days)} sending day(s) for ${formatNumber(aud.count)} leads` : ""}. New domains should start around 30–50 a day and increase slowly.
        </p>
      </Card>

      <Card className="p-5">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" disabled={locked || !aiAvailable} checked={c.ai_review} onChange={(e) => set("ai_review", e.target.checked)} />
          <span><strong>AI checks every email before it's sent</strong> — holds back emails with wrong names, unfilled {"{{tags}}"}, invented claims or spammy wording.
            {!aiAvailable && <span className="block text-amber-700">Not available: the AI key (ANTHROPIC_API_KEY) isn't set up on the server.</span>}</span>
        </label>
      </Card>

      {error && <Alert kind="error">{error}</Alert>}
      {message && <Alert kind="success">{message}</Alert>}
      <div className="flex gap-2"><Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}{initial.id ? "Save changes" : "Save as draft"}</Button></div>
    </div>
  );
}
