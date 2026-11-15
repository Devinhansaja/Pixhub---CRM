"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert, Button, Card, Textarea } from "@/components/ui";
import { useAction } from "@/lib/use-action";
import {
  approveQuotation, deleteQuotation, duplicateQuotation, markAccepted, markRejected, markSent,
  requestChanges, submitForApproval, withdrawQuotation,
} from "../actions";

export function QuotationActions({ id, status, isManager }: { id: string; status: string; isManager: boolean }) {
  const router = useRouter();
  const { run, pending, error } = useAction();
  const [note, setNote] = useState("");
  const [busy, start] = useTransition();
  const [dupError, setDupError] = useState<string | null>(null);

  const duplicate = () => start(async () => {
    const r = await duplicateQuotation(id);
    if (r.ok && r.id) router.push(`/quotations/${r.id}/edit`); else if (!r.ok) setDupError(r.error);
  });
  const remove = () => start(async () => {
    if (!confirm("Delete this quotation permanently?")) return;
    const r = await deleteQuotation(id);
    if (r.ok) router.push("/quotations"); else setDupError(r.error);
  });

  const disabled = pending || busy;
  return (
    <Card className="space-y-3 p-5">
      <h3 className="text-sm font-semibold">Actions</h3>
      {status === "draft" && (
        <>
          {isManager ? (
            <Button className="w-full" disabled={disabled} onClick={() => run(() => approveQuotation(id))}>Approve</Button>
          ) : (
            <Button className="w-full" disabled={disabled} onClick={() => run(() => submitForApproval(id))}>Submit for approval</Button>
          )}
        </>
      )}
      {status === "pending_approval" && (
        <>
          {isManager && (
            <>
              <Button className="w-full" disabled={disabled} onClick={() => run(() => approveQuotation(id))}>Approve</Button>
              <Textarea rows={2} placeholder="What should change?" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
              <Button className="w-full" variant="outline" disabled={disabled || !note.trim()} onClick={() => run(() => requestChanges(id, note), () => setNote(""))}>Request changes</Button>
            </>
          )}
          <Button className="w-full" variant="ghost" disabled={disabled} onClick={() => run(() => withdrawQuotation(id))}>Withdraw to draft</Button>
        </>
      )}
      {status === "approved" && (
        <>
          <p className="text-xs text-slate-500">Download the PDF, send it to the customer (email / WhatsApp), then confirm here.</p>
          <Button className="w-full" disabled={disabled} onClick={() => run(() => markSent(id))}>I sent it to the customer</Button>
          <Button className="w-full" variant="ghost" disabled={disabled} onClick={() => run(() => withdrawQuotation(id))}>Back to draft (needs re-approval)</Button>
        </>
      )}
      {(status === "sent" || status === "expired") && (
        <div className="grid grid-cols-2 gap-2">
          <Button disabled={disabled} className="bg-emerald-600 hover:bg-emerald-700" onClick={() => run(() => markAccepted(id))}>Accepted</Button>
          <Button disabled={disabled} variant="outline" onClick={() => run(() => markRejected(id))}>Rejected</Button>
        </div>
      )}
      <Button className="w-full" variant="outline" disabled={disabled} onClick={duplicate}>Duplicate as new draft</Button>
      {isManager && <Button className="w-full" variant="ghost" disabled={disabled} onClick={remove}>Delete</Button>}
      {(error || dupError) && <Alert kind="error">{error ?? dupError}</Alert>}
    </Card>
  );
}
