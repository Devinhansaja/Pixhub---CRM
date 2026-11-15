"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Bell } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { markNotificationsRead } from "@/app/(app)/notification-actions";

export interface Notification { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }

export function NotificationBell({ items, unread }: { items: Notification[]; unread: number }) {
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  // Refresh periodically so new assignments / reminders appear without navigation
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 120_000);
    return () => clearInterval(t);
  }, [router]);

  const read = (ids: string[] | null) => start(async () => { await markNotificationsRead(ids); router.refresh(); });

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={`Notifications (${unread} unread)`}>
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && <button onClick={() => read(null)} className="text-xs text-brand-600 hover:underline">Mark all read</button>}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">You&apos;re all caught up.</li>}
            {items.map((n) => (
              <li key={n.id} className={cn("border-b border-slate-50 last:border-0 dark:border-slate-800", !n.read_at && "bg-brand-50/50 dark:bg-brand-700/10")}>
                <Link href={n.link ?? "#"} onClick={() => { setOpen(false); if (!n.read_at) read([n.id]); }} className="block px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.body}</p>}
                  <p className="mt-1 text-[11px] text-slate-400">{formatDate(n.created_at, true)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
