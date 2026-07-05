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
  ArrowDownUp,
  ArrowLeftRight,
  Banknote,
  BarChart3,
  BellRing,
  Bot,
  BookOpen,
  Box,
  Boxes,
  Briefcase,
  Building2,
  Cable,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleUser,
  Clock,
  Cpu,
  CreditCard,
  Database,
  DownloadCloud,
  Factory,
  FileCog,
  FileSignature,
  FileText,
  FolderOpen,
  Gauge,
  Cable,
  GitBranch,
  GitMerge,
  Handshake,
  HardHat,
  Headset,
  Home,
  Hourglass,
  KanbanSquare,
  Layers,
  LayoutDashboard,
  ListChecks,
  Lock,
  LogOut,
  Map,
  MapPin,
  Network,
  Newspaper,
  Package,
  Plug,
  Receipt,
  RefreshCw,
  Router,
  ScrollText,
  Search,
  Send,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  Truck,
  Users,
  Wallet,
  Warehouse,
  Waves,
  Wifi,
  Wrench,
  IdCard,
  Fuel,
  Navigation,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { CommandPalette } from '@/components/layout/CommandPalette';
import { NotificationBell } from '@/components/layout/NotificationBell';
import { CopilotRail } from '@/components/layout/CopilotRail';
import { LicenseBanner } from '@/components/layout/LicenseBanner';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Toaster } from '@/components/ui/sonner';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { DensityProvider } from '@/lib/density';
import {
  isBranch,
  upsellMenuGroups,
  visibleMenuGroups,
  type MenuGroup,
  type MenuItem,
  type UpsellModule,
} from '@/lib/menus';
import { authApi } from '@/lib/auth-api';
import { licenseApi } from '@/lib/license-api';
import { clearSession, displayName, type Session } from '@/lib/session';
import { useTenantConfig } from '@/lib/tenant-config';

interface NavItem {
  href: Route;
  label: string;
  icon: ComponentType<{ className?: string }>;
  permission?: string;
}

/** Sub-árvore (cabeçalho aninhado) — nível intermediário entre grupo e folha. */
interface NavBranch {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  children: NavItem[];
}

/** Item dentro de um grupo: folha (link) ou sub-árvore (cabeçalho). */
type NavNode = NavItem | NavBranch;

interface NavGroup {
  key: string;
  label?: string;
  items: NavNode[];
}

function isNavBranch(n: NavNode): n is NavBranch {
  return 'children' in n;
}

/** Achata uma lista de nós em folhas (usado no modo sidebar-colapsada). */
function flattenNav(items: NavNode[]): NavItem[] {
  return items.flatMap((it) => (isNavBranch(it) ? it.children : [it]));
}

/** Rota ativa? Match exato ou prefixo de subrota. */
function isActiveHref(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

/** Catálogo `key` → Lucide icon. Único lugar onde ícones moram. Cobre folhas
 *  E sub-árvores (cabeçalhos aninhados). Sem entrada ⇒ fallback `Activity`. */
const ICON_BY_KEY: Record<string, ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  // CRM
  sales: KanbanSquare,
  customers: Users,
  contracts: FileText,
  // Financeiro
  charges: Wallet,
  payables: Banknote,
  cashRegisters: CreditCard,
  financeFiscal: Receipt, // sub-árvore
  fiscalDocuments: ScrollText,
  fiscalEmit: Send,
  nfcomDocuments: Receipt,
  // Estoque
  stockProducts: Package,
  stockAssets: Boxes,
  stockSuppliers: Factory,
  stockLocations: Warehouse,
  stockPurchases: Receipt,
  stockMovements: ArrowLeftRight,
  stockReport: BarChart3,
  // RH
  hrManagement: Briefcase, // sub-árvore
  hrPortal: CircleUser, // sub-árvore
  hrEmployees: Users,
  hrTimeclock: Clock,
  hrPayroll: Banknote,
  hrPosts: Newspaper,
  hrReports: BarChart3,
  meHome: Home,
  meTimeclock: Clock,
  meEarnings: Wallet,
  meDocuments: FolderOpen,
  meNews: Newspaper,
  // Atendimento
  serviceOrders: Wrench,
  subscriber360: IdCard,
  // Técnico
  techProvisioning: Router, // sub-árvore
  techNetworkPlant: Cable, // sub-árvore
  provisioningPending: Hourglass,
  olts: Server,
  tr069Dashboard: Gauge,
  tr069Devices: Router,
  tr069Alerts: BellRing,
  tr069WifiCoverage: Wifi,
  alarms: BellRing,
  pops: Building2,
  equipment: Wrench,
  opticalEnclosures: Box,
  fiberCables: Cable,
  fiberSplices: GitMerge,
  powerBudget: Gauge,
  otdrEvents: Waves,
  ponTree: Network,
  kmlImport: ArrowDownUp,
  radiusLog: Activity,
  // Mapeamento (Leaflet)
  mappingCustomers: MapPin,
  mappingNetwork: Network,
  mapStudio: Map,
  fibermap: Cable,
  fibermapSettings: SlidersHorizontal,
  mappingBackbone: GitBranch,
  mappingTechnicians: HardHat,
  // Frota
  fleetVehicles: Truck,
  fleetDrivers: IdCard,
  fleetExpenses: Fuel,
  fleetMaintenance: Wrench,
  fleetLive: Navigation,
  // Relatórios
  reports: BookOpen,
  // Configurações (sub-árvores + folhas)
  cfgGeneral: SlidersHorizontal,
  cfgCommercial: Handshake,
  cfgFinance: Banknote,
  cfgFiscal: FileSignature,
  cfgSupport: Headset,
  chatbot: Bot,
  cfgTechnical: Cpu,
  cfgIntegrations: Plug,
  settings: Settings,
  users: Users,
  backups: Database,
  audit: BookOpen,
  plans: Layers,
  tags: Tag,
  brBilling: CreditCard,
  sifenConfig: FileSignature,
  nfcomConfig: FileSignature,
  serviceOrderReasons: ListChecks,
  oltTemplates: FileCog,
  tr069Profiles: SlidersHorizontal,
  hubsoft: RefreshCw,
  hubsoftImport: DownloadCloud,
  // Conta pessoal
  security: ShieldCheck,
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

  // Telas "app-like" (imersivas): ocupam a largura toda; menu fica slim+overlay
  // e o copiloto vira flutuante, pra não espremer o conteúdo. Hoje: Atendimento.
  const isAppScreen = pathname === '/chat' || pathname.startsWith('/chat/');

  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(false);
  // Hover-to-expand: quando colapsada, passar o mouse expande temporariamente
  // (overlay, sem mexer no estado persistido nem empurrar o conteúdo).
  const [hovering, setHovering] = useState(false);
  // Em tela imersiva o menu fica slim (ícones) independente do estado persistido.
  const slim = collapsed || isAppScreen;
  const expanded = !slim || hovering;

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

  // País do tenant — usado pra filtrar grupos exclusivos de país (ex.: fiscal/PY).
  // Hook seguro: useTenantConfig devolve null quando ainda não carregou.
  const tenantConfig = useTenantConfig();
  const tenantCountry = tenantConfig?.tenant?.country ?? null;

  // Entitlement por módulo (licença) pro gating da sidebar. FAIL-OPEN: enquanto
  // não carrega (ou endpoint off), entitledModules é undefined ⇒ mostra tudo.
  const { data: licenseStatus } = useSWR(
    licenseApi.statusPath(),
    () => licenseApi.status(),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const entitledModules = licenseStatus?.entitledModules;

  const allowedGroups = useMemo<NavGroup[]>(() => {
    const toLeaf = (m: { key: string; href: string; labelKey: string; permission?: string }): NavItem => ({
      href: m.href as Route,
      label: tNav(m.labelKey as 'dashboard'),
      icon: ICON_BY_KEY[m.key] ?? Activity,
      permission: m.permission,
    });
    const toNode = (it: MenuItem): NavNode =>
      isBranch(it)
        ? {
            key: it.key,
            label: tNav(it.labelKey as 'dashboard'),
            icon: ICON_BY_KEY[it.key] ?? Activity,
            children: it.children.map(toLeaf),
          }
        : toLeaf(it);
    return visibleMenuGroups(
      session.user.permissions,
      session.user.menuAccess ?? null,
      tenantCountry,
      entitledModules,
    ).map((g: MenuGroup) => ({
      key: g.key,
      label: g.labelKey ? tNav(g.labelKey as 'dashboard') : undefined,
      items: g.items.map(toNode),
    }));
  }, [session.user.permissions, session.user.menuAccess, tenantCountry, entitledModules, tNav]);

  // Módulos licenciáveis NÃO habilitados → upsell "Disponível · ativar" (não
  // somem da nav). Painel único: o que não foi comprado vira oferta in-app.
  const upsell = useMemo<UpsellModule[]>(
    () => upsellMenuGroups(tenantCountry, entitledModules),
    [tenantCountry, entitledModules],
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

          {/* Sino de notificações — à esquerda da busca. Aparece só com não-lidas. */}
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />

            {/* Search trigger (Cmd+K) */}
            <button
              type="button"
              onClick={openPalette}
              className={cn(
                'group hidden h-9 items-center gap-2 rounded-md border border-border bg-surface/60',
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
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover md:hidden"
              aria-label="Buscar"
            >
              <Search className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <LocaleSwitcher />
            <UserMenu session={session} onLogout={logout} />
          </div>
        </header>

        <div className="flex">
          {/* ============ SIDEBAR DESKTOP ============ */}
          <aside
            onMouseEnter={() => {
              if (slim) setHovering(true);
            }}
            onMouseLeave={() => setHovering(false)}
            className={cn(
              'sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 transition-[width] duration-200 md:block',
              slim ? 'w-[60px]' : 'w-60',
            )}
          >
            {/* Painel interno absoluto: quando expande no hover, vira overlay
                opaco com sombra — sobrepõe o conteúdo SEM empurrar (sem reflow). */}
            <div
              className={cn(
                'absolute inset-y-0 left-0 z-20 flex flex-col border-r border-border',
                'transition-[width,background-color,box-shadow] duration-200',
                expanded ? 'w-60' : 'w-[60px]',
                slim && hovering ? 'bg-surface shadow-pop' : 'bg-surface/40',
              )}
            >
              <div className="flex-1 overflow-y-auto overflow-x-hidden">
                <SidebarNav
                  groups={allowedGroups}
                  pathname={pathname}
                  collapsed={!expanded}
                />
                <UpsellSection modules={upsell} collapsed={!expanded} />
              </div>
              <button
                type="button"
                onClick={toggleCollapsed}
                className="absolute bottom-3 right-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-text-subtle transition-colors hover:bg-surface-hover hover:text-text"
                aria-label={collapsed ? 'Fixar menu aberto' : 'Recolher menu'}
                title={collapsed ? 'Fixar menu aberto (⌘\\)' : 'Recolher menu (⌘\\)'}
              >
                {collapsed ? (
                  <ChevronsRight className="h-4 w-4" />
                ) : (
                  <ChevronsLeft className="h-4 w-4" />
                )}
              </button>
            </div>
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
                <UpsellSection modules={upsell} collapsed={false} />
              </aside>
            </div>
          )}

          <main
            className={cn(
              'min-w-0 flex-1',
              // Imersiva: altura travada ao viewport (sem scroll de página — a
              // rolagem vive dentro dos painéis). Demais: cresce normalmente.
              isAppScreen
                ? 'h-[calc(100dvh-3.5rem)] overflow-hidden'
                : 'min-h-[calc(100vh-3.5rem)]',
            )}
          >
            {isAppScreen ? (
              <div className="flex h-full min-h-0 flex-col px-2 py-2 md:px-3">
                <LicenseBanner />
                <div className="min-h-0 flex-1">{children}</div>
              </div>
            ) : (
              <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8">
                <LicenseBanner />
                {children}
              </div>
            )}
            {!isAppScreen && <AppFooter />}
          </main>

          {/* ============ RAIL DIREITO — Copiloto IA "Conselheira" ============ */}
          {/* Em tela imersiva o copiloto flutua (balão por cima), não vira coluna. */}
          <CopilotRail floating={isAppScreen} />
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
  groups: NavGroup[];
  pathname: string;
  collapsed: boolean;
}) {
  // Keys (grupo + sub-árvore) que contêm a rota ativa → auto-expand. Você
  // navegou pra lá, faz sentido ver a árvore aberta até o item. Grupos e
  // sub-árvores dividem o mesmo Set porque suas keys são únicas na árvore toda.
  const activeKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const g of groups) {
      for (const it of g.items) {
        if (isNavBranch(it)) {
          if (it.children.some((c) => isActiveHref(c.href, pathname))) {
            keys.add(g.key);
            keys.add(it.key);
          }
        } else if (isActiveHref(it.href, pathname)) {
          keys.add(g.key);
        }
      }
    }
    return keys;
  }, [groups, pathname]);

  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set<string>());

  // Após mount, hidrata do localStorage + força keys ativas abertas. (Não
  // persiste aqui — só toggle explícito persiste, evita grava-grava por rota.)
  useEffect(() => {
    const stored = loadOpenGroupsFromStorage();
    const next = new Set(stored ?? []);
    for (const k of activeKeys) next.add(k);
    setOpenKeys(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mudou de rota — garante as keys da rota ativa abertas.
  useEffect(() => {
    if (activeKeys.size === 0) return;
    setOpenKeys((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const k of activeKeys) {
        if (!next.has(k)) {
          next.add(k);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeKeys]);

  const toggleKey = (key: string) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistOpenGroups(next);
      return next;
    });
  };

  // Folha (link). `nested` = está dentro de sub-árvore (indenta + sem ícone bg).
  const renderLeaf = (it: NavItem, nested: boolean) => {
    const active = isActiveHref(it.href, pathname);
    const Icon = it.icon;
    const content = (
      <Link
        key={it.href}
        href={it.href}
        className={cn(
          'group relative flex items-center gap-2.5 rounded-md text-sm font-medium transition-colors',
          'compact:py-1.5 cozy:py-2 comfortable:py-2.5 py-2',
          collapsed ? 'justify-center px-0' : nested ? 'pl-3 pr-2.5' : 'px-2.5',
          active
            ? 'bg-accent-muted text-accent-strong dark:text-accent-foreground'
            : 'text-text-muted hover:bg-surface-hover hover:text-text',
        )}
        aria-current={active ? 'page' : undefined}
      >
        {/* Marcador de item ativo — barrinha à esquerda. */}
        {active && !collapsed && (
          <span className="absolute -left-0.5 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
        )}
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="truncate">{it.label}</span>}
      </Link>
    );
    return collapsed ? (
      <SimpleTooltip key={it.href} label={it.label} side="right">
        {content}
      </SimpleTooltip>
    ) : (
      content
    );
  };

  // Sub-árvore (cabeçalho aninhado + filhos). Só no modo expandido — colapsada
  // achata tudo em ícones (sem espaço pra accordion aninhado).
  const renderBranch = (br: NavBranch) => {
    const isOpen = openKeys.has(br.key);
    const hasActive = br.children.some((c) => isActiveHref(c.href, pathname));
    const Icon = br.icon;
    return (
      <div key={br.key}>
        <button
          type="button"
          onClick={() => toggleKey(br.key)}
          aria-expanded={isOpen}
          aria-controls={`navbranch-${br.key}`}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
            hasActive
              ? 'text-text'
              : 'text-text-muted hover:bg-surface-hover hover:text-text',
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate text-left">{br.label}</span>
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 opacity-50 transition-transform',
              isOpen && 'rotate-90',
            )}
          />
        </button>
        {isOpen && (
          <div
            id={`navbranch-${br.key}`}
            className="ml-[1.05rem] mt-0.5 flex flex-col gap-0.5 border-l border-border/70 pl-2"
          >
            {br.children.map((c) => renderLeaf(c, true))}
          </div>
        )}
      </div>
    );
  };

  return (
    <nav className="flex flex-col gap-1 p-2.5">
      {groups.map((g, idx) => {
        const hasLabel = !!g.label;
        const isGroupCollapsible = hasLabel && !collapsed;
        const isOpen = !isGroupCollapsible || openKeys.has(g.key);
        const hasActiveChild = activeKeys.has(g.key);

        // Colapsada: achata tudo em folhas (ícones + tooltip), sem headers.
        const flatLeaves = collapsed ? flattenNav(g.items) : null;

        return (
          <div key={g.key} className={idx === 0 ? '' : 'mt-1'}>
            {/* Header do grupo (clicável quando há label e sidebar não-colapsada) */}
            {hasLabel && !collapsed && (
              <button
                type="button"
                onClick={() => toggleKey(g.key)}
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

            {/* Conteúdo do grupo: folhas + sub-árvores (ou folhas achatadas
                quando colapsado). */}
            {isOpen && (
              <div id={`navgroup-${g.key}`} className="flex flex-col gap-0.5">
                {flatLeaves
                  ? flatLeaves.map((it) => renderLeaf(it, false))
                  : g.items.map((it) =>
                      isNavBranch(it) ? renderBranch(it) : renderLeaf(it, false),
                    )}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Seção "DISPONÍVEL" — módulos licenciáveis ainda não comprados, como upsell
// in-app (painel único: o que não foi comprado vira oferta, não some).
function UpsellSection({
  modules,
  collapsed,
}: {
  modules: UpsellModule[];
  collapsed: boolean;
}) {
  const tNav = useTranslations('nav');
  if (collapsed || modules.length === 0) return null;
  return (
    <div className="mt-2 px-2.5 pb-2">
      <div className="border-t border-border px-1 pb-1 pt-3 text-2xs font-semibold uppercase tracking-wider text-text-subtle">
        {tNav('available')}
      </div>
      <div className="flex flex-col gap-1">
        {modules.map((m) => (
          <button
            key={m.key}
            type="button"
            title={tNav('activate')}
            className="group flex w-full items-center justify-between gap-2 rounded-md border border-dashed border-border-strong/70 px-2.5 py-2 text-left transition-colors hover:border-accent/60"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-surface text-text-subtle">
                <Lock className="h-3 w-3" />
              </span>
              <span className="truncate text-sm font-medium text-text-subtle group-hover:text-text">
                {tNav(m.labelKey as 'dashboard')}
              </span>
            </span>
            <span className="shrink-0 rounded-md bg-accent-muted px-1.5 py-0.5 text-2xs font-semibold text-accent-strong dark:text-accent-foreground">
              {tNav('activate')}
            </span>
          </button>
        ))}
      </div>
    </div>
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
  const tExtras = useTranslations('extras');
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
        aria-label={tExtras('userMenu')}
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
