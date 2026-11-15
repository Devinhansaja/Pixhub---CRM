"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Users, Upload, Sparkles, KanbanSquare, Mail, CheckSquare,
  FileText, BarChart3, UserCog, Bot, Settings, ChevronsLeft, Menu, Moon, Sun, LogOut, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { roleLabel, type Role } from "@/lib/constants";
import { signOut } from "@/app/login/actions";
import { NotificationBell, type Notification } from "./notification-bell";

const NAV: { href: string; label: string; icon: React.ElementType; roles?: Role[] }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "All Leads", icon: Users },
  { href: "/import", label: "Import Database", icon: Upload, roles: ["admin", "sales_manager"] },
  { href: "/classification", label: "Smart Classification", icon: Sparkles },
  { href: "/pipeline", label: "Sales Pipeline", icon: KanbanSquare },
  // WhatsApp Outreach is hidden (code and history kept); re-add { href: "/whatsapp", … } to bring it back.
  { href: "/campaigns", label: "Email Campaigns", icon: Mail, roles: ["admin", "sales_manager"] },
  { href: "/tasks", label: "Tasks & Follow-ups", icon: CheckSquare },
  { href: "/quotations", label: "Quotations", icon: FileText },
  { href: "/analytics", label: "Analytics & Reports", icon: BarChart3 },
  { href: "/team", label: "Team Management", icon: UserCog, roles: ["admin", "sales_manager"] },
  { href: "/assistant", label: "AI Sales Assistant", icon: Bot },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({ user, notifications, unread, children }: {
  user: { full_name: string; email: string; role: Role }; notifications: Notification[]; unread: number; children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    try { setCollapsed(localStorage.getItem("sidebar") === "collapsed"); } catch {}
  }, []);
  useEffect(() => setMobileOpen(false), [pathname]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch {}
  };
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try { localStorage.setItem("sidebar", !c ? "collapsed" : "open"); } catch {}
      return !c;
    });
  };

  const items = NAV.filter((n) => !n.roles || n.roles.includes(user.role));

  const sidebar = (isMobile: boolean) => (
    <aside
      className={cn(
        "flex h-full flex-col bg-navy text-slate-300 transition-[width] duration-200",
        isMobile ? "w-72" : collapsed ? "w-[68px]" : "w-64",
      )}
    >
      <div className="flex h-16 items-center gap-3 px-4">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-600 font-bold text-white">P</div>
        {(!collapsed || isMobile) && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">PIXhub Sales CRM</p>
            <p className="truncate text-[11px] text-slate-400">PIXhub.lk</p>
          </div>
        )}
        {isMobile && (
          <button className="ml-auto rounded p-1 hover:bg-white/10" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              title={collapsed && !isMobile ? label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active ? "bg-brand-600 text-white" : "hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              {(!collapsed || isMobile) && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>
      {!isMobile && (
        <button
          onClick={toggleCollapsed}
          className="m-3 flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white/5 hover:text-white"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronsLeft className={cn("h-[18px] w-[18px] transition-transform", collapsed && "rotate-180")} />
          {!collapsed && "Collapse"}
        </button>
      )}
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden md:block">{sidebar(false)}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full">{sidebar(true)}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900 md:px-6">
          <button className="rounded p-2 hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell items={notifications} unread={unread} />
            <button onClick={toggleTheme} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Toggle theme">
              {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{user.full_name}</p>
              <p className="text-xs text-slate-500">{roleLabel(user.role)}</p>
            </div>
            <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
              {user.full_name.slice(0, 1).toUpperCase()}
            </div>
            <form action={signOut}>
              <button className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Sign out" title="Sign out">
                <LogOut className="h-5 w-5" />
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
