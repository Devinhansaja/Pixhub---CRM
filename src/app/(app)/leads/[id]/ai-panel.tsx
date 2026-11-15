"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Loader2, Sparkles } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Input, Select } from "@/components/ui";
import {
  draftMessage, recommendServicesAi, saveAiRecommendations, summarizeLead,
  type LeadSummary, type ServiceSuggestion,
} from "../../assistant/actions";

export function AiPanel({ contactId, enabled, dnc, serviceNames }: { contactId: string; enabled: boolean; dnc: boolean; serviceNames: Record<string, string> }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<LeadSummary | null>(null);
  const [recs, setRecs] = useState<{ recommendations: ServiceSuggestion[]; data_gaps: string[] } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ message: string; tips: string } | null>(null);
  const [purpose, setPurpose] = useState("first_contact");
  const [language, setLanguage] = useState("en");
  const [extra, setExtra] = useState("");
  const [copied, setCopied] = useState(false);

  if (!enabled) {
    return (
      <Card className="p-5 text-sm">
        <h3 className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-brand-600" /> AI help</h3>
        <p className="mt-1 text-slate-500">Not configured. An administrator can enable it by setting <code>ANTHROPIC_API_KEY</code>.</p>
      </Card>
    );
  }

  const go = <T,>(label: string, fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, onOk: (d: T) => void) => {
    setBusy(label); setError(null);
    start(async () => {
      const r = await fn();
      if (r.ok) onOk(r.data); else setError(r.error);
      setBusy(null);
    });
  };

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand-600" /> AI help</span>} description="Uses only this lead's CRM data. Review before using." />
      <div className="space-y-4 p-5 text-sm">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => go("summary", () => summarizeLead(contactId), setSummary)}>
            {busy === "summary" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Summary & next action
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => go("recs", () => recommendServicesAi(contactId), (d) => { setRecs(d); setSaved(null); })}>
            {busy === "recs" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Suggest services
          </Button>
        </div>
        {error && <Alert kind="error">{error}</Alert>}

        {summary && (
          <div className="space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
            <div className="flex items-center gap-2"><span className="font-medium">Priority</span>
              <Badge className={summary.priority === "high" ? "bg-rose-100 text-rose-700" : summary.priority === "medium" ? "bg-amber-100 text-amber-800" : ""}>{summary.priority}</Badge></div>
            <p>{summary.summary}</p>
            <p><span className="font-medium">Next action:</span> {summary.next_action} <span className="text-slate-500">— {summary.next_action_reason}</span></p>
            {summary.facts.length > 0 && <div><p className="text-xs font-semibold uppercase text-emerald-700">Facts</p><ul className="list-disc pl-5">{summary.facts.map((f, i) => <li key={i}>{f}</li>)}</ul></div>}
            {summary.assumptions.length > 0 && <div><p className="text-xs font-semibold uppercase text-amber-700">Assumptions</p><ul className="list-disc pl-5">{summary.assumptions.map((f, i) => <li key={i}>{f}</li>)}</ul></div>}
            {summary.open_questions.length > 0 && <div><p className="text-xs font-semibold uppercase text-slate-500">Find out</p><ul className="list-disc pl-5">{summary.open_questions.map((f, i) => <li key={i}>{f}</li>)}</ul></div>}
          </div>
        )}

        {recs && (
          <div className="space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
            {recs.recommendations.length === 0 && <p className="text-slate-500">No confident recommendation from the data available.</p>}
            {recs.recommendations.map((r) => (
              <div key={r.service_slug}>
                <p className="font-medium">{serviceNames[r.service_slug] ?? r.service_slug} <Badge className="ml-1 tabular-nums">{r.confidence}%</Badge></p>
                <p className="text-slate-600 dark:text-slate-400">{r.reason}</p>
              </div>
            ))}
            {recs.data_gaps.length > 0 && <p className="text-xs text-slate-500"><span className="font-semibold">Missing info:</span> {recs.data_gaps.join("; ")}</p>}
            {recs.recommendations.length > 0 && (
              <Button size="sm" variant="outline" disabled={pending || !!saved}
                onClick={() => go("save", () => saveAiRecommendations(contactId, recs.recommendations), (n) => setSaved(`${n} suggestion(s) saved as unverified. Confirmed recommendations were left unchanged.`))}>
                Save as unverified suggestions
              </Button>
            )}
            {saved && <p className="text-xs text-emerald-700">{saved}</p>}
          </div>
        )}

        <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <p className="font-medium">Draft a WhatsApp message</p>
          {dnc ? <p className="text-slate-500">Disabled — this contact is marked do-not-contact.</p> : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Select value={purpose} onChange={(e) => setPurpose(e.target.value)} className="h-9">
                  <option value="first_contact">First contact</option>
                  <option value="follow_up">Follow-up</option>
                  <option value="meeting_confirmation">Meeting confirmation</option>
                  <option value="quotation_follow_up">Quotation follow-up</option>
                  <option value="re_engage">Re-engage a quiet lead</option>
                </Select>
                <Select value={language} onChange={(e) => setLanguage(e.target.value)} className="h-9">
                  <option value="en">English</option><option value="si">සිංහල</option><option value="ta">தமிழ்</option>
                </Select>
              </div>
              <Input className="h-9" placeholder="Optional: anything to mention (e.g. 20% launch offer)" value={extra} maxLength={400} onChange={(e) => setExtra(e.target.value)} />
              <Button size="sm" disabled={pending} onClick={() => go("draft", () => draftMessage(contactId, purpose, language, extra), (d) => { setDraft(d); setCopied(false); })}>
                {busy === "draft" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Draft message
              </Button>
              {draft && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                  <p className="whitespace-pre-wrap">{draft.message}</p>
                  <p className="mt-2 text-xs text-slate-500">Tip: {draft.tips}</p>
                  <Button size="sm" variant="outline" className="mt-2" onClick={async () => { await navigator.clipboard.writeText(draft.message); setCopied(true); }}>
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied — paste it in the WhatsApp panel" : "Copy"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
