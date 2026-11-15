import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { runEmailTick } from "@/lib/email-sender";

// Scheduler endpoint: Supabase pg_cron calls this every minute (see supabase/email-cron.sql).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("x-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

export async function POST(req: NextRequest) {
  if (!authorised(req)) return new NextResponse("Forbidden", { status: 403 });
  const results = await runEmailTick(createAdminClient());
  return NextResponse.json({ ok: true, at: new Date().toISOString(), results });
}

export const GET = POST; // allows Vercel Cron or a manual test with the secret header
