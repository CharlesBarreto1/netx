/**
 * AppShell — chrome principal das rotas autenticadas.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 * @provenance Y2hhcmxlc2JhcnJldG8=
 *
 * Refresh v2 (refactor UI completo):
 *   • Sidebar collapsible (clique no logo OU keyboard ⌘\) — persiste em
 *     localStorage. Quando colapsada, mostra só ícones com tooltip.
 *   • Topbar glassmorphism (backdrop-blur, transparência sutil).
 *   • Ícones Lucide (consistência) substituem os SVG inline antigos.
 *   • Cmd+K command palette integrado (CommandPalette).
 *   • DensityProvider envolve o conteúdo — variants compact/cozy/comfortable.
 *   • Footer corporativo + watermark mantidos.
 */
'use client';

import type { Route } from 'next';
import {
  Activity,
  BookOpen,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CreditCard,
  Database,
  FileSignature,
  FileText,
  GitBranch,
  HardHat,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Map,
  MapPin,
  Network,
  Receipt,
  ScrollText,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Tag,
  Truck,
  Users,
  Wallet,
  Wrench,
  IdCard,
  Fuel,
  Navigation,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useTranslations } from 'next-intl';

import { CommandPalette } from '@/components/layout/CommandPalette';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Toaster } from '@/components/ui/sonner';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { DensityProvider } from '@/lib/density';
import { visibleMenuGroups, type MenuDef, type MenuGroup } from '@/lib/menus';
import { authApi } from '@/lib/auth-api';
import { clearSession, displayName, type Session } from '@/lib/session';
import { useTenantConfig } from '@/lib/tenant-config';

interface NavItem {
  href: Route;
  label: string;
  icon: ComponentType<{ className?: string }>;
  permission?: string;
}

/** Catálogo `key` → Lucide icon. Único lugar onde ícones moram. */
const ICON_BY_KEY: Record<string, ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  sales: KanbanSquare,
  customers: Users,
  contracts: FileText,
  serviceOrders: Wrench,
  charges: Wallet,
  reports: BookOpen,
  tags: Tag,
  settings: Settings,
  cashRegisters: CreditCard,
  serviceOrderReasons: ListChecks,
  users: Users,
  backups: Database,
  audit: BookOpen,
  security: ShieldCheck,
  pops: Building2,
  equipment: Wrench,
  radiusLog: Activity,
  // Fiscal (SIFEN PY)
  fiscalDocuments: ScrollText,
  fiscalEmit: Send,
  sifenConfig: FileSignature,
  // Mapeamento (Leaflet)
  mappingCustomers: MapPin,
  mappingNetwork: Network,
  mappingBackbone: GitBranch,
  mappingTechnicians: HardHat,
  // Frota
  fleetVehicles: Truck,
  fleetDrivers: IdCard,
  fleetExpenses: Fuel,
  fleetMaintenance: Wrench,
  fleetLive: Navigation,
};

const SIDEBAR_STORAGE_KEY = 'netx.sidebar.collapsed';

export function AppShell({
  session,
  children,
}: {
  session: Session;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const tNav = useTranslations('nav');

  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(false);

  // Hidrata estado de collapse do localStorage (evita flash).
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (v === '1') setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Fecha mobile sidebar ao navegar.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Cmd+\ pra toggle sidebar.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '\\' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleCollapsed();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  interface NavGroup {
    key: string;
    label?: string;
    items: NavItem[];
  }
  // País do tenant — usado pra filtrar grupos exclusivos de país (ex.: fiscal/PY).
  // Hook seguro: useTenantConfig devolve null quando ainda não carregou.
  const tenantConfig = useTenantConfig();
  const tenantCountry = tenantConfig?.tenant?.country ?? null;

  const allowedGroups = useMemo<NavGroup[]>(
    () =>
      visibleMenuGroups(
        session.user.permissions,
        session.user.menuAccess ?? null,
        tenantCountry,
      ).map((g: MenuGroup) => ({
        key: g.key,
        label: g.labelKey ? tNav(g.labelKey as 'dashboard') : undefined,
        items: g.items.map((m: MenuDef) => ({
          href: m.href as Route,
          label: tNav(m.labelKey as 'dashboard'),
          icon: ICON_BY_KEY[m.key] ?? Activity,
          permission: m.permission,
        })),
      })),
    [session.user.permissions, session.user.menuAccess, tenantCountry, tNav],
  );

  async function logout() {
    // Invalida session no backend ANTES de limpar sessão local. Sem isso, o
    // refresh token continua válido até expirar mesmo após "Sair" — atacante
    // de posse do token mantém acesso. authApi.logout() é tolerante a falha,
    // então um backend offline não bloqueia o user.
    await authApi.logout();
    clearSession();
    router.replace('/login');
  }

  function openPalette() {
    window.dispatchEvent(new CustomEvent('netx:open-command-palette'));
  }

  return (
    <DensityProvider>
      <div className="min-h-screen bg-bg text-text">
        {/* ============ TOPBAR (glass) ============ */}
        <header className="glass sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4">
          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover md:hidden"
            aria-label="Abrir menu"
          >
            <MenuIcon />
          </button>

          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-md font-bold tracking-tight text-text"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-foreground shadow-sm">
              N
            </span>
            <span className="hidden sm:inline">NetX</span>
          </Link>

          <span className="ml-2 hidden truncate text-2xs uppercase tracking-wider text-text-subtle md:inline">
            {session.tenant.name}
          </span>

          {/* Search trigger (Cmd+K) */}
          <button
            type="button"
            onClick={openPalette}
            className={cn(
              'group ml-auto hidden h-9 items-center gap-2 rounded-md border border-border bg-surface/60',
              'px-2.5 text-sm text-text-subtle transition-colors hover:bg-surface-hover hover:text-text',
              'md:inline-flex md:w-[280px]',
            )}
            aria-label="Buscar (⌘K)"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">Buscar...</span>
            <span className="flex gap-1">
              <kbd className="kbd">⌘</kbd>
              <kbd className="kbd">K</kbd>
            </span>
          </button>

          <button
            type="button"
            onClick={openPalette}
            className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover md:hidden"
            aria-label="Buscar"
          >
            <Search className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <LocaleSwitcher />
            <UserMenu session={session} onLogout={logout} />
          </div>
        </header>

        <div className="flex">
          {/* ============ SIDEBAR DESKTOP ============ */}
          <aside
            className={cn(
              'sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 border-r border-border bg-surface/40 transition-[width] duration-200 md:block',
              collapsed ? 'w-[60px]' : 'w-60',
            )}
          >
            <SidebarNav
              groups={allowedGroups}
              pathname={pathname}
              collapsed={collapsed}
            />
            <button
              type="button"
              onClick={toggleCollapsed}
              className={cn(
                'absolute bottom-3 right-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-text-subtle transition-colors hover:bg-surface-hover hover:text-text',
              )}
              aria-label={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
            >
              {collapsed ? (
                <ChevronsRight className="h-4 w-4" />
              ) : (
                <ChevronsLeft className="h-4 w-4" />
              )}
            </button>
          </aside>

          {/* ============ SIDEBAR MOBILE (drawer) ============ */}
          {mobileOpen && (
            <div className="fixed inset-0 z-40 md:hidden">
              <button
                type="button"
                aria-label="Fechar menu"
                className="absolute inset-0 animate-fade-in bg-slate-900/60"
                onClick={() => setMobileOpen(false)}
              />
              <aside className="relative z-10 h-full w-64 animate-slide-right bg-surface shadow-lg">
                <div className="flex h-14 items-center justify-between border-b border-border px-4">
                  <span className="font-bold">NetX</span>
                  <button
                    type="button"
                    onClick={() => setMobileOpen(false)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-surface-hover"
                    aria-label="Fechar"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </div>
                <SidebarNav
                  groups={allowedGroups}
                  pathname={pathname}
                  collapsed={false}
                />
              </aside>
            </div>
          )}

          <main className="min-h-[calc(100vh-3.5rem)] flex-1">
            <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8">
              {children}
            </div>
            <AppFooter />
          </main>
        </div>

        <Toaster />
        <CommandPalette />
      </div>
    </DensityProvider>
  );
}

// ---------------------------------------------------------------------------

// localStorage key — persiste estado expand/collapse entre reloads.
// Schema: array de keys de grupos ABERTOS. Default vazio = todos fechados.
const SIDEBAR_OPEN_GROUPS_KEY = 'netx.sidebar.openGroups';

function loadOpenGroupsFromStorage(): Set<string> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SIDEBAR_OPEN_GROUPS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return null;
  }
}

function persistOpenGroups(open: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      SIDEBAR_OPEN_GROUPS_KEY,
      JSON.stringify([...open]),
    );
  } catch {
    /* quota/private — ignora */
  }
}

function SidebarNav({
  groups,
  pathname,
  collapsed,
}: {
  groups: { key: string; label?: string; items: NavItem[] }[];
  pathname: string;
  collapsed: boolean;
}) {
  // Quais grupos estão expandidos. Persiste em localStorage. Auto-expande o
  // grupo que contém a rota ativa (mesmo se o user tinha fechado antes) — é o
  // comportamento esperado: você navegou pra lá, faz sentido ver o grupo.
  const activeGroupKey = useMemo(() => {
    for (const g of groups) {
      if (
        g.items.some(
          (it) => pathname === it.href || pathname.startsWith(it.href + '/'),
        )
      ) {
        return g.key;
      }
    }
    return null;
  }, [groups, pathname]);

  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    // Init no SSR: empty. No client primeiro render: tenta localStorage.
    // Auto-expansão do grupo ativo é aplicada em useEffect abaixo pra
    // garantir hydratação consistente.
    return new Set<string>();
  });

  // Após mount, hidrata do localStorage + força grupo ativo aberto.
  useEffect(() => {
    const stored = loadOpenGroupsFromStorage();
    const next = new Set(stored ?? []);
    if (activeGroupKey) next.add(activeGroupKey);
    setOpenGroups(next);
    // Não persiste aqui — só persiste em toggle explícito do user, evita
    // grava-grava em cada mudança de rota.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mudou de rota — garante que o grupo da rota ativa esteja aberto.
  useEffect(() => {
    if (!activeGroupKey) return;
    setOpenGroups((prev) => {
      if (prev.has(activeGroupKey)) return prev;
      const next = new Set(prev);
      next.add(activeGroupKey);
      return next;
    });
  }, [activeGroupKey]);

  const toggleGroup = (key: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistOpenGroups(next);
      return next;
    });
  };

  return (
    <nav className="flex flex-col gap-1 p-2.5">
      {groups.map((g, idx) => {
        const hasLabel = !!g.label;
        const isCollapsible = hasLabel && !collapsed;
        const isOpen = !isCollapsible || openGroups.has(g.key);
        const hasActiveChild = activeGroupKey === g.key;

        return (
          <div key={g.key} className={idx === 0 ? '' : 'mt-1'}>
            {/* Header do grupo (clicável quando há label e sidebar não-colapsada) */}
            {hasLabel && !collapsed && (
              <button
                type="button"
                onClick={() => toggleGroup(g.key)}
                aria-expanded={isOpen}
                aria-controls={`navgroup-${g.key}`}
                className={cn(
                  'group/header flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-2xs font-semibold uppercase tracking-wider transition-colors',
                  hasActiveChild
                    ? 'text-text'
                    : 'text-text-subtle hover:text-text hover:bg-surface-hover',
                )}
              >
                <span>{g.label}</span>
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 opacity-60 transition-transform" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 opacity-60 transition-transform" />
                )}
              </button>
            )}

            {/* Itens do grupo (sempre visíveis quando sidebar colapsada,
                ou quando o grupo está aberto, ou quando o grupo não tem label) */}
            {isOpen && (
              <div
                id={`navgroup-${g.key}`}
                className="flex flex-col gap-0.5"
              >
                {g.items.map((it) => {
                  const active =
                    pathname === it.href || pathname.startsWith(it.href + '/');
                  const Icon = it.icon;
                  const Content = (
                    <Link
                      key={it.href}
                      href={it.href}
                      className={cn(
                        'group flex items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors',
                        'compact:py-1.5 cozy:py-2 comfortable:py-2.5 py-2',
                        active
                          ? 'bg-accent-muted text-accent-strong dark:text-accent-foreground'
                          : 'text-text-muted hover:bg-surface-hover hover:text-text',
                        collapsed && 'justify-center px-0',
                      )}
                      aria-current={active ? 'page' : undefined}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="truncate">{it.label}</span>}
                    </Link>
                  );
                  return collapsed ? (
                    <SimpleTooltip
                      key={it.href}
                      label={it.label}
                      side="right"
                    >
                      {Content}
                    </SimpleTooltip>
                  ) : (
                    Content
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------

function UserMenu({
  session,
  onLogout,
}: {
  session: Session;
  onLogout: () => void;
}) {
  const tNav = useTranslations('nav');
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
        className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-surface-hover"
        aria-label="Menu do usuário"
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent-muted text-2xs font-semibold text-accent-strong">
          {(name[0] ?? '?').toUpperCase()}
        </span>
        <span className="hidden text-left md:block">
          <span className="block text-xs font-medium leading-tight text-text">{name}</span>
          <span className="block text-2xs text-text-subtle">
            {session.user.email}
          </span>
        </span>
      </button>
      {open && (
        <div className="glass-strong absolute right-0 mt-2 w-64 animate-slide-down overflow-hidden rounded-md border border-border shadow-pop">
          <div className="px-3 py-2 text-2xs uppercase tracking-wider text-text-subtle">
            Operação
          </div>
          <div className="px-3 pb-2 text-sm text-text">{session.tenant.name}</div>
          <div className="px-3 pb-3 text-2xs text-text-subtle">
            Papéis: {session.user.roles.join(', ') || '—'}
          </div>
          <div className="border-t border-border" />
          <Link
            href="/settings/security"
            className="flex items-center gap-2 px-3 py-2 text-sm text-text hover:bg-surface-hover"
            onClick={() => setOpen(false)}
          >
            <ShieldCheck className="h-4 w-4 text-text-subtle" />
            Segurança da conta
          </Link>
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-danger-muted"
          >
            <LogOut className="h-4 w-4" />
            {tNav('logout')}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function AppFooter() {
  return (
    <footer
      className="mx-auto w-full max-w-7xl px-4 pb-6 pt-2 md:px-8"
      data-pv="1"
      data-bl="Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE="
    >
      <div className="border-t border-border pt-3 text-[11px] text-text-subtle">
        <span className="font-medium text-text-muted">NetX</span>
        <span className="mx-1.5">·</span>
        <span>© 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA</span>
        <span className="mx-1.5">·</span>
        <span>CNPJ 57.118.236/0001-44</span>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------

function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="h-5 w-5"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}
