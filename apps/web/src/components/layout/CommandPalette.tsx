/**
 * CommandPalette — Cmd+K search global e atalhos.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Padrão Linear/Stripe: Cmd+K (Ctrl+K no Windows) abre overlay com:
 *   1. Search global — clientes, contratos, faturas (debounced fetch)
 *   2. Navegação rápida — atalho pra qualquer rota da sidebar
 *   3. Ações — "Novo cliente", "Toggle dark mode", "Density: compact", ...
 *
 * Implementação:
 *   - `cmdk` (já nas deps) — primitivo headless
 *   - Radix Dialog pra overlay (já em uso)
 *   - SWR pra search (sem refetch agressivo)
 *   - Atalhos secundários: Cmd+J abre direto modo "Navegação"
 */
'use client';

import { Command } from 'cmdk';
import {
  ArrowRight,
  FileText,
  Moon,
  Plus,
  Rows2,
  Rows3,
  Rows4,
  Search,
  Server,
  Sun,
  User,
  Users,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import useSWR from 'swr';

import { swrFetcher } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useDensity } from '@/lib/density';
import { visibleMenus } from '@/lib/menus';
import { getSession } from '@/lib/session';

interface ApiCustomer {
  id: string;
  fullName?: string;
  companyName?: string;
  taxId?: string;
}

const HIGHLIGHT_LIMIT = 6;

export function CommandPalette() {
  const t = useTranslations('components.commandPalette');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const session = getSession();

  // Cmd/Ctrl+K abre, ESC fecha (cmdk já cuida do ESC, mas ainda assim).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  // Reseta busca ao fechar pra não persistir entre aberturas.
  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  // Trigger global pra outros componentes (ex.: botão "Buscar" da topbar)
  useEffect(() => {
    function handler() {
      setOpen(true);
    }
    window.addEventListener('netx:open-command-palette', handler);
    return () => window.removeEventListener('netx:open-command-palette', handler);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label={t('dialogLabel')}
    >
      <button
        type="button"
        aria-label={tc('close')}
        className="absolute inset-0 animate-fade-in bg-slate-900/40 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <div className="relative z-10 w-full max-w-xl animate-fade-in-up overflow-hidden rounded-xl border border-border/80 bg-surface-elevated shadow-lg">
        <Command
          label={t('commandLabel')}
          shouldFilter={false /* fazemos filter manual + fetch */}
          className="flex flex-col"
        >
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 text-text-subtle" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder={t('searchPlaceholder')}
              className="flex-1 bg-transparent py-3 text-sm text-text placeholder:text-text-subtle outline-hidden"
              autoFocus
            />
            <kbd className="kbd">ESC</kbd>
          </div>

          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-sm text-text-muted">
              {tc('noResults')}
            </Command.Empty>

            {session && (
              <Suspense fallback={null}>
                <ServerSearch query={search} onSelect={go} />
              </Suspense>
            )}

            {session && (
              <NavGroup
                heading={t('groupNavigation')}
                permissions={session.user.permissions}
                menuAccess={session.user.menuAccess ?? null}
                query={search}
                onSelect={go}
              />
            )}

            <Group heading={t('groupActions')}>
              <Item icon={Plus} label={t('newCustomer')} onSelect={() => go('/customers/new')} />
              <Item icon={Plus} label={t('newContract')} onSelect={() => go('/contracts/new')} />
              <Item icon={User} label={t('mySecurity')} onSelect={() => go('/settings/security')} />
            </Group>

            <DensityGroup onClose={() => setOpen(false)} />
            <ThemeGroup onClose={() => setOpen(false)} />
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ApiContract {
  id: string;
  code?: string | null;
  pppoeUsername?: string | null;
  customer?: { displayName?: string };
}
interface ApiOlt {
  id: string;
  name?: string;
  vendor?: string;
}

const MIN_QUERY = 2;
const SWR_OPTS = { keepPreviousData: true, revalidateOnFocus: false, dedupingInterval: 250 } as const;
const goHint = <ArrowRight className="h-3.5 w-3.5 text-text-subtle" />;

/**
 * Busca server-side (debounce via SWR, >= 2 chars) em clientes, contratos e
 * equipamentos (OLTs) — endpoints que suportam `?search=`. Faturas ficam de
 * fora até o backend expor busca textual em contract-invoices.
 */
function ServerSearch({ query, onSelect }: { query: string; onSelect: (href: string) => void }) {
  const t = useTranslations('components.commandPalette');
  const q = query.trim();
  const on = q.length >= MIN_QUERY;
  const enc = encodeURIComponent(q);

  const { data: cust } = useSWR<{ data: ApiCustomer[] }>(
    on ? `/v1/customers?search=${enc}&pageSize=${HIGHLIGHT_LIMIT}` : null,
    swrFetcher,
    SWR_OPTS,
  );
  const { data: contr } = useSWR<{ data: ApiContract[] }>(
    on ? `/v1/contracts?search=${enc}&pageSize=${HIGHLIGHT_LIMIT}` : null,
    swrFetcher,
    SWR_OPTS,
  );
  const { data: olts } = useSWR<{ data: ApiOlt[] }>(
    on ? `/v1/olts?search=${enc}` : null,
    swrFetcher,
    SWR_OPTS,
  );

  if (!on) return null;
  const customers = cust?.data ?? [];
  const contracts = contr?.data ?? [];
  const oltList = (olts?.data ?? []).slice(0, HIGHLIGHT_LIMIT);

  return (
    <>
      {customers.length > 0 && (
        <Group heading={t('groupCustomers')}>
          {customers.map((c) => (
            <Item
              key={c.id}
              icon={Users}
              label={c.fullName ?? c.companyName ?? t('noName')}
              sub={c.taxId}
              onSelect={() => onSelect(`/customers/${c.id}`)}
              rightHint={goHint}
            />
          ))}
        </Group>
      )}
      {contracts.length > 0 && (
        <Group heading={t('groupContracts')}>
          {contracts.map((c) => (
            <Item
              key={c.id}
              icon={FileText}
              label={c.code ?? c.customer?.displayName ?? t('noName')}
              sub={c.customer?.displayName ?? c.pppoeUsername ?? undefined}
              onSelect={() => onSelect(`/contracts/${c.id}`)}
              rightHint={goHint}
            />
          ))}
        </Group>
      )}
      {oltList.length > 0 && (
        <Group heading={t('groupEquipment')}>
          {oltList.map((o) => (
            <Item
              key={o.id}
              icon={Server}
              label={o.name ?? o.id}
              sub={o.vendor}
              onSelect={() => onSelect(`/olts/${o.id}`)}
              rightHint={goHint}
            />
          ))}
        </Group>
      )}
    </>
  );
}

/**
 * Grupo "Ir para" derivado do menus.ts (RBAC + menuAccess do usuário), filtrado
 * pela busca. Sem query, mostra os primeiros itens; com query, todos os que
 * casam. Substitui a lista de navegação que antes era hardcoded.
 */
function NavGroup({
  heading,
  permissions,
  menuAccess,
  query,
  onSelect,
}: {
  heading: string;
  permissions: string[];
  menuAccess: string[] | null;
  query: string;
  onSelect: (href: string) => void;
}) {
  const tNav = useTranslations('nav');
  const q = query.trim().toLowerCase();
  const items = useMemo(() => {
    const all = visibleMenus(permissions, menuAccess).map((m) => ({
      key: m.key,
      href: m.href,
      label: tNav(m.labelKey as 'dashboard'),
    }));
    const matched = q ? all.filter((m) => m.label.toLowerCase().includes(q)) : all;
    return q ? matched : matched.slice(0, 8);
  }, [permissions, menuAccess, q, tNav]);

  if (items.length === 0) return null;
  return (
    <Group heading={heading}>
      {items.map((m) => (
        <Item key={m.key} icon={ArrowRight} label={m.label} onSelect={() => onSelect(m.href)} />
      ))}
    </Group>
  );
}

// ---------------------------------------------------------------------------

function DensityGroup({ onClose }: { onClose: () => void }) {
  const t = useTranslations('components.commandPalette');
  const { density, setDensity } = useDensity();
  return (
    <Group heading={t('groupDensity')}>
      <Item
        icon={Rows4}
        label={t('densityCompact')}
        sub={t('densityCompactHint')}
        onSelect={() => {
          setDensity('compact');
          onClose();
        }}
        rightHint={density === 'compact' ? <ActiveDot /> : undefined}
      />
      <Item
        icon={Rows3}
        label={t('densityCozy')}
        sub={t('densityCozyHint')}
        onSelect={() => {
          setDensity('cozy');
          onClose();
        }}
        rightHint={density === 'cozy' ? <ActiveDot /> : undefined}
      />
      <Item
        icon={Rows2}
        label={t('densityComfortable')}
        sub={t('densityComfortableHint')}
        onSelect={() => {
          setDensity('comfortable');
          onClose();
        }}
        rightHint={density === 'comfortable' ? <ActiveDot /> : undefined}
      />
    </Group>
  );
}

function ThemeGroup({ onClose }: { onClose: () => void }) {
  const t = useTranslations('components.commandPalette');
  const toggle = useCallback(
    (target: 'light' | 'dark') => {
      const html = document.documentElement;
      html.classList.toggle('dark', target === 'dark');
      html.classList.toggle('light', target === 'light');
      try {
        window.localStorage.setItem('netx.theme', target);
      } catch {
        /* ignore */
      }
      onClose();
    },
    [onClose],
  );
  return (
    <Group heading={t('groupAppearance')}>
      <Item icon={Sun} label={t('themeLight')} onSelect={() => toggle('light')} />
      <Item icon={Moon} label={t('themeDark')} onSelect={() => toggle('dark')} />
    </Group>
  );
}

function ActiveDot() {
  return <span className="h-1.5 w-1.5 rounded-full bg-accent" />;
}

// ---------------------------------------------------------------------------

function Group({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={heading}
      className={cn(
        '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-2',
        '[&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold',
        '[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider',
        '[&_[cmdk-group-heading]]:text-text-subtle',
      )}
    >
      {children}
    </Command.Group>
  );
}

function Item({
  icon: Icon,
  label,
  sub,
  hint,
  rightHint,
  onSelect,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: ReactNode;
  sub?: ReactNode;
  hint?: string; // shortcut tipo "g c"
  rightHint?: ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm',
        'data-[selected=true]:bg-surface-hover data-[selected=true]:text-text',
        'text-text-muted',
      )}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" />}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-text">{label}</span>
        {sub && <span className="truncate text-2xs text-text-subtle">{sub}</span>}
      </div>
      {rightHint ?? (hint && <kbd className="kbd ml-auto">{hint}</kbd>)}
    </Command.Item>
  );
}
