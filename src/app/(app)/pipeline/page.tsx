import Link from "next/link";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { Alert, Card, PageHeader } from "@/components/ui";
import { STAGES } from "@/lib/constants";
import { formatLKR } from "@/lib/utils";
import { DealBoard, LeadBoard, type BoardCard, type DealCard } from "./board";

const PER_STAGE = 40;

export default async function PipelinePage({ searchParams }: { searchParams: { owner?: string; view?: string } }) {
  const profile = await requireProfile();
  const supabase = createClient();
  const view = searchParams.view === "leads" ? "leads" : "deals";
  const mine = searchParams.owner === "me" || profile.role === "sales_executive";

  const tab = (v: string, label: string) => (
    <Link href={`/pipeline?view=${v}${searchParams.owner ? `&owner=${searchParams.owner}` : ""}`}
      className={`rounded-lg px-3 py-1.5 text-sm ${view === v ? "bg-brand-600 text-white" : "bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300"}`}>{label}</Link>
  );
  const ownerToggle = profile.role !== "sales_executive" && (
    <Link href={`/pipeline?view=${view}${mine ? "" : "&owner=me"}`} className="text-sm text-brand-600 hover:underline">
      {mine ? "Show everyone I can see" : "Show only mine"}
    </Link>
  );

  if (view === "deals") {
    // One query for all deals (grouped here) instead of one query per stage.
    let q = supabase.from("deals")
      .select("id,title,value,probability,expected_close_date,stage,contact:contacts(id,company_name),owner:profiles!deals_assigned_to_fkey(full_name),service:services(name)")
      .order("value", { ascending: false }).limit(5000);
    if (mine) q = q.eq("assigned_to", profile.id);
    const { data: allDeals, error: dealsError } = await q;
    const rows = (allDeals ?? []) as unknown as (DealCard & { stage: string })[];
    const results = STAGES.map((s) => {
      const inStage = rows.filter((d) => d.stage === s.value);
      return { stage: s.value, cards: inStage.slice(0, PER_STAGE), count: inStage.length, error: dealsError };
    });
    const err = dealsError;
    const open = results.filter((r) => !["won", "lost", "not_interested"].includes(r.stage));
    const openRows = rows.filter((d) => open.some((o) => o.stage === d.stage));
    const openValue = openRows.reduce((a, c) => a + Number(c.value), 0);
    const weighted = openRows.reduce((a, c) => a + Number(c.value) * c.probability / 100, 0);
    const totalDeals = rows.length;

    return (
      <>
        <PageHeader title="Sales Pipeline" description="Deals by stage — drag a card to move it. Probability updates automatically unless you set it." actions={<div className="flex items-center gap-2">{tab("deals", "Deals")}{tab("leads", "Leads")}</div>} />
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card className="p-4"><p className="text-xs text-slate-500">Open pipeline</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatLKR(openValue)}</p></Card>
          <Card className="p-4"><p className="text-xs text-slate-500">Weighted (by probability)</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatLKR(weighted)}</p></Card>
          <Card className="p-4"><p className="text-xs text-slate-500">Deals</p><p className="mt-1 text-lg font-semibold tabular-nums">{totalDeals}</p></Card>
          <Card className="flex items-center p-4">{ownerToggle}</Card>
        </div>
        {err && <Alert kind="error">{err.message}</Alert>}
        {totalDeals === 0 && <div className="mb-4"><Alert kind="info">No deals yet. Open a lead and use <strong>Deals → New deal</strong>; a company can have several deals (e.g. website + social media).</Alert></div>}
        <DealBoard columns={results.map(({ stage, cards, count }) => ({ stage, cards, count }))} />
        <p className="mt-2 text-xs text-slate-500">Each column shows its top {PER_STAGE} deals by value; totals include every deal.</p>
      </>
    );
  }

  const results = await Promise.all(STAGES.map(async (s) => {
    let q = supabase.from("contacts")
      .select("id,company_name,industry,lead_score,estimated_value,next_follow_up_at", { count: "exact" })
      .eq("stage", s.value).order("lead_score", { ascending: false }).limit(PER_STAGE);
    if (mine) q = q.eq("assigned_to", profile.id);
    const { data, count, error } = await q;
    return { stage: s.value, cards: (data ?? []) as BoardCard[], count: count ?? 0, error };
  }));
  const err = results.find((r) => r.error)?.error;
  return (
    <>
      <PageHeader title="Sales Pipeline" description={`Leads by stage — top ${PER_STAGE} per stage by score.`} actions={<div className="flex items-center gap-3">{ownerToggle}{tab("deals", "Deals")}{tab("leads", "Leads")}</div>} />
      {err && <Alert kind="error">{err.message}</Alert>}
      <LeadBoard columns={results.map(({ stage, cards, count }) => ({ stage, cards, count }))} />
    </>
  );
}
