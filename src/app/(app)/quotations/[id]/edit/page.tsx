import { notFound, redirect } from "next/navigation";
import { createClient, requireProfile } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { QuoteBuilder, type Service } from "../../builder";

export default async function EditQuotationPage({ params }: { params: { id: string } }) {
  await requireProfile();
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound();
  const supabase = createClient();
  const { data: q } = await supabase.from("quotations").select("*, contact:contacts(id,company_name,city)").eq("id", params.id).maybeSingle();
  if (!q) notFound();
  if (q.status !== "draft") redirect(`/quotations/${q.id}`);
  const [{ data: items }, { data: services }] = await Promise.all([
    supabase.from("quotation_items").select("service_id,description,quantity,unit_price,discount_pct").eq("quotation_id", q.id).order("sort_order"),
    supabase.from("services").select("id,name,description,base_price").eq("is_active", true).order("sort_order"),
  ]);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={`Edit ${q.number}`} />
      <QuoteBuilder
        services={(services ?? []) as Service[]}
        defaultTax={Number(q.tax_rate)}
        initial={{
          id: q.id, contact: q.contact, deal_id: q.deal_id, issue_date: q.issue_date, expiry_date: q.expiry_date,
          discount_amount: Number(q.discount_amount), tax_rate: Number(q.tax_rate), notes: q.notes,
          items: (items ?? []).map((i) => ({ service_id: i.service_id ?? "", description: i.description, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount_pct: Number(i.discount_pct) })),
        }}
      />
    </div>
  );
}
