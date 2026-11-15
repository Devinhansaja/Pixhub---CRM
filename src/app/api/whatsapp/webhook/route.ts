import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { STOP_WORDS, verifySignature } from "@/lib/whatsapp-cloud";

// Meta webhook for the WhatsApp Business Platform.
// GET: subscription verification. POST: signed delivery statuses and inbound messages.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === token) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

interface WaStatus { id: string; status: string; errors?: { title?: string; message?: string }[] }
interface WaMessage { id: string; from: string; timestamp: string; type: string; text?: { body: string }; button?: { text: string }; interactive?: { button_reply?: { title: string }; list_reply?: { title: string } } }
interface WaPayload { entry?: { changes?: { value?: { statuses?: WaStatus[]; messages?: WaMessage[] } }[] }[] }

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !verifySignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }
  let payload: WaPayload;
  try { payload = JSON.parse(raw); } catch { return new NextResponse("Bad JSON", { status: 400 }); }

  const db = createAdminClient(); // no user session here; signature proves the sender is Meta
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};

      for (const s of value.statuses ?? []) {
        if (!["sent", "delivered", "read", "failed"].includes(s.status)) continue;
        await db.rpc("apply_whatsapp_status", { p_external_id: s.id, p_status: s.status, p_error: s.errors?.[0]?.title ?? s.errors?.[0]?.message ?? null });
      }

      for (const m of value.messages ?? []) {
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? `[${m.type} message]`;
        const { data: contacts } = await db.from("contacts").select("id,company_name,assigned_to").eq("mobile", `+${m.from}`).limit(1);
        const c = contacts?.[0];
        if (!c) continue; // unknown sender: not a CRM lead — nothing stored
        const at = new Date(Number(m.timestamp) * 1000 || Date.now()).toISOString();
        const { error } = await db.from("communication_logs").insert({
          contact_id: c.id, channel: "whatsapp", direction: "inbound", status: "replied", source: "whatsapp_cloud_api",
          body: text.slice(0, 4000), external_id: m.id, created_at: at,
        });
        if (error) continue; // duplicate delivery (unique external_id) or other error — Meta retries are safe

        const optOut = STOP_WORDS.test(text);
        if (optOut) {
          await db.from("contacts").update({ do_not_contact: true, opt_out_reason: "Replied STOP on WhatsApp" }).eq("id", c.id);
        }
        await db.from("deal_activities").insert({ contact_id: c.id, type: "whatsapp", description: optOut ? `Customer opted out on WhatsApp: “${text.slice(0, 200)}”` : `WhatsApp reply: “${text.slice(0, 500)}”` });
        if (c.assigned_to) {
          await db.from("notifications").insert({
            user_id: c.assigned_to, kind: "whatsapp", send_email: !optOut,
            title: optOut ? `${c.company_name} opted out` : `WhatsApp reply from ${c.company_name}`,
            body: text.slice(0, 300), link: `/leads/${c.id}`,
          });
        }
      }
    }
  }
  return NextResponse.json({ ok: true });
}
