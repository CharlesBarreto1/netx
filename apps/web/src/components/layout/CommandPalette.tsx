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
  Building2,
  FileText,
  LayoutDashboard,
  Moon,
  Plus,
  Receipt,
  Rows2,
  Rows3,
  Rows4,
  Search,
  Settings,
  Sun,
  User,
  Users,
  Wrench,
} from 'lucide-react';
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
import { getSession } from '@/lib/session';

interface SearchResult {
  id: string;
  type: 'customer' | 'contract' | 'invoice';
  title: string;
  subtitle?: string;
  href: string;
}

interface ApiCustomer {
  id: string;
  fullName?: string;
  companyName?: string;
  taxId?: string;
}

const HIGHLIGHT_LIMIT = 6;

export function CommandPalette() {
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
      router.push(href as never);
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
      aria-label="Comando rápido"
    >
      <button
        type="button"
        aria-label="Fechar"
        className="absolute inset-0 animate-fade-in bg-slate-900/40 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <div className="relative z-10 w-full max-w-xl animate-fade-in-up overflow-hidden rounded-xl border border-border/80 bg-surface-elevated shadow-lg">
        <Command
          label="Comando"
          shouldFilter={false /* fazemos filter manual + fetch */}
          className="flex flex-col"
        >
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 text-text-subtle" />
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Buscar clientes, contratos, faturas — ou digite um comando…"
              className="flex-1 bg-transparent py-3 text-sm text-text placeholder:text-text-subtle outline-hidden"
              autoFocus
            />
            <kbd className="kbd">ESC</kbd>
          </div>

          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-sm text-text-muted">
              Sem resultados.
            </Command.Empty>

            {session && (
              <Suspense fallback={null}>
                <ServerSearch
                  query={search}
                  tenantId={session.tenant.id}
                  onSelect={go}
                />
              </Suspense>
            )}

            <Group heading="Navegação">
              <Item icon={LayoutDashboard} label="Dashboard" hint="g d" onSelect={() => go('/dashboard')} />
              <Item icon={Users} label="Clientes" hint="g c" onSelect={() => go('/customers')} />
              <Item icon={FileText} label="Contratos" hint="g k" onSelect={() => go('/contracts')} />
              <Item icon={Receipt} label="Cobranças" onSelect={() => go('/finance/charges')} />
              <Item icon={Wrench} label="Ordens de serviço" onSelect={() => go('/service-orders')} />
              <Item icon={Building2} label="POPs" onSelect={() => go('/network/pops')} />
              <Item icon={Settings} label="Configurações" onSelect={() => go('/settings/tenant')} />
            </Group>

            <Group heading="Ações">
              <Item icon={Plus} label="Novo cliente" onSelect={() => go('/customers/new')} />
              <Item icon={Plus} label="Novo contrato" onSelect={() => go('/contracts/new')} />
              <Item icon={User} label="Minha segurança" onSelect={() => go('/settings/security')} />
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

interface SearchResponse {
  data: ApiCustomer[];
}

/** Search server-side debounced por SWR — só dispara se query >= 2 chars. */
function ServerSearch({
  query,
  tenantId,
  onSelect,
}: {
  query: string;
  tenantId: string;
  onSelect: (href: string) => void;
}) {
  const trimmed = query.trim();
  const key =
    trimmed.length >= 2
      ? `/v1/customers?search=${encodeURIComponent(trimmed)}&pageSize=${HIGHLIGHT_LIMIT}`
      : null;
  const { data } = useSWR<SearchResponse>(key, swrFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
    dedupingInterval: 250,
  });

  const results: SearchResult[] = useMemo(() => {
    if (!data?.data) return [];
    return data.data.map((c) => ({
      id: c.id,
      type: 'customer',
      title: c.fullName ?? c.companyName ?? 'Sem nome',
      subtitle: c.taxId,
      href: `/customers/${c.id}`,
    }));
  }, [data, tenantId]);

  if (!key || results.length === 0) return null;

  return (
    <Group heading="Clientes">
      {results.map((r) => (
        <Item
          key={r.id}
          icon={Users}
          label={r.title}
          sub={r.subtitle}
          onSelect={() => onSelect(r.href)}
          rightHint={<ArrowRight className="h-3.5 w-3.5 text-text-subtle" />}
        />
      ))}
    </Group>
  );
}

// ---------------------------------------------------------------------------

function DensityGroup({ onClose }: { onClose: () => void }) {
  const { density, setDensity } = useDensity();
  return (
    <Group heading="Densidade">
      <Item
        icon={Rows4}
        label="Compacto"
        sub="Cabe mais informação na tela"
        onSelect={() => {
          setDensity('compact');
          onClose();
        }}
        rightHint={density === 'compact' ? <ActiveDot /> : undefined}
      />
      <Item
        icon={Rows3}
        label="Cozy"
        sub="Equilíbrio (padrão)"
        onSelect={() => {
          setDensity('cozy');
          onClose();
        }}
        rightHint={density === 'cozy' ? <ActiveDot /> : undefined}
      />
      <Item
        icon={Rows2}
        label="Confortável"
        sub="Mais espaço, melhor pra leitura"
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
    <Group heading="Aparência">
      <Item icon={Sun} label="Tema claro" onSelect={() => toggle('light')} />
      <Item icon={Moon} label="Tema escuro" onSelect={() => toggle('dark')} />
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
