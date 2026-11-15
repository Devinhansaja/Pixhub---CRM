"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Card, Textarea } from "@/components/ui";
import {
  approveCampaign, backToDraft, cancelCampaign, deleteCampaign, pauseCampaign, requestChanges,
  resumeCampaign, sendTestEmail, startCampaign, submitCampaign,
} from "../actions";

type R = { ok: true; message?: string } | { ok: false; error: string };

export function CampaignActions({ id, status, canApprove, isCreator, isAdmin }: { id: string; status: string; canApprove: boolean; isCreator: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [note, setNote] = useState("");

  const run = (fn: () => Promise<R>, confirmText?: string, after?: () => void) => {
    if (confirmText && !confirm(confirmText)) return;
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? (r.message ? { kind: "success", text: r.message } : null) : { kind: "error", text: r.error });
      if (r.ok) { after?.(); router.refresh(); }
    });
  };

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap gap-2">
        {status === "draft" && <Button size="sm" disabled={pending} onClick={() => run(() => submitCampaign(id))}>Submit for approval</Button>}
        {status === "draft" && isAdmin && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => approveCampaign(id), "Approve this campaign yourself?")}>Approve (admin)</Button>}
        {status === "pending_approval" && canApprove && <Button size="sm" disabled={pending} onClick={() => run(() => approveCampaign(id))}>Approve</Button>}
        {status === "pending_approval" && !canApprove && <span className="text-sm text-slate-500">Waiting for an admin or another manager to approve.</span>}
        {status === "approved" && <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={pending} onClick={() => run(() => startCampaign(id), "Start sending this campaign now? Emails go out at the pace you set.")}>Start sending</Button>}
        {status === "sending" && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => pauseCampaign(id))}>Pause</Button>}
        {status === "paused" && <Button size="sm" disabled={pending} onClick={() => run(() => resumeCampaign(id))}>Resume</Button>}
        {["draft", "pending_approval", "approved", "sending", "paused"].includes(status) && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => sendTestEmail(id))}>Send me a test</Button>
        )}
        {(status === "approved" || status === "pending_approval") && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => backToDraft(id))}>Back to draft (edit)</Button>}
        {["sending", "paused", "approved"].includes(status) && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelCampaign(id), "Cancel this campaign? Emails not yet sent will not be sent.")}>Cancel campaign</Button>}
        {status === "draft" && (isCreator || isAdmin) && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deleteCampaign(id), "Delete this draft?", () => router.push("/campaigns"))}>Delete draft</Button>}
      </div>
      {status === "pending_approval" && canApprove && (
        <div className="flex gap-2">
          <Textarea rows={2} placeholder="What should change? (sends it back to draft)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          <Button size="sm" variant="outline" disabled={pending || !note.trim()} onClick={() => run(() => requestChanges(id, note), undefined, () => setNote(""))}>Request changes</Button>
        </div>
      )}
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
    </Card>
  );
}
