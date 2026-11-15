import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, Pencil } from "lucide-react";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { Alert, Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui";
import { quotationColor, quotationLabel } from "@/lib/constants";
import { formatDate, formatLKR } from "@/lib/utils";
import { QuotationActions } from "./quotation-actions";

export default async function QuotationPage({ params }: { params: { id: string } }) {
  const me = await requireProfile();
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const supabase = createClient();
  const { data: q } = await supabase
    .from("quotations")
    .select("*, contact:contacts(id,company_name,contact_person,city,district,address,email,mobile), deal:deals(id,title), author:profiles!quotations_created_by_fkey(full_name), approver:profiles!quotations_approved_by_fkey(full_name)")
    .eq("id", params.id)
    .maybeSingle();
  if (!q) notFound();
  const { data: items } = await supabase.from("quotation_items").select("id,description,quantity,unit_price,discount_pct,line_total").eq("quotation_id", q.id).order("sort_order");

  const isManager = me.role !== "sales_executive";
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/quotations" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600"><ArrowLeft className="h-4 w-4" /> Quotations</Link>
      <PageHeader
        title={q.number}
        description={`${q.contact?.company_name} · created by ${q.author?.full_name ?? "—"}`}
        actions={
          <>
            {q.status === "draft" && <Link href={`/quotations/${q.id}/edit`}><Button variant="outline"><Pencil className="h-4 w-4" /> Edit</Button></Link>}
            <a href={`/quotations/${q.id}/pdf`} target="_blank" rel="noopener noreferrer"><Button variant="outline"><Download className="h-4 w-4" /> PDF</Button></a>
          </>
        }
      />
      {q.status === "draft" && q.review_note && <div className="mb-4"><Alert kind="warn"><strong>Changes requested:</strong> {q.review_note}</Alert></div>}
      {q.status === "draft" && !q.approved_at && <div className="mb-4"><Alert kind="info">The PDF is marked <strong>DRAFT</strong> until a manager approves this quotation.</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="overflow-x-auto">
            <CardHeader title="Items" />
            <table className="table-base">
              <thead><tr><th>Description</th><th className="text-right">Qty</th><th className="text-right">Unit price</th><th className="text-right">Disc.</th><th className="text-right">Total</th></tr></thead>
              <tbody>
                {(items ?? []).map((i) => (
                  <tr key={i.id}>
                    <td>{i.description}</td>
                    <td className="text-right tabular-nums">{Number(i.quantity)}</td>
                    <td className="text-right tabular-nums">{formatLKR(i.unit_price)}</td>
                    <td className="text-right tabular-nums">{Number(i.discount_pct) ? `${Number(i.discount_pct)}%` : "—"}</td>
                    <td className="text-right tabular-nums">{formatLKR(i.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ml-auto max-w-xs space-y-1.5 p-5 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{formatLKR(q.subtotal)}</span></div>
              {Number(q.discount_amount) > 0 && <div className="flex justify-between"><span>Discount</span><span className="tabular-nums">− {formatLKR(q.discount_amount)}</span></div>}
              {Number(q.tax_rate) > 0 && <div className="flex justify-between"><span>Tax ({Number(q.tax_rate)}%)</span><span className="tabular-nums">{formatLKR(q.tax_amount)}</span></div>}
              <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold dark:border-slate-700"><span>Total</span><span className="tabular-nums">{formatLKR(q.total)}</span></div>
            </div>
          </Card>
          {q.notes && <Card className="p-5 text-sm"><h3 className="mb-2 font-semibold">Notes / terms</h3><p className="whitespace-pre-wrap text-slate-600 dark:text-slate-400">{q.notes}</p></Card>}
        </div>

        <div className="space-y-6">
          <Card className="space-y-3 p-5 text-sm">
            <div className="flex items-center justify-between"><span className="text-slate-500">Status</span><Badge className={quotationColor(q.status)}>{quotationLabel(q.status)}</Badge></div>
            <div className="flex justify-between"><span className="text-slate-500">Issued</span><span>{formatDate(q.issue_date)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Valid until</span><span>{formatDate(q.expiry_date)}</span></div>
            {q.approved_at && <div className="flex justify-between"><span className="text-slate-500">Approved</span><span>{q.approver?.full_name} · {formatDate(q.approved_at)}</span></div>}
            {q.sent_at && <div className="flex justify-between"><span className="text-slate-500">Sent</span><span>{formatDate(q.sent_at)}</span></div>}
            {q.deal && <div className="flex justify-between"><span className="text-slate-500">Deal</span><span>{q.deal.title}</span></div>}
            <div className="flex justify-between"><span className="text-slate-500">Customer</span><Link href={`/leads/${q.contact?.id}`} className="text-brand-600 hover:underline">{q.contact?.company_name}</Link></div>
          </Card>
          <QuotationActions id={q.id} status={q.status} isManager={isManager} />
        </div>
      </div>
    </div>
  );
}
