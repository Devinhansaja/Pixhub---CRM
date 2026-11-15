import { createClient, requireProfile } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { QuoteBuilder, type Service } from "../builder";

const colomboDate = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Colombo" });

export default async function NewQuotationPage({ searchParams }: { searchParams: { contact?: string; deal?: string } }) {
  await requireProfile();
  const supabase = createClient();
  const contactId = /^[0-9a-f-]{36}$/i.test(searchParams.contact ?? "") ? searchParams.contact! : null;
  const [{ data: services }, { data: contact }, { data: settings }, { data: qSettings }] = await Promise.all([
    supabase.from("services").select("id,name,description,base_price").eq("is_active", true).order("sort_order"),
    contactId ? supabase.from("contacts").select("id,company_name,city").eq("id", contactId).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("system_settings").select("value").eq("key", "company").maybeSingle(),
    supabase.from("system_settings").select("value").eq("key", "quotation").maybeSingle(),
  ]);
  const defaultNotes = (qSettings?.value as { default_notes?: string } | null)?.default_notes ?? null;
  const defaultTax = Number((settings?.value as { default_tax_rate?: number } | null)?.default_tax_rate ?? 0);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="New quotation" description="Saved as a draft. Submit it for manager approval before sending to the customer." />
      <QuoteBuilder
        services={(services ?? []) as Service[]}
        defaultTax={defaultTax}
        initial={{
          contact: contact ?? null,
          deal_id: /^[0-9a-f-]{36}$/i.test(searchParams.deal ?? "") ? searchParams.deal! : null,
          issue_date: colomboDate(), expiry_date: colomboDate(30),
          discount_amount: 0, tax_rate: null, notes: defaultNotes, items: [],
        }}
      />
    </div>
  );
}
