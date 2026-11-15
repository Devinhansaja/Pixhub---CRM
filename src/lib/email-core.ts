// Pure helpers for email campaigns (no network, no framework imports — unit tested).

export interface MergeVars {
  company: string;
  contact_person?: string | null;
  services?: string[];
  city?: string | null;
  sender?: string | null;
}

/** Fills {{company}} {{contact_person}} {{services}} {{city}} {{sender}}; unknown tags are left visible so review catches them. */
export function fillTemplate(text: string, v: MergeVars): string {
  const map: Record<string, string> = {
    company: v.company,
    contact_person: v.contact_person?.trim() || "Sir/Madam",
    services: v.services && v.services.length ? v.services.slice(0, 2).join(" and ") : "digital solutions",
    city: v.city?.trim() || "your area",
    sender: v.sender?.trim() || "the PIXhub team",
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key: string) => (key in map ? map[key] : m));
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Plain-text body → simple, readable HTML with a compliant footer and unsubscribe link. */
export function toHtml(body: string, footer: string, unsubscribeUrl: string): string {
  const paras = body.trim().split(/\n{2,}/).map((p) =>
    `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0052CC">$1</a>')}</p>`).join("");
  return `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff">
<div style="max-width:560px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1e293b">${paras}
<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 12px">
<p style="margin:0;font-size:12px;color:#64748b">${esc(footer)}<br>Don't want these emails? <a href="${esc(unsubscribeUrl)}" style="color:#64748b">Unsubscribe</a>.</p>
</div></body></html>`;
}

export function toText(body: string, footer: string, unsubscribeUrl: string): string {
  return `${body.trim()}\n\n--\n${footer}\nUnsubscribe: ${unsubscribeUrl}`;
}

/** Random pause between two emails, in ms, between min and max minutes (the campaign's "breaks"). */
export function nextGapMs(minMinutes: number, maxMinutes: number, rand: () => number = Math.random): number {
  const lo = Math.max(1, minMinutes), hi = Math.max(lo, maxMinutes);
  return Math.round((lo + (hi - lo) * rand()) * 60_000);
}

/** Colombo wall-clock parts (Sri Lanka is UTC+05:30 all year). */
export function colomboParts(d: Date) {
  const t = new Date(d.getTime() + 330 * 60_000);
  const dow = t.getUTCDay() === 0 ? 7 : t.getUTCDay(); // ISO 1=Mon … 7=Sun
  return { hour: t.getUTCHours(), minute: t.getUTCMinutes(), isoDay: dow, dateKey: t.toISOString().slice(0, 10) };
}

export function inSendWindow(d: Date, startHour: number, endHour: number, days: number[]): boolean {
  const p = colomboParts(d);
  return days.includes(p.isoDay) && p.hour >= startHour && p.hour < endHour;
}

/** Start of "today" in Colombo, as a UTC Date. */
export function colomboDayStart(d: Date): Date {
  return new Date(`${colomboParts(d).dateKey}T00:00:00+05:30`);
}

/** Delivery status may only move forward; bounce/complaint always win. */
const RANK: Record<string, number> = { queued: 0, sending: 1, sent: 2, delivered: 3, opened: 4, replied: 5 };
export function nextStatus(current: string, incoming: string): string | null {
  if (current === incoming) return null;
  if (incoming === "bounced" || incoming === "complained") return ["bounced", "complained"].includes(current) ? null : incoming;
  if (["bounced", "complained", "failed", "skipped", "ai_rejected"].includes(current)) return null;
  return (RANK[incoming] ?? -1) > (RANK[current] ?? -1) ? incoming : null;
}
