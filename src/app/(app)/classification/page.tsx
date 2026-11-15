import Link from "next/link";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { Alert, Card, CardHeader, PageHeader } from "@/components/ui";
import { HBar } from "@/components/charts";
import type { Breakdowns } from "@/lib/stats";
import { RulesManager, ReclassifyButton } from "./rules-manager";
import { EnrichBatchButton } from "../leads/[id]/enrich-panel";

export default async function ClassificationPage() {
  const profile = await requireProfile();
  const supabase = createClient();
  const [{ data: bd }, { data: services }, { data: rules }] = await Promise.all([
    supabase.rpc("dashboard_breakdowns"),
    supabase.from("services").select("id,name,category").eq("is_active", true).order("sort_order"),
    supabase.from("classification_rules").select("id,keyword,weight,reason,is_active,service_id").order("keyword"),
  ]);
  const b = (bd ?? {}) as Breakdowns;
  const byService = new Map((b.by_service ?? []).map((s) => [s.name, Number(s.value)]));

  return (
    <>
      <PageHeader
        title="Smart Classification"
        description="Every lead is matched to PIXhub services from its business category and name. Suggestions are assumptions until a salesperson confirms them."
        actions={profile.role !== "sales_executive" ? <div className="flex flex-wrap items-start gap-3"><EnrichBatchButton /><ReclassifyButton /></div> : undefined}
      />

      <div className="mb-6"><Alert kind="info">
        <strong>How it works:</strong> keywords (whole words) in the <em>industry</em> or <em>company name</em> map to services with a confidence weight.
        Missing website / Facebook in the data adds a &ldquo;data gap&rdquo; suggestion. The lead score (0–100) combines business fit, reachability,
        online-presence gaps, recorded engagement and sales stage — each factor is labelled <em>fact</em> or <em>assumption</em> on the lead page.
      </Alert></div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Service demand" description="Leads with each recommended service" />
          <div className="p-4"><HBar data={b.by_service ?? []} height={380} /></div>
        </Card>
        <Card>
          <CardHeader title="Browse by service" />
          <ul className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto text-sm dark:divide-slate-800">
            {(services ?? []).map((s) => (
              <li key={s.id}>
                <Link href={`/leads?service=${s.id}`} className="flex items-center justify-between px-5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <span>{s.name} <span className="text-xs text-slate-400">· {s.category}</span></span>
                  <span className="tabular-nums text-slate-500">{byService.get(s.name) ?? 0}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-6">
        <RulesManager rules={rules ?? []} services={services ?? []} canEdit={profile.role === "admin"} />
      </div>
    </>
  );
}
