import "server-only";
import nodemailer from "nodemailer";
import { ResendError, resendConfigured, sendViaResend, type OutgoingEmail } from "@/lib/resend";

/**
 * Picks how campaign emails are sent:
 *  - "smtp": any mailbox (e.g. a Gmail account with an App Password, or info@pixhub.lk later).
 *    Set SMTP_USER + SMTP_PASS (SMTP_HOST/SMTP_PORT default to Gmail).
 *  - "resend": the Resend API (RESEND_API_KEY) — needs a verified domain, gives delivery/bounce tracking.
 * EMAIL_PROVIDER=smtp|resend forces one when both are configured; otherwise SMTP wins.
 */
export type MailProvider = "smtp" | "resend";

const smtpConfigured = () => !!process.env.SMTP_USER && !!process.env.SMTP_PASS;

export function mailProvider(): MailProvider | null {
  const forced = process.env.EMAIL_PROVIDER;
  if (forced === "resend" && resendConfigured()) return "resend";
  if (forced === "smtp" && smtpConfigured()) return "smtp";
  if (smtpConfigured()) return "smtp";
  if (resendConfigured()) return "resend";
  return null;
}

export const mailerConfigured = () => mailProvider() !== null;

const isGmail = () => /gmail\.com$/i.test(process.env.SMTP_HOST || "smtp.gmail.com");

/**
 * Max emails per Colombo day across ALL campaigns (protects the mailbox from being suspended).
 * Gmail allows ~500/day for personal accounts; default stays well under that.
 */
export function providerDailyCap(): number | null {
  const env = Number(process.env.SMTP_DAILY_LIMIT);
  if (mailProvider() !== "smtp") return null;
  if (Number.isFinite(env) && env > 0) return Math.floor(env);
  return isGmail() ? 300 : null;
}

/** Same as ResendError so the scheduler can pause on auth (401) / quota (429) problems. */
export class MailError extends ResendError {}

let transport: nodemailer.Transporter | null = null;
function smtp() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 465);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    });
  }
  return transport;
}

/** Display name from "Name <addr>" (or the whole string). */
function displayName(from: string) {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/);
  return (m ? m[1] : "").trim();
}

export function senderAddress(fallback: string): string {
  return mailProvider() === "smtp" ? (process.env.SMTP_FROM || process.env.SMTP_USER!) : fallback;
}

export async function sendEmail(e: OutgoingEmail): Promise<string> {
  const provider = mailProvider();
  if (provider === "resend") return sendViaResend(e);
  if (provider !== "smtp") throw new MailError("Email sending isn't set up yet.", 500);

  // Mailbox providers only allow sending as the signed-in address, so the From address is the mailbox.
  const address = process.env.SMTP_FROM || process.env.SMTP_USER!;
  const name = displayName(e.from);
  try {
    const info = await smtp().sendMail({
      from: name ? { name, address } : address,
      to: e.to, subject: e.subject, html: e.html, text: e.text,
      replyTo: e.replyTo,
      headers: { "List-Unsubscribe": `<${e.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
    const rejected = (info.rejected ?? []).length;
    if (rejected) throw new MailError(`Recipient rejected: ${e.to}`, 400);
    return String(info.messageId || "smtp");
  } catch (err) {
    if (err instanceof MailError) throw err;
    const x = err as { code?: string; responseCode?: number; message?: string };
    const msg = x.message || "SMTP send failed";
    // EAUTH / 535 = wrong user or app password; 421/454/550 5.4.5 = sending limit reached
    const status = x.code === "EAUTH" || x.responseCode === 535 ? 401
      : x.responseCode === 421 || x.responseCode === 454 || /5\.4\.5|limit/i.test(msg) ? 429
      : x.responseCode && x.responseCode >= 500 ? 400 : 503;
    throw new MailError(msg, status);
  }
}
