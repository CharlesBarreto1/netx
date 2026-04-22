'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/cn';
import { clearSession, displayName, type Session } from '@/lib/session';

export interface NavItem {
  href: Route;
  label: string;
  icon?: React.ReactNode;
  permission?: string;
  badge?: React.ReactNode;
}

const nav: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <IconDashboard /> },
  { href: '/deals', label: 'Vendas', icon: <IconKanban />, permission: 'deals.read' },
  { href: '/customers', label: 'Clientes', icon: <IconUsers />, permission: 'customers.read' },
  { href: '/crm/tags', label: 'Tags', icon: <IconTag />, permission: 'customers.tags.manage' },
];

export function AppShell({
  session,
  children,
}: {
  session: Session;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false); // mobile sidebar

  // Fecha o sidebar mobile ao navegar.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const allowed = nav.filter(
    (n) => !n.permission || session.user.permissions.includes(n.permission),
  );

  function logout() {
    clearSession();
    router.replace('/login');
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 md:hidden dark:text-slate-300 dark:hover:bg-slate-800"
          aria-label="Abrir menu"
        >
          <IconMenu />
        </button>

        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-base font-bold tracking-tight"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-brand-600 text-white">
            N
          </span>
          NetX
        </Link>

        <span className="ml-2 hidden truncate text-xs text-slate-500 md:inline dark:text-slate-400">
          {session.tenant.name}
        </span>

        <div className="ml-auto flex items-center gap-3">
          <UserMenu session={session} onLogout={logout} />
        </div>
      </header>

      <div className="flex">
        {/* Sidebar desktop */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 border-r border-slate-200 bg-white md:block dark:border-slate-700 dark:bg-slate-900">
          <SidebarNav items={allowed} pathname={pathname} />
        </aside>

        {/* Sidebar mobile (drawer) */}
        {open && (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              aria-label="Fechar menu"
              className="absolute inset-0 bg-slate-900/60"
              onClick={() => setOpen(false)}
            />
            <aside className="relative z-10 h-full w-64 bg-white shadow-xl dark:bg-slate-900">
              <div className="flex h-14 items-center justify-between px-4 border-b border-slate-200 dark:border-slate-700">
                <span className="font-bold">NetX</span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="Fechar"
                >
                  ×
                </button>
              </div>
              <SidebarNav items={allowed} pathname={pathname} />
            </aside>
          </div>
        )}

        <main className="min-h-[calc(100vh-3.5rem)] flex-1">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8">{children}</div>
        </main>
      </div>

      <Toaster />
    </div>
  );
}

function SidebarNav({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <nav className="flex flex-col gap-0.5 p-3">
      {items.map((it) => {
        const active = pathname === it.href || pathname.startsWith(it.href + '/');
        return (
          <Link
            key={it.href}
            href={it.href}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            {it.icon && <span className="h-4 w-4 shrink-0">{it.icon}</span>}
            <span className="truncate">{it.label}</span>
            {it.badge !== undefined && (
              <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">{it.badge}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function UserMenu({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const name = displayName(session.user) || session.user.email;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('[data-usermenu]')) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative" data-usermenu>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-500/20 dark:text-brand-100">
          {(name[0] ?? '?').toUpperCase()}
        </span>
        <span className="hidden text-left md:block">
          <span className="block text-sm font-medium leading-tight">{name}</span>
          <span className="block text-[11px] text-slate-500 dark:text-slate-400">
            {session.user.email}
          </span>
        </span>
        <IconChevron />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
            Tenant: <strong className="text-slate-700 dark:text-slate-200">{session.tenant.slug}</strong>
          </div>
          <div className="px-3 py-1 text-xs text-slate-500 dark:text-slate-400">
            Papéis: {session.user.roles.join(', ') || '—'}
          </div>
          <div className="my-1 h-px bg-slate-200 dark:bg-slate-700" />
          <button
            type="button"
            onClick={onLogout}
            className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            Sair
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------- ícones inline (sem dependências) ---------- */

function IconDashboard() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
      <rect x="3" y="3" width="7" height="9" />
      <rect x="14" y="3" width="7" height="5" />
      <rect x="14" y="12" width="7" height="9" />
      <rect x="3" y="16" width="7" height="5" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconKanban() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
      <rect x="3" y="3" width="6" height="14" rx="1" />
      <rect x="11" y="3" width="6" height="9" rx="1" />
      <rect x="19" y="3" width="2" height="5" rx="1" />
    </svg>
  );
}

function IconTag() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-full w-full">
      <path d="M20.59 13.41 13.41 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <circle cx="7" cy="7" r="1.5" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="hidden h-4 w-4 md:block">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
