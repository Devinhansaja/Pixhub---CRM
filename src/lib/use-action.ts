"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Result = { ok: true; message?: string } | { ok: false; error: string };

/** Runs a server action, shows its error/success and refreshes server data on success. */
export function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = (fn: () => Promise<Result>, onOk?: () => void) =>
    start(async () => {
      setError(null);
      setMessage(null);
      try {
        const r = await fn();
        if (r.ok) {
          if (r.message) setMessage(r.message);
          onOk?.();
          router.refresh();
        } else setError(r.error);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    });

  return { run, pending, error, message };
}
