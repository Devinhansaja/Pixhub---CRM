import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { TZ } from "./constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const lkr = new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", maximumFractionDigits: 0 });
export const formatLKR = (n: number | string | null | undefined) => lkr.format(Number(n ?? 0));
export const formatNumber = (n: number | null | undefined) => new Intl.NumberFormat("en-LK").format(n ?? 0);

export function formatDate(d: string | Date | null | undefined, withTime = false): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(new Date(d));
}

/** Value for <input type="datetime-local"> expressed in Colombo time. */
export function toColomboInput(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`;
}

/** Parse a datetime-local value entered in Colombo time (UTC+05:30, no DST). */
export function fromColomboInput(v: string): string {
  return new Date(`${v}:00+05:30`).toISOString();
}

/** Strip characters that would break PostgREST `or=` filter syntax. */
export function sanitizeSearch(q: string): string {
  return q.replace(/[,()*%\\:"']/g, " ").trim().slice(0, 80);
}
