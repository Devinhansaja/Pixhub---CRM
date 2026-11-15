// Official WhatsApp Business Platform (Cloud API) client — server-side only.
// Sends approved templates to opted-in contacts and free-text replies inside the
// 24-hour customer-service window. No bulk sending.
import { createHmac, timingSafeEqual } from "node:crypto";

export const WA_HOURLY_LIMIT = Math.max(1, Number(process.env.WHATSAPP_HOURLY_LIMIT || 30));
const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";

export function waConfigured(): boolean {
  return !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export function webhookConfigured(): boolean {
  return !!(process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_VERIFY_TOKEN);
}

/** Validates Meta's X-Hub-Signature-256 header against the raw request body. */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex"), "hex");
  let given: Buffer;
  try { given = Buffer.from(header.slice(7), "hex"); } catch { return false; }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface ParamSource { company: string; contact_person: string | null; city: string | null; services: string[]; sender: string }

/** Fills template body variables {{1}}, {{2}}… from CRM fields, in the order configured for the template. */
export function templateParams(fields: string[], src: ParamSource): string[] {
  const values: Record<string, string> = {
    company: src.company,
    contact_person: src.contact_person?.trim() || "Sir/Madam",
    city: src.city?.trim() || "your area",
    services: src.services.slice(0, 2).join(" and ") || "digital solutions",
    sender: src.sender,
  };
  // Meta rejects parameters with newlines/tabs or more than 4 consecutive spaces
  return fields.map((f) => (values[f] ?? "").replace(/[\n\t]+/g, " ").replace(/ {4,}/g, "   ").slice(0, 200));
}

export class WhatsAppError extends Error {}

async function post(payload: Record<string, unknown>): Promise<string> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
  if (!res.ok || !json.messages?.[0]?.id) {
    throw new WhatsAppError(json.error?.message ? `WhatsApp: ${json.error.message}` : `WhatsApp API error (HTTP ${res.status})`);
  }
  return json.messages[0].id;
}

/** `to` is an E.164 number like +94771234567. Returns the WhatsApp message id (wamid). */
export function sendTemplate(to: string, name: string, language: string, params: string[]) {
  return post({
    to: to.replace(/^\+/, ""),
    type: "template",
    template: {
      name,
      language: { code: language },
      ...(params.length ? { components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] } : {}),
    },
  });
}

export function sendText(to: string, body: string) {
  return post({ to: to.replace(/^\+/, ""), type: "text", text: { preview_url: false, body: body.slice(0, 4096) } });
}

export const STOP_WORDS = /^\s*(stop|unsubscribe|opt[\s-]?out|cancel|remove me|නවත්වන්න|நிறுத்து)\s*[.!]*\s*$/i;
