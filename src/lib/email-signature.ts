// Server-only: verifies Resend (Svix) webhook signatures.
import { createHmac, timingSafeEqual } from "node:crypto";

/** Verifies a Resend (Svix) webhook signature. secret is "whsec_…" from the Resend dashboard. */
export function verifySvix(rawBody: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, secret: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 300) return false; // 5-minute tolerance (replay protection)
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return signature.split(" ").some((part) => {
    const [ver, sig] = part.split(",");
    if (ver !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

