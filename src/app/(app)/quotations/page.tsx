import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { QUOTATION_STATUSES, quotationColor, quotationLabel } from "@/lib/constants";
import { formatDate, formatLKR, sanitizeSearch } from "@/lib/utils";

export default async function QuotationsPage({ searchParams }: { searchParams: { status?: string; q?: string } }) {
  const profile = await requireProfile();
  const supabase = createClient();
  await supabase.rpc("expire_quotations"); // keeps statuses current even without pg_cron

  let query = supabase
    .from("quotations")
    .select("id,number,status,total,issue_date,expiry_date,created_at,contact:contacts!inner(id,company_name),author:profiles!quotations_created_by_fkey(full_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (QUOTATION_STATUSES.some((s) => s.value === searchParams.status)) query = query.eq("status", searchParams.status!);
  const q = searchParams.q ? sanitizeSearch(searchParams.q) : "";
  if (q) query = /^PX/i.test(q) ? query.ilike("number", `%${q}%`) : query.ilike("contact.company_name", `%${q}%`);

  const [{ data, error }, { count: awaiting }] = await Promise.all([
    query,
    supabase.from("quotations").select("id", { count: "exact", head: true }).eq("status", "pending_approval"),
  ]);
  type Row = { id: string; number: string; status: string; total: number; issue_date: string; expiry_date: string; contact: { id: string; company_name: string }; author: { full_name: string } | null };
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <PageHeader
        title="Quotations"
        description="Draft → manager approval → send → accepted / rejected. Expired quotations are flagged automatically."
        actions={<Link href="/quotations/new"><Button><Plus className="h-4 w-4" /> New quotation</Button></Link>}
      />
      {profile.role !== "sales_executive" && (awaiting ?? 0) > 0 && (
        <div className="mb-4"><Alert kind="warn">
          {awaiting} quotation(s) are waiting for your approval. <Link href="/quotations?status=pending_approval" className="font-medium underline">Review now</Link>
        </Alert></div>
      )}
      <Card className="mb-4 p-4">
        <form method="get" className="flex flex-wrap gap-3">
          <Input name="q" placeholder="Company or PX number" defaultValue={searchParams.q} className="w-64" />
          <Select name="status" defaultValue={searchParams.status ?? ""} className="w-52">
            <option value="">All statuses</option>
            {QUOTATION_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
          <Button type="submit">Filter</Button>
        </form>
      </Card>
      {error && <Alert kind="error">{error.message}</Alert>}
      {!error && rows.length === 0 ? (
        <EmptyState title="No quotations found">Create one from a lead page or with “New quotation”.</EmptyState>
      ) : (
        <Card className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Number</th><th>Company</th><th className="text-right">Total</th><th>Status</th><th>Issued</th><th>Valid until</th><th>Created by</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/quotations/${r.id}`} className="font-medium text-brand-600 hover:underline">{r.number}</Link></td>
                  <td><Link href={`/leads/${r.contact.id}`} className="hover:text-brand-600">{r.contact.company_name}</Link></td>
                  <td className="text-right tabular-nums">{formatLKR(r.total)}</td>
                  <td><Badge className={quotationColor(r.status)}>{quotationLabel(r.status)}</Badge></td>
                  <td className="whitespace-nowrap">{formatDate(r.issue_date)}</td>
                  <td className="whitespace-nowrap">{formatDate(r.expiry_date)}</td>
                  <td>{r.author?.full_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
