'use client';

/**
 * CatalogTab — aba "Catálogo de produtos" da Tela 3 do FiberMap (spec §10).
 *
 * Sub-abas por categoria (Cabos · CEO · CTO · DIO · Armários · Racks ·
 * Splitters), tabela paginada com busca e filtro ativos/todos, ações por
 * linha (editar / duplicar / desativar / excluir) e botão "Novo".
 *
 * Regras de negócio refletidas na UX (autoridade continua no backend):
 *   • excluir só habilitado com 0 instâncias em campo; 409 → toast dedicado;
 *   • produto com instâncias se DESATIVA (some das escolhas novas, instâncias
 *     ficam intactas — snapshot, spec §14.8);
 *   • cabo: estrutura imutável — "editar" só metadados; "duplicar" leva a
 *     estrutura toda pro form novo.
 */
import {
  Archive,
  Box,
  Boxes,
  Cable,
  Copy,
  MoreVertical,
  Network,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
  Server,
  Split,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input, Select } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Tabs } from '@/components/ui/Tabs';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  fibermapApi,
  type FibermapProduct,
  type FibermapProductType,
} from '@/lib/fibermap-api';

import { CableModelForm } from './CableModelForm';
import { ProductForm } from './ProductForm';
import {
  FIBERMAP_CATEGORIES,
  specBool,
  specInt,
  specStr,
  type CatalogFormMode,
  type FibermapNonCableType,
} from './catalog-shared';

const PAGE_SIZE = 20;

const CATEGORY_ICON: Record<FibermapProductType, LucideIcon> = {
  CABLE: Cable,
  SPLICE_CLOSURE: Box,
  TERMINATION_BOX: Boxes,
  DIO: Network,
  CABINET: Archive,
  INDOOR_RACK: Server,
  SPLITTER: Split,
};

type ActiveFilter = 'true' | 'all';

/** Debounce simples pra busca server-side (q). */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

interface FormState {
  mode: CatalogFormMode;
  product: FibermapProduct | null;
}

export function CatalogTab({ canAdmin }: { canAdmin: boolean }) {
  const t = useTranslations('fibermap');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const sp = useSearchParams();

  const catParam = sp?.get('cat') ?? '';
  const category: FibermapProductType = (
    FIBERMAP_CATEGORIES as readonly string[]
  ).includes(catParam)
    ? (catParam as FibermapProductType)
    : 'CABLE';

  const [q, setQ] = useState('');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('true');
  const [page, setPage] = useState(1);
  const debouncedQ = useDebounced(q, 300);

  // Trocou a categoria (inclusive via back/forward) → limpa busca e filtro.
  useEffect(() => {
    setQ('');
    setActiveFilter('true');
    setPage(1);
  }, [category]);

  // Mudou busca/filtro → sempre volta pra página 1 (convention §7).
  useEffect(() => {
    setPage(1);
  }, [debouncedQ, activeFilter]);

  const { data, isLoading, mutate } = useSWR(
    ['fibermap-catalog', category, debouncedQ, activeFilter, page],
    () =>
      fibermapApi.listProducts({
        type: category,
        q: debouncedQ.trim() || undefined,
        active: activeFilter,
        page,
        pageSize: PAGE_SIZE,
      }),
    { keepPreviousData: true },
  );

  const [form, setForm] = useState<FormState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<FibermapProduct | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  function setCategory(next: FibermapProductType) {
    const params = new URLSearchParams(sp?.toString() ?? '');
    params.set('cat', next);
    router.replace(`/fibermap/settings?${params.toString()}`);
  }

  function errorMessage(err: unknown): string {
    return err instanceof ApiError ? err.friendlyMessage : t('settings.genericError');
  }

  async function toggleActive(product: FibermapProduct) {
    setTogglingId(product.id);
    try {
      if (product.isActive) {
        await fibermapApi.deactivateProduct(product.id);
        toast.success(t('settings.catalog.deactivated'));
      } else {
        await fibermapApi.activateProduct(product.id);
        toast.success(t('settings.catalog.activated'));
      }
      await mutate();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await fibermapApi.deleteProduct(confirmDelete.id);
      toast.success(t('settings.catalog.deleted'));
      setConfirmDelete(null);
      await mutate();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(t('settings.catalog.deleteConflict'));
      } else {
        toast.error(errorMessage(err));
      }
    } finally {
      setDeleting(false);
    }
  }

  /** Resumo das características por categoria (spec §10). */
  function productSummary(p: FibermapProduct): string {
    const parts: string[] = [];
    if (p.type === 'CABLE') {
      const m = p.cableModel;
      if (!m) return '—';
      parts.push(
        t('settings.catalog.summary.cableStructure', {
          tubes: m.tubeCount,
          fibersPerTube: m.fibersPerTube,
          fibers: m.fiberCount,
        }),
      );
      parts.push(m.colorStandard === 'ABNT' ? 'ABNT' : 'EIA/TIA-598');
      parts.push(t(`settings.cable.scheme.${m.tubeScheme}`));
      if (m.cableClass) {
        parts.push(t('settings.catalog.summary.cableClass', { name: m.cableClass }));
      }
      return parts.join(' · ');
    }

    const s = p.specs;
    switch (p.type) {
      case 'SPLICE_CLOSURE': {
        const trays = specInt(s, 'trays');
        const spt = specInt(s, 'splices_per_tray');
        const entries = specInt(s, 'cable_entries');
        const mount = specStr(s, 'mount');
        if (trays !== null) parts.push(t('settings.catalog.summary.trays', { count: trays }));
        if (spt !== null) parts.push(t('settings.catalog.summary.splicesPerTray', { count: spt }));
        if (entries !== null) parts.push(t('settings.catalog.summary.cableEntries', { count: entries }));
        if (mount === 'AEREA' || mount === 'SUBTERRANEA') {
          parts.push(t(`settings.catalog.summary.mount.${mount}`));
        }
        break;
      }
      case 'TERMINATION_BOX': {
        const drops = specInt(s, 'drop_ports');
        const connector = specStr(s, 'connector');
        const splice = specInt(s, 'splice_capacity');
        if (drops !== null) parts.push(t('settings.catalog.summary.dropPorts', { count: drops }));
        if (connector) parts.push(connector);
        if (specBool(s, 'supports_splitter') === true) {
          parts.push(t('settings.catalog.summary.supportsSplitter'));
        }
        if (splice !== null) parts.push(t('settings.catalog.summary.spliceCapacity', { count: splice }));
        break;
      }
      case 'DIO': {
        const ports = specInt(s, 'ports');
        const connector = specStr(s, 'connector');
        const trays = specInt(s, 'trays');
        const us = specInt(s, 'rack_units');
        if (ports !== null) parts.push(t('settings.catalog.summary.ports', { count: ports }));
        if (connector) parts.push(connector);
        if (trays !== null) parts.push(t('settings.catalog.summary.trays', { count: trays }));
        if (us !== null) parts.push(t('settings.catalog.summary.rackUnits', { count: us }));
        break;
      }
      case 'CABINET': {
        const us = specInt(s, 'rack_units');
        if (us !== null) parts.push(t('settings.catalog.summary.rackUnits', { count: us }));
        parts.push(
          specBool(s, 'outdoor') === true
            ? t('settings.catalog.summary.outdoor')
            : t('settings.catalog.summary.indoor'),
        );
        break;
      }
      case 'INDOOR_RACK': {
        const us = specInt(s, 'rack_units');
        if (us !== null) parts.push(t('settings.catalog.summary.rackUnits', { count: us }));
        break;
      }
      case 'SPLITTER': {
        const ratio = specStr(s, 'ratio');
        const topology = specStr(s, 'topology');
        const tap = specInt(s, 'tap_percent');
        if (ratio) parts.push(ratio);
        if (topology === 'UNBALANCED') {
          parts.push(t('settings.catalog.summary.unbalanced', { tap: tap ?? 0 }));
        } else if (topology === 'BALANCED') {
          parts.push(t('settings.catalog.summary.balanced'));
        }
        if (specBool(s, 'connectorized') === true) {
          parts.push(t('settings.catalog.summary.connectorized'));
        }
        break;
      }
    }
    return parts.length > 0 ? parts.join(' · ') : '—';
  }

  const columns: DataTableColumn<FibermapProduct>[] = [
    {
      key: 'manufacturer',
      label: t('settings.catalog.cols.manufacturer'),
      width: 150,
      hideOnNarrow: true,
      cell: (p) => <span className="text-text-muted">{p.manufacturer}</span>,
    },
    {
      key: 'name',
      label: t('settings.catalog.cols.model'),
      cell: (p) => (
        <div className="flex min-w-0 flex-col">
          <span className="font-medium text-text">{p.name}</span>
          {p.description && (
            <span className="line-clamp-1 text-xs text-text-subtle">
              {p.description}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'summary',
      label: t('settings.catalog.cols.summary'),
      hideOnNarrow: true,
      cell: (p) => (
        <span className="text-xs text-text-muted">{productSummary(p)}</span>
      ),
    },
    {
      key: 'instances',
      label: t('settings.catalog.cols.instances'),
      align: 'center',
      width: 100,
      cell: (p) => {
        const n = p.instancesCount ?? 0;
        return n > 0 ? (
          <Badge tone="info">{n}</Badge>
        ) : (
          <span className="text-text-subtle">0</span>
        );
      },
    },
    {
      key: 'status',
      label: tCommon('status'),
      width: 110,
      cell: (p) => (
        <Badge tone={p.isActive ? 'success' : 'neutral'}>
          {p.isActive ? t('settings.catalog.active') : t('settings.catalog.inactive')}
        </Badge>
      ),
    },
  ];

  if (canAdmin) {
    columns.push({
      key: 'actions',
      label: <span className="sr-only">{tCommon('actions')}</span>,
      align: 'right',
      width: 56,
      cell: (p) => {
        const busy = togglingId === p.id;
        const blockedDelete = (p.instancesCount ?? 0) > 0;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={tCommon('actions')}
                disabled={busy}
              >
                {busy ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <MoreVertical className="h-4 w-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => setForm({ mode: 'edit', product: p })}
              >
                <Pencil className="h-3.5 w-3.5" />
                {tCommon('edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setForm({ mode: 'duplicate', product: p })}
              >
                <Copy className="h-3.5 w-3.5" />
                {t('settings.catalog.actions.duplicate')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  void toggleActive(p);
                }}
              >
                {p.isActive ? (
                  <>
                    <PowerOff className="h-3.5 w-3.5" />
                    {t('settings.catalog.actions.deactivate')}
                  </>
                ) : (
                  <>
                    <Power className="h-3.5 w-3.5" />
                    {t('settings.catalog.actions.activate')}
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="danger"
                disabled={blockedDelete}
                onSelect={() => setConfirmDelete(p)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {tCommon('delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    });
  }

  const EmptyIcon = CATEGORY_ICON[category];

  return (
    <div className="space-y-4">
      <Tabs
        value={category}
        onChange={setCategory}
        items={FIBERMAP_CATEGORIES.map((c) => {
          const Icon = CATEGORY_ICON[c];
          return {
            value: c,
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" />
                {t(`settings.catalog.categories.${c}`)}
              </span>
            ),
          };
        })}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('settings.catalog.searchPlaceholder')}
            aria-label={tCommon('search')}
            className="pl-8"
          />
        </div>
        <Select
          value={activeFilter}
          onChange={(e) =>
            setActiveFilter(e.target.value === 'all' ? 'all' : 'true')
          }
          aria-label={tCommon('filter')}
          className="w-full sm:w-40"
        >
          <option value="true">{t('settings.catalog.filter.activeOnly')}</option>
          <option value="all">{t('settings.catalog.filter.all')}</option>
        </Select>
        <div className="flex-1" />
        {canAdmin && (
          <Button onClick={() => setForm({ mode: 'create', product: null })}>
            <Plus className="h-3.5 w-3.5" />
            {t('settings.catalog.newProduct')}
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data?.data}
        isLoading={isLoading}
        empty={{
          icon: EmptyIcon,
          title: t('settings.catalog.empty.title'),
          description: t('settings.catalog.empty.description'),
          action: canAdmin
            ? {
                label: t('settings.catalog.newProduct'),
                onClick: () => setForm({ mode: 'create', product: null }),
              }
            : undefined,
        }}
      />

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs text-text-muted">
          <span className="mr-auto">
            {t('settings.catalog.totalCount', { count: data.pagination.total })}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            {tCommon('previous')}
          </Button>
          <span>
            {page} / {data.pagination.totalPages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= data.pagination.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {tCommon('next')}
          </Button>
        </div>
      )}

      {form &&
        (category === 'CABLE' ? (
          <CableModelForm
            mode={form.mode}
            initial={form.product}
            onClose={() => setForm(null)}
            onSaved={async () => {
              setForm(null);
              await mutate();
            }}
          />
        ) : (
          <ProductForm
            type={category as FibermapNonCableType}
            mode={form.mode}
            initial={form.product}
            onClose={() => setForm(null)}
            onSaved={async () => {
              setForm(null);
              await mutate();
            }}
          />
        ))}

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) return handleDelete();
        }}
        title={t('settings.catalog.deleteConfirmTitle')}
        message={t('settings.catalog.deleteConfirmMessage', {
          name: confirmDelete?.name ?? '',
        })}
        confirmLabel={tCommon('delete')}
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}
