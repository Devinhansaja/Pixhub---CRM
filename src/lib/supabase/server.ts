import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Role } from "@/lib/constants";

// Set SUPABASE_TIMING=1 to log how long each database/auth call takes (for diagnosing slowness).
const timedFetch: typeof fetch = async (input, init) => {
  const t = performance.now();
  const res = await fetch(input, init);
  const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  console.log(`[supabase] ${Math.round(performance.now() - t)}ms ${init?.method ?? "GET"} ${u.pathname}${u.pathname.startsWith("/rest") ? u.search.slice(0, 80) : ""}`);
  return res;
};

export function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(process.env.SUPABASE_TIMING === "1" ? { global: { fetch: timedFetch } } : {}),
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component: middleware refreshes the session instead.
          }
        },
      },
    },
  );
}

/** Service-role client. SERVER ONLY — bypasses RLS; use for admin auth operations only. */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  manager_id: string | null;
  is_active: boolean;
}

/** Current user's profile (cached per request). Redirects to /login if signed out. */
export const requireProfile = cache(async (): Promise<Profile> => {
  const supabase = createClient();
  // The session cookie gives the user id without a network call, so the profile can be
  // fetched at the same time as the auth server verifies the user (one round trip, not two).
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/auth/signout");
  const [{ data: { user } }, { data }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("profiles").select("id,email,full_name,role,manager_id,is_active").eq("id", session.user.id).maybeSingle(),
  ]);
  // Trust only the verified user: the profile must belong to the id the auth server confirmed.
  // A cookie for a deleted/expired user is cleared (otherwise /login would bounce back here).
  if (!user || user.id !== session.user.id) redirect("/auth/signout");
  if (!data || !data.is_active) redirect("/auth/signout?reason=inactive");
  return data as Profile;
});

export async function requireRole(roles: Role[]): Promise<Profile> {
  const p = await requireProfile();
  if (!roles.includes(p.role)) redirect("/dashboard?error=forbidden");
  return p;
}
