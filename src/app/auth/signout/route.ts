import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Clears the session cookies and returns to the login page. Used when a session cookie
// exists but no longer belongs to a valid, active user (deleted, disabled or expired),
// so the browser can't get stuck bouncing between /login and the app.
export async function GET(request: NextRequest) {
  const supabase = createClient();
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  const reason = request.nextUrl.searchParams.get("reason");
  const url = new URL("/login", request.url);
  if (reason === "inactive") url.searchParams.set("error", "inactive");
  return NextResponse.redirect(url);
}
