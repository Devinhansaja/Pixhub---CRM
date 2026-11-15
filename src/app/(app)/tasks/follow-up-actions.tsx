"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { useAction } from "@/lib/use-action";
import { toColomboInput } from "@/lib/utils";
import { rescheduleFollowUp, setFollowUpStatus } from "../leads/actions";

export function FollowUpActions({ id, due }: { id: string; due: string }) {
  const { run, pending, error } = useAction();
  const tomorrow = () => {
    const base = Math.max(Date.now(), new Date(due).getTime());
    return toColomboInput(new Date(base + 86400000));
  };
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button title="Mark done" disabled={pending} onClick={() => run(() => setFollowUpStatus(id, "done"))} className="rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950"><CheckCircle2 className="h-4 w-4" /></button>
      <button title="Reschedule +1 day" disabled={pending} onClick={() => run(() => rescheduleFollowUp(id, tomorrow()))} className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">+1d</button>
      <button title="Cancel" disabled={pending} onClick={() => run(() => setFollowUpStatus(id, "cancelled"))} className="rounded p-1 text-slate-400 hover:text-rose-600"><XCircle className="h-4 w-4" /></button>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}
