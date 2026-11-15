import "server-only";

// Resend (https://resend.com) — transactional/marketing email API. Server-side only.
export const resendConfigured = () => !!process.env.RESEND_API_KEY;

export class ResendError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export interface OutgoingEmail {
  from: string; to: string; subject: string; html: string; text: string;
  replyTo?: string; unsubscribeUrl: string; tags?: { name: string; value: string }[];
}

export async function sendViaResend(e: OutgoingEmail): Promise<string> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: e.from, to: [e.to], subject: e.subject, html: e.html, text: e.text,
      ...(e.replyTo ? { reply_to: e.replyTo } : {}),
      // One-click unsubscribe (RFC 8058) — required by Gmail/Yahoo for bulk senders
      headers: { "List-Unsubscribe": `<${e.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      ...(e.tags ? { tags: e.tags } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (!res.ok || !json.id) throw new ResendError(json.message || `Resend error (HTTP ${res.status})`, res.status);
  return json.id;
}
