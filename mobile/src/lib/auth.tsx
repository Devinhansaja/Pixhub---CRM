import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "./supabase";

export type Role = "admin" | "sales_manager" | "sales_executive";
export interface Profile { id: string; email: string; full_name: string; phone: string | null; role: Role; is_active: boolean }

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  error: string | null;
  isManager: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  reloadProfile: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); return; }
    const { data, error: e } = await supabase.from("profiles").select("id,email,full_name,phone,role,is_active").eq("id", s.user.id).maybeSingle();
    if (e) { setError(e.message); return; }
    if (!data || !data.is_active) {
      setError(!data ? "No CRM profile found for this account." : "Your account is inactive. Contact an administrator.");
      await supabase.auth.signOut();
      setProfile(null);
      return;
    }
    setError(null);
    setProfile(data as Profile);
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await loadProfile(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") loadProfile(s);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const value = useMemo<AuthState>(() => ({
    loading, session, profile, error,
    isAdmin: profile?.role === "admin",
    isManager: profile?.role === "admin" || profile?.role === "sales_manager",
    signIn: async (email, password) => {
      setError(null);
      const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (e) return e.message === "Invalid login credentials" ? "Wrong email or password." : e.message;
      return null;
    },
    signOut: async () => { await supabase.auth.signOut(); setProfile(null); },
    reloadProfile: () => loadProfile(session),
  }), [loading, session, profile, error, loadProfile]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
