// Supabase Edge Function (Deno): emails notifications flagged send_email = true.
// Triggered every few minutes by pg_cron (see supabase/cron.sql).
//
// Secrets (supabase secrets set ...):
//   RESEND_API_KEY   – https://resend.com API key (optional; without it nothing is sent)
//   EMAIL_FROM       – e.g. "PIXhub CRM <crm@yourdomain.lk>" (domain must be verified in Resend)
//   APP_URL          – e.g. https://crm.pixhub.lk (links in emails)
//   CRON_SECRET      – shared secret; the caller must send header x-cron-secret
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return new Response("Forbidden", { status: 403 });
  }
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
  if (!apiKey || !from) return Response.json({ sent: 0, note: "RESEND_API_KEY / EMAIL_FROM not configured" });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: rows, error } = await supabase
    .from("notifications")
    .select("id,title,body,link,created_at,user:profiles!notifications_user_id_fkey(email,full_name,is_active)")
    .eq("send_email", true).is("emailed_at", null)
    .gt("created_at", new Date(Date.now() - 2 * 86400000).toISOString()) // never email stale items
    .order("created_at").limit(100);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let sent = 0;
  const failed: string[] = [];
  for (const n of rows ?? []) {
    const user = n.user as unknown as { email: string; full_name: string; is_active: boolean } | null;
    if (!user?.email || !user.is_active) { await supabase.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", n.id); continue; }
    const link = n.link ? `${appUrl}${n.link}` : appUrl;
    const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:auto;padding:24px;color:#0f172a">
      <div style="font-weight:700;color:#0A2540;font-size:16px;margin-bottom:16px">PIXhub Sales CRM</div>
      <p style="font-size:15px;font-weight:600;margin:0 0 6px">${esc(n.title)}</p>
      ${n.body ? `<p style="font-size:14px;color:#475569;margin:0 0 18px">${esc(n.body)}</p>` : ""}
      <a href="${esc(link)}" style="display:inline-block;background:#0052CC;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px">Open in CRM</a>
      <p style="font-size:12px;color:#94a3b8;margin-top:24px">You receive this because you are a PIXhub CRM user.</p></div>`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [user.email], subject: n.title, html }),
    });
    if (res.ok) {
      sent++;
      await supabase.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", n.id);
    } else {
      failed.push(`${n.id}: ${res.status}`);
    }
  }
  return Response.json({ sent, failed });
});
