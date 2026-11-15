import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { applyLeadFilters, leadSelect, type LeadFilters } from "@/lib/leads-query";

const MAX_ROWS = 50_000;
const CHUNK = 1000;

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!me || me.role === "sales_executive") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const filters = Object.fromEntries(req.nextUrl.searchParams) as LeadFilters;
  const base =
    "company_name,industry,contact_person,mobile,landline,email,district,city,address,website,facebook_url,stage,lead_score,whatsapp_status,do_not_contact,estimated_value,last_contacted_at,next_follow_up_at,created_at,owner:profiles!contacts_assigned_to_fkey(full_name)";

  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX_ROWS; from += CHUNK) {
    const q = applyLeadFilters(supabase.from("contacts").select(leadSelect(filters, base)), filters, user.id);
    const { data, error } = await q.range(from, from + CHUNK - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      const { owner, svc: _svc, ...rest } = r as { owner?: { full_name: string } | null; svc?: unknown };
      rows.push({ ...rest, assigned_to: owner?.full_name ?? "" });
    }
    if (!data || data.length < CHUNK) break;
  }

  await supabase.rpc("log_audit", { p_action: "EXPORT", p_table: "contacts", p_details: { filters, rows: rows.length } });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="pixhub-leads-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
