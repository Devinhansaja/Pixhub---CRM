"use client";

import { Globe, Loader2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader } from "@/components/ui";
import { useAction } from "@/lib/use-action";
import { formatDate } from "@/lib/utils";
import { enrichLead, enrichBatch } from "../enrich-actions";

export interface Enrichment {
  checked_at: string; source_url: string; final_url: string | null; http_status: number | null; is_live: boolean;
  uses_https: boolean | null; mobile_friendly: boolean | null; page_title: string | null; meta_description: string | null;
  facebook_link: string | null; has_ecommerce_signals: boolean | null; error: string | null;
}

const yes = (v: boolean | null, t: string, f: string) => v === null ? null : <Badge className={v ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}>{v ? t : f}</Badge>;

export function EnrichPanel({ contactId, hasWebsite, latest }: { contactId: string; hasWebsite: boolean; latest: Enrichment | null }) {
  const { run, pending, error, message } = useAction();
  return (
    <Card>
      <CardHeader title="Website check" description="Automatic check of the public website. Stores what was found, the URL and the time."
        action={<Button size="sm" variant="outline" disabled={pending || !hasWebsite} onClick={() => run(() => enrichLead(contactId))}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />} {latest ? "Re-check" : "Check now"}
        </Button>} />
      <div className="space-y-2 p-5 text-sm">
        {!hasWebsite && <p className="text-slate-500">No website on file. Add one in “Edit lead details” to check it.</p>}
        {error && <Alert kind="error">{error}</Alert>}
        {message && <Alert kind="success">{message}</Alert>}
        {latest ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              <Badge className={latest.is_live ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}>{latest.is_live ? `Live · HTTP ${latest.http_status}` : "Not reachable"}</Badge>
              {yes(latest.uses_https, "HTTPS", "No HTTPS")}
              {yes(latest.mobile_friendly, "Mobile-friendly", "Not mobile-friendly")}
              {latest.has_ecommerce_signals && <Badge className="bg-sky-50 text-sky-700">Online shop detected</Badge>}
            </div>
            {latest.page_title && <p><span className="text-slate-500">Title:</span> {latest.page_title}</p>}
            {latest.meta_description && <p className="text-slate-600 dark:text-slate-400">{latest.meta_description}</p>}
            {latest.facebook_link && <p><span className="text-slate-500">Facebook on site:</span> <a href={latest.facebook_link} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">{latest.facebook_link}</a></p>}
            {latest.error && <p className="text-rose-600">{latest.error}</p>}
            <p className="text-xs text-slate-400">Checked {formatDate(latest.checked_at, true)} · {latest.final_url ?? latest.source_url}</p>
            {latest.is_live && latest.mobile_friendly === false && <p className="text-xs text-amber-700">Sales angle (fact-based): the site has no mobile viewport — a redesign may be relevant.</p>}
          </>
        ) : hasWebsite && <p className="text-slate-500">Not checked yet.</p>}
      </div>
    </Card>
  );
}

export function EnrichBatchButton() {
  const { run, pending, error, message } = useAction();
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" disabled={pending} onClick={() => run(() => enrichBatch())}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />} Check 25 websites
      </Button>
      {(error || message) && <span className={`text-xs ${error ? "text-rose-600" : "text-emerald-700"}`}>{error ?? message}</span>}
    </div>
  );
}
