import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderQuotationPdf } from "@/lib/quotation-pdf";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // RLS limits this to quotations the user can access
  const [{ data: q }, { data: org }] = await Promise.all([
    supabase.from("quotations")
      .select("*, contact:contacts(company_name,contact_person,address,city,district,email,mobile)")
      .eq("id", params.id).maybeSingle(),
    supabase.from("organizations").select("*").limit(1).maybeSingle(),
  ]);
  if (!q) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: items } = await supabase.from("quotation_items")
    .select("description,quantity,unit_price,discount_pct,line_total").eq("quotation_id", q.id).order("sort_order");

  const bytes = await renderQuotationPdf({
    number: q.number, status: q.status, issue_date: q.issue_date, expiry_date: q.expiry_date, notes: q.notes,
    subtotal: Number(q.subtotal), discount_amount: Number(q.discount_amount), tax_rate: Number(q.tax_rate),
    tax_amount: Number(q.tax_amount), total: Number(q.total),
    approved: !!q.approved_at && q.status !== "draft" && q.status !== "pending_approval",
    org: {
      name: org?.name ?? "PIXhub.lk", legal_name: org?.legal_name ?? null, address: org?.address ?? null,
      phone: org?.phone ?? null, email: org?.email ?? null, website: org?.website ?? null, tax_reg_no: org?.tax_reg_no ?? null,
    },
    customer: q.contact,
    items: (items ?? []).map((i) => ({ description: i.description, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount_pct: Number(i.discount_pct), line_total: Number(i.line_total) })),
  });

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${q.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
