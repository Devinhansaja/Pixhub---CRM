"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, CardHeader, Input, Select } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useAction } from "@/lib/use-action";
import { formatNumber } from "@/lib/utils";
import { addRule, deleteRule, toggleRule } from "./actions";

export function ReclassifyButton() {
  const router = useRouter();
  const [state, setState] = useState<{ done: number; running: boolean; error?: string } | null>(null);

  async function run() {
    if (!confirm("Re-run classification for all leads you can access? Manually confirmed recommendations are kept.")) return;
    const supabase = createClient();
    setState({ done: 0, running: true });
    let done = 0;
    let lastId = "00000000-0000-0000-0000-000000000000";
    for (;;) {
      const { data, error } = await supabase.from("contacts").select("id").gt("id", lastId).order("id").limit(1000);
      if (error) { setState({ done, running: false, error: error.message }); return; }
      if (!data?.length) break;
      const ids = data.map((d) => d.id);
      const res = await supabase.rpc("classify_contacts", { p_ids: ids });
      if (res.error) { setState({ done, running: false, error: res.error.message }); return; }
      done += ids.length;
      lastId = ids[ids.length - 1];
      setState({ done, running: true });
    }
    setState({ done, running: false });
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      {state && <span className="text-sm text-slate-500">{state.error ? <span className="text-rose-600">{state.error}</span> : `${formatNumber(state.done)} leads ${state.running ? "processed…" : "re-classified"}`}</span>}
      <Button onClick={run} disabled={state?.running}>
        {state?.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Re-classify all
      </Button>
    </div>
  );
}

export function RulesManager({ rules, services, canEdit }: {
  rules: { id: string; keyword: string; weight: number; reason: string; is_active: boolean; service_id: string }[];
  services: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const { run, pending, error, message } = useAction();
  const [filter, setFilter] = useState("");
  const names = new Map(services.map((s) => [s.id, s.name]));
  const shown = useMemo(() => {
    const f = filter.toLowerCase();
    return rules.filter((r) => !f || r.keyword.includes(f) || (names.get(r.service_id) ?? "").toLowerCase().includes(f));
  }, [rules, filter, names]);

  return (
    <Card>
      <CardHeader title={`Classification rules (${rules.length})`} description="Keyword → service mapping" action={<Input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-48" />} />
      {canEdit && (
        <form className="grid gap-2 border-b border-slate-100 p-4 dark:border-slate-800 md:grid-cols-[1fr_1.4fr_90px_2fr_auto]"
          onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const fd = new FormData(f); run(() => addRule(fd), () => f.reset()); }}>
          <Input name="keyword" placeholder="Keyword e.g. bakery" required />
          <Select name="service_id" required defaultValue="">
            <option value="" disabled>Service…</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Input name="weight" type="number" min={1} max={100} defaultValue={70} required />
          <Input name="reason" placeholder="Why this service fits" required />
          <Button size="md" disabled={pending}>Add rule</Button>
        </form>
      )}
      {(error || message) && <div className="p-4 pb-0"><Alert kind={error ? "error" : "success"}>{error ?? message}</Alert></div>}
      <div className="max-h-[520px] overflow-y-auto">
        <table className="table-base">
          <thead><tr><th>Keyword</th><th>Service</th><th className="text-right">Weight</th><th>Reason</th><th>Status</th>{canEdit && <th />}</tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className={r.is_active ? "" : "opacity-50"}>
                <td className="font-mono text-xs">{r.keyword}</td>
                <td>{names.get(r.service_id)}</td>
                <td className="text-right tabular-nums">{r.weight}</td>
                <td className="text-slate-500">{r.reason}</td>
                <td>
                  {canEdit ? (
                    <button disabled={pending} onClick={() => run(() => toggleRule(r.id, !r.is_active))}>
                      <Badge className={r.is_active ? "bg-emerald-50 text-emerald-700" : ""}>{r.is_active ? "active" : "off"}</Badge>
                    </button>
                  ) : <Badge>{r.is_active ? "active" : "off"}</Badge>}
                </td>
                {canEdit && (
                  <td>
                    <button disabled={pending} onClick={() => confirm(`Delete rule "${r.keyword}"?`) && run(() => deleteRule(r.id))} className="text-slate-400 hover:text-rose-600" aria-label="Delete rule">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
