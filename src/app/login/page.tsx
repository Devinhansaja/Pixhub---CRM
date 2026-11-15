"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { signIn, sendReset, type LoginState } from "./actions";
import { Alert, Button, Input, Label } from "@/components/ui";

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </Button>
  );
}

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [loginState, loginAction] = useFormState<LoginState, FormData>(signIn, {});
  const [resetState, resetAction] = useFormState<LoginState, FormData>(sendReset, {});
  const state = mode === "login" ? loginState : resetState;

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-navy p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-lg font-bold">P</div>
          <span className="text-lg font-semibold">PIXhub Sales CRM</span>
        </div>
        <div>
          <h2 className="text-3xl font-semibold leading-tight">Turn business databases into<br />paying customers.</h2>
          <p className="mt-4 max-w-md text-sm text-slate-300">
            Import contacts, find the right PIXhub service for every business, reach out on WhatsApp and track every deal — in one place.
          </p>
        </div>
        <p className="text-xs text-slate-400">© PIXhub.lk</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-navy text-lg font-bold text-white">P</div>
          </div>
          <h1 className="text-2xl font-semibold">{mode === "login" ? "Sign in" : "Reset password"}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {mode === "login" ? "Use the account your administrator created for you." : "We'll email you a link to set a new password."}
          </p>

          <form action={mode === "login" ? loginAction : resetAction} className="mt-6 space-y-4">
            {searchParams.error === "inactive" && <Alert kind="error">Your account is inactive. Contact an administrator.</Alert>}
            {state.error && <Alert kind="error">{state.error}</Alert>}
            {state.message && <Alert kind="success">{state.message}</Alert>}
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            {mode === "login" && (
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" name="password" type="password" autoComplete="current-password" required />
              </div>
            )}
            <Submit>{mode === "login" ? "Sign in" : "Send reset link"}</Submit>
          </form>
          <button
            type="button"
            onClick={() => setMode(mode === "login" ? "reset" : "login")}
            className="mt-4 text-sm text-brand-600 hover:underline"
          >
            {mode === "login" ? "Forgot password?" : "Back to sign in"}
          </button>
        </div>
      </section>
    </main>
  );
}
