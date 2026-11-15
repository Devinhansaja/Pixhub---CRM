import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { nextStatus } from "@/lib/email-core";
import { verifySvix } from "@/lib/email-signature";

// Resend webhook: delivery, opens, bounces, spam complaints. Signed with Svix (RESEND_WEBHOOK_SECRET).
export const dynamic = "force-dynamic";

const MAP: Record<string, string> = {
  "email.sent": "sent", "email.delivered": "delivered", "email.opened": "opened",
  "email.bounced": "bounced", "email.complained": "complained",
};

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const ok = verifySvix(raw, {
    id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature"),
  }, process.env.RESEND_WEBHOOK_SECRET ?? "");
  if (!ok) return new NextResponse("Invalid signature", { status: 401 });

  let evt: { type?: string; data?: { email_id?: string; bounce?: { message?: string } } };
  try { evt = JSON.parse(raw); } catch { return new NextResponse("Bad JSON", { status: 400 }); }
  const status = evt.type ? MAP[evt.type] : undefined;
  const providerId = evt.data?.email_id;
  if (!status || !providerId) return NextResponse.json({ ignored: true });

  const db = createAdminClient();
  const { data: msg } = await db.from("email_messages").select("id,status,campaign_id,contact_id").eq("provider_id", providerId).maybeSingle();
  if (!msg) return NextResponse.json({ ignored: "unknown email" });
  const to = nextStatus(msg.status, status);
  if (to) {
    await db.from("email_messages").update({ status: to, ...(to === "bounced" ? { error: evt.data?.bounce?.message?.slice(0, 500) ?? "Bounced" } : {}) }).eq("id", msg.id);
    if (to === "complained") {
      const { data: c } = await db.from("email_campaigns").select("created_by,name").eq("id", msg.campaign_id).maybeSingle();
      if (c?.created_by) await db.from("notifications").insert({ user_id: c.created_by, kind: "campaign", send_email: true,
        title: `Spam complaint in “${c.name}”`, body: "A recipient marked your email as spam. They have been set to do-not-contact.", link: `/leads/${msg.contact_id}` });
    }
  }
  return NextResponse.json({ ok: true });
}
