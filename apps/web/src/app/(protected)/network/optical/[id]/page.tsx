'use client';

/**
 * /network/optical/[id] — detalhe da caixa óptica + vista esquemática (R4.5b).
 *
 * Tela full-page tipo "rack visual" do Tomodat: cabos entrando à esquerda,
 * splitters ao centro, cabos saindo à direita, fusões desenhadas entre eles.
 *
 * Stack visual:
 *   - Header: voltar, código, tipo, ações (editar, imprimir, exportar PNG)
 *   - Sumário compacto: lat/lng, capacidade, % ocupação
 *   - Toolbar: cabos/splitters/fusões counters + botão "+ Adicionar"
 *   - SVG cheio com EnclosureSchematic
 *   - Painel lateral colapsável com lista de fusões + ações
 */
import { ArrowLeft, ImageIcon, Pencil, Plus, Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import useSWR from 'swr';

import { EnclosureSchematic } from '@/components/optical/EnclosureSchematic';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { Input, Label } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  enclosureTopologyApi,
  fiberSplicesApi,
  type EnclosureTopology,
} from '@/lib/fiber-api';
import { hasPermission } from '@/lib/session';

interface CreateSpliceContext {
  aCableId: string;
  aFiberIndex: number;
  bCableId: string;
  bFiberIndex: number;
}

export default function OpticalEnclosureDetailPage() {
  const t = useTranslations('network.opticalDetail');
  const tc = useTranslations('common');
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const canWrite = hasPermission('network.write');

  const { data, mutate, isLoading, error } = useSWR<EnclosureTopology>(
    id ? enclosureTopologyApi.path(id) : null,
  );

  const svgContainerRef = useRef<HTMLDivElement>(null);
  const [createCtx, setCreateCtx] = useState<CreateSpliceContext | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  if (isLoading || !data) return <PageLoader label={t('loadingTopology')} />;
  if (error) {
    return (
      <p className="text-sm text-red-600">
        {t('loadError', {
          message:
            error instanceof ApiError ? error.friendlyMessage : t('unknownError'),
        })}
      </p>
    );
  }

  const { enclosure, incomingCables, childSplitters, splices, ports } = data;
  const incoming = incomingCables.filter((c) => c.endpointRole === 'B').length;
  const outgoing = incomingCables.filter((c) => c.endpointRole === 'A').length;
  const portsUsed = ports.filter(
    (p) => p.status === 'USED' || p.status === 'RESERVED',
  ).length;
  const occupancyPct = enclosure.capacity > 0
    ? Math.round((portsUsed / enclosure.capacity) * 100)
    : 0;

  function exportPng() {
    const svg = svgContainerRef.current?.querySelector('svg');
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${enclosure.code}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3">
        <Link href="/network/optical" className="text-text-muted hover:text-text">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight font-mono">
            {enclosure.code}
          </h1>
          <p className="text-xs text-text-muted">
            {enclosure.type}
            {enclosure.splitterRatio
              ? ` · Splitter ${enclosure.splitterRatio.replace('ONE_TO_', '1:')}`
              : ''}{' '}
            · {enclosure.latitude.toFixed(5)}, {enclosure.longitude.toFixed(5)}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportPng}>
            <ImageIcon className="h-3.5 w-3.5" />
            {t('exportSvg')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
          >
            <Printer className="h-3.5 w-3.5" />
            {tc('print')}
          </Button>
        </div>
      </header>

      {/* Sumário compacto */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <SummaryCard label={t('cablesIn')} value={incoming} tone="info" />
        <SummaryCard label={t('cablesOut')} value={outgoing} tone="info" />
        <SummaryCard
          label={t('splittersInside')}
          value={childSplitters.length}
          tone="brand"
        />
        <SummaryCard label={t('splices')} value={splices.length} tone="warning" />
        <SummaryCard
          label={t('portsUsed')}
          value={`${portsUsed}/${enclosure.capacity}`}
          tone={occupancyPct >= 80 ? 'danger' : occupancyPct >= 50 ? 'warning' : 'success'}
          subtitle={t('occupancy', { pct: occupancyPct })}
        />
      </section>

      {/* Toolbar */}
      <section className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-3">
        <span className="text-xs text-text-muted">
          {t('toolbarHelp')}
        </span>
        {canWrite && (
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" disabled>
              <Plus className="h-3.5 w-3.5" />
              {t('cable')}
            </Button>
            <Button size="sm" variant="outline" disabled>
              <Plus className="h-3.5 w-3.5" />
              {t('splitter')}
            </Button>
          </div>
        )}
      </section>

      {/* Vista esquemática */}
      <div ref={svgContainerRef}>
        <EnclosureSchematic
          topology={data}
          onCreateSplice={(a, b) => {
            // Só liga 2 fibras de cabo (splitter ainda não suportado em v1).
            if (a.kind !== 'cable' || b.kind !== 'cable') {
              toast.error(t('cableOnlyError'));
              return;
            }
            setCreateCtx({
              aCableId: a.id,
              aFiberIndex: a.index,
              bCableId: b.id,
              bFiberIndex: b.index,
            });
          }}
          onEditSplice={(spliceId) => {
            // Por enquanto navega pra página de fusões — futuro abre inline.
            router.push(`/network/splices?focus=${spliceId}`);
          }}
          onDeleteSplice={(spliceId) => setDeleteId(spliceId)}
        />
      </div>

      {/* Modal: criar fusão */}
      {createCtx && (
        <CreateSpliceModal
          ctx={createCtx}
          enclosureLat={enclosure.latitude}
          enclosureLng={enclosure.longitude}
          onClose={() => setCreateCtx(null)}
          onSaved={async () => {
            await mutate();
            setCreateCtx(null);
          }}
        />
      )}

      {/* Confirmação de cortar fusão */}
      {deleteId && (
        <ConfirmDialog
          open
          onClose={() => setDeleteId(null)}
          onConfirm={async () => {
            try {
              await fiberSplicesApi.remove(deleteId);
              toast.success(t('spliceRemoved'));
              await mutate();
              setDeleteId(null);
            } catch (err) {
              toast.error(
                err instanceof ApiError ? err.friendlyMessage : tc('error'),
              );
            }
          }}
          title={t('cutSpliceTitle')}
          message={t('cutSpliceMessage')}
          confirmLabel={t('cut')}
          variant="danger"
        />
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  subtitle,
}: {
  label: string;
  value: string | number;
  tone: 'info' | 'success' | 'warning' | 'danger' | 'brand';
  subtitle?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="text-2xs uppercase tracking-wider text-text-muted">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <Badge tone={tone}>{value}</Badge>
        {subtitle && <span className="text-xs text-text-muted">{subtitle}</span>}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Modal de criar fusão (pré-preenchido com lat/lng da caixa)
// ───────────────────────────────────────────────────────────────────────────
function CreateSpliceModal({
  ctx,
  enclosureLat,
  enclosureLng,
  onClose,
  onSaved,
}: {
  ctx: CreateSpliceContext;
  enclosureLat: number;
  enclosureLng: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('network.opticalDetail');
  const tc = useTranslations('common');
  const [lossDb, setLossDb] = useState<string>('0.10');
  const [measured, setMeasured] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await fiberSplicesApi.create({
        latitude: enclosureLat,
        longitude: enclosureLng,
        cableAId: ctx.aCableId,
        fiberAIndex: ctx.aFiberIndex,
        cableBId: ctx.bCableId,
        fiberBIndex: ctx.bFiberIndex,
        lossDb: measured ? Number(lossDb) : null,
        measuredAt: measured ? new Date().toISOString() : null,
      });
      toast.success(t('spliceCreated'));
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('newSplice')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {t('fuse')}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="text-sm text-text-muted">
          {t('fiber')} <strong>{ctx.aFiberIndex}</strong> ↔ {t('fiber')}{' '}
          <strong>{ctx.bFiberIndex}</strong>
          <br />
          {t('location')}: <span className="font-mono text-xs">
            {enclosureLat.toFixed(5)}, {enclosureLng.toFixed(5)}
          </span>{' '}
          {t('boxCenter')}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={measured}
            onChange={(e) => setMeasured(e.target.checked)}
          />
          {t('measuredLoss')}
        </label>
        {measured && (
          <div>
            <Label>{t('lossDb')}</Label>
            <Input
              type="number"
              min={0}
              max={99.99}
              step={0.01}
              value={lossDb}
              onChange={(e) => setLossDb(e.target.value)}
              className="max-w-[140px]"
            />
          </div>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}
