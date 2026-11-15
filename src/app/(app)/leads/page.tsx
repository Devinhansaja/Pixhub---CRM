import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { applyLeadFilters, leadSelect, loadAssignees, PAGE_SIZE, type LeadFilters } from "@/lib/leads-query";
import { STAGES } from "@/lib/constants";
import { Alert, Button, Card, Input, PageHeader, Select } from "@/components/ui";
import { LeadsTable, type LeadRow } from "./leads-table";
import { formatNumber } from "@/lib/utils";

export default async function LeadsPage({ searchParams }: { searchParams: LeadFilters }) {
  const profile = await requireProfile();
  const supabase = createClient();
  const page = Math.max(1, Number(searchParams.page) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const base =
    "id,company_name,industry,district,city,mobile,landline,lead_score,stage,assigned_to,last_contacted_at,next_follow_up_at,estimated_value,do_not_contact,whatsapp_status," +
    "recs:lead_service_recommendations(confidence,service:services(name))";
  let query = supabase.from("contacts").select(leadSelect(searchParams, base), { count: "exact" });
  query = applyLeadFilters(query, searchParams, profile.id);
  const canManage = profile.role !== "sales_executive";
  const [{ data, count, error }, assignees, { data: services }, { data: options }, { data: imports }] = await Promise.all([
    query.range(from, from + PAGE_SIZE - 1),
    loadAssignees(supabase),
    supabase.from("services").select("id,name").eq("is_active", true).order("sort_order"),
    supabase.rpc("lead_filter_options"),
    canManage
      ? supabase.from("lead_imports").select("id,file_name,created_at,inserted_rows").order("created_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] as { id: string; file_name: string; created_at: string; inserted_rows: number }[] }),
  ]);
  const opts = (options ?? { districts: [], industries: [] }) as { districts: string[]; industries: string[] };
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeImport = (imports ?? []).find((i) => i.id === searchParams.import);

  const qs = (p: number) => {
    const u = new URLSearchParams(Object.entries(searchParams).filter(([, v]) => v) as [string, string][]);
    u.set("page", String(p));
    return `/leads?${u}`;
  };
  const exportQs = new URLSearchParams(Object.entries(searchParams).filter(([k, v]) => v && k !== "page") as [string, string][]);

  return (
    <>
      <PageHeader
        title="All Leads"
        description={`${formatNumber(total)} leads match your filters${activeImport ? ` · from “${activeImport.file_name}”` : ""}`}
        actions={
          <>
            {canManage && (
              <a href={`/leads/export?${exportQs}`}>
                <Button variant="outline"><Download className="h-4 w-4" /> Export</Button>
              </a>
            )}
            <Link href="/leads/new"><Button><Plus className="h-4 w-4" /> Add lead</Button></Link>
          </>
        }
      />

      <Card className="mb-4 p-4">
        <form method="get" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
          {canManage && (
            <Select name="import" defaultValue={searchParams.import ?? ""} className="col-span-2" aria-label="Uploaded file">
              <option value="">All uploaded files</option>
              {(imports ?? []).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.file_name} · {new Date(i.created_at).toLocaleDateString("en-GB", { timeZone: "Asia/Colombo" })} · {formatNumber(i.inserted_rows)} leads
                </option>
              ))}
            </Select>
          )}
          <Input name="q" placeholder="Search name, phone, email" defaultValue={searchParams.q} className="col-span-2" />
          <Input name="city" placeholder="City / town" defaultValue={searchParams.city} />
          <Select name="stage" defaultValue={searchParams.stage ?? ""}>
            <option value="">All stages</option>
            {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
          <Select name="district" defaultValue={searchParams.district ?? ""}>
            <option value="">All districts</option>
            {opts.districts.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
          <Select name="industry" defaultValue={searchParams.industry ?? ""}>
            <option value="">All industries</option>
            {opts.industries.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
          <Select name="service" defaultValue={searchParams.service ?? ""}>
            <option value="">All services</option>
            {(services ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select name="owner" defaultValue={searchParams.owner ?? ""}>
            <option value="">Any owner</option>
            <option value="me">Assigned to me</option>
            {canManage && <option value="unassigned">Unassigned</option>}
            {canManage && assignees.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </Select>
          <Select name="sort" defaultValue={searchParams.sort ?? "score"}>
            <option value="score">Sort: Lead score</option>
            <option value="recent">Sort: Newest</option>
            <option value="name">Sort: Name</option>
            <option value="followup">Sort: Next follow-up</option>
            <option value="contacted">Sort: Last contacted</option>
          </Select>
          <Select name="mobile" defaultValue={searchParams.mobile ?? ""}>
            <option value="">Any phone</option>
            <option value="valid">Has valid mobile</option>
            <option value="none">No valid mobile</option>
          </Select>
          <Select name="min_score" defaultValue={searchParams.min_score ?? ""}>
            <option value="">Any score</option>
            <option value="40">Score ≥ 40</option>
            <option value="60">Score ≥ 60</option>
            <option value="75">Score ≥ 75</option>
          </Select>
          <Select name="followup" defaultValue={searchParams.followup ?? ""}>
            <option value="">Any follow-up</option>
            <option value="overdue">Overdue follow-up</option>
          </Select>
          <Select name="has" defaultValue={searchParams.has ?? ""} aria-label="Data in sheet">
            <option value="">Any details</option>
            <option value="website">Has website</option>
            <option value="no_website">No website</option>
            <option value="email">Has email</option>
            <option value="no_email">No email</option>
            <option value="facebook">Has Facebook</option>
            <option value="no_facebook">No Facebook</option>
          </Select>
          <div className="col-span-2 flex gap-2">
            <Button type="submit" className="flex-1">Apply</Button>
            <Link href="/leads"><Button type="button" variant="ghost">Reset</Button></Link>
          </div>
        </form>
      </Card>

      {error ? (
        <Alert kind="error">Could not load leads: {error.message}</Alert>
      ) : (
        <LeadsTable rows={(data ?? []) as unknown as LeadRow[]} assignees={assignees} canManage={canManage} />
      )}

      <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
        <span>Page {page} of {pages}</span>
        <div className="flex gap-2">
          {page > 1 && <Link href={qs(page - 1)}><Button variant="outline" size="sm">Previous</Button></Link>}
          {page < pages && <Link href={qs(page + 1)}><Button variant="outline" size="sm">Next</Button></Link>}
        </div>
      </div>
    </>
  );
}
