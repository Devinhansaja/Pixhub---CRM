import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Public unsubscribe link from campaign emails.
//   GET  → confirmation page (so link scanners/prefetchers can't unsubscribe people by accident)
//   POST → unsubscribes (also used by Gmail/Yahoo one-click "List-Unsubscribe-Post")
export const dynamic = "force-dynamic";

const page = (title: string, body: string) => new NextResponse(
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:40px 16px;color:#0f172a">
<div style="max-width:440px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px">
<div style="font-weight:700;color:#0A2540;margin-bottom:12px">PIXhub.lk</div>${body}</div></body></html>`,
  { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

const valid = (t: string) => /^[0-9a-f-]{36}$/i.test(t);

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  if (!valid(params.token)) return page("Link not valid", "<p>This unsubscribe link isn't valid.</p>");
  return page("Unsubscribe", `<h1 style="font-size:20px;margin:0 0 8px">Unsubscribe from PIXhub.lk emails?</h1>
<p style="color:#475569">You won't receive any more emails from us.</p>
<form method="post"><button style="background:#0052CC;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:15px;cursor:pointer">Yes, unsubscribe me</button></form>`);
}

export async function POST(_req: NextRequest, { params }: { params: { token: string } }) {
  if (!valid(params.token)) return page("Link not valid", "<p>This unsubscribe link isn't valid.</p>");
  const db = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { error } = await db.rpc("email_unsubscribe", { p_token: params.token });
  if (error) return page("Something went wrong", "<p>Sorry, we couldn't process that. Please reply to our email with “unsubscribe” and we'll remove you.</p>");
  return page("Unsubscribed", `<h1 style="font-size:20px;margin:0 0 8px">You're unsubscribed</h1><p style="color:#475569">You won't receive further emails from PIXhub.lk.</p>`);
}
