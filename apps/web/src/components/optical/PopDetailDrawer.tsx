'use client';

/**
 * PopDetailDrawer — painel lateral pra detalhes de um POP no estúdio (R8.2).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Operador clica num pino POP no mapa → drawer abre do lado direito mostrando:
 *   - Dados básicos do POP (código, lat/lng, cidade, notas)
 *   - OLTs vinculadas (lista) com botão "Desvincular"
 *   - Botão "+ Vincular OLT" → Select com OLTs SEM POP
 *
 * Sem modal central (não cobre o mapa); drawer permite operador ver a planta
 * enquanto gerencia. z-index alto pra ficar acima do Leaflet.
 */
import { Link2, Unlink, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { FieldHelp, Label, Select } from '@/components/ui/Input';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import type { Paginated } from '@/lib/crm-types';
import { type NetworkPop } from '@/lib/network-api';
import { oltsApi, type Olt } from '@/lib/olts-api';

interface Props {
  popId: string;
  onClose: () => void;
}

export function PopDetailDrawer({ popId, onClose }: Props) {
  const t = useTranslations('opticalComponents');
  const tc = useTranslations('common');
  const { data: pop } = useSWR<NetworkPop>(`/v1/network/pops/${popId}`);
  // OLTs vinculadas a este POP.
  const linkedKey = oltsApi.listPath({ popId, pageSize: 100 });
  const { data: linkedData, mutate: mutateLinked } = useSWR<Paginated<Olt>>(
    linkedKey,
  );
  const linked = linkedData?.data ?? [];

  // OLTs sem POP (candidatos pra vincular).
  const freeKey = oltsApi.listPath({ popId: 'none', pageSize: 100 });
  const { data: freeData, mutate: mutateFree } = useSWR<Paginated<Olt>>(
    freeKey,
  );
  const free = freeData?.data ?? [];

  const [picking, setPicking] = useState<string>('');
  const [linking, setLinking] = useState(false);
  const [unlinking, setUnlinking] = useState<Olt | null>(null);

  async function handleLink() {
    if (!picking) return;
    setLinking(true);
    try {
      await oltsApi.setPop(picking, popId);
      toast.success(t('popDetailDrawer.linkSuccess'));
      setPicking('');
      await Promise.all([mutateLinked(), mutateFree()]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setLinking(false);
    }
  }

  async function handleUnlink(olt: Olt) {
    try {
      await oltsApi.setPop(olt.id, null);
      toast.success(t('popDetailDrawer.unlinkSuccess', { name: olt.name }));
      await Promise.all([mutateLinked(), mutateFree()]);
      setUnlinking(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    }
  }

  return (
    <aside
      className="fixed right-0 top-12 z-[1500] flex h-[calc(100vh-3rem)] w-96 flex-col border-l border-border bg-surface shadow-2xl"
      // top-12 = abaixo da topbar (h-12) do estúdio
    >
      <header className="flex items-center justify-between border-b border-border bg-surface-muted px-3 py-2">
        <div className="flex items-center gap-2">
          <Badge tone="info">POP</Badge>
          <span className="text-sm font-semibold">
            {pop?.name ?? tc('loading')}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-text"
          title={tc('close')}
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {/* Dados básicos */}
        {pop && (
          <section className="rounded-md border border-border bg-surface-muted p-3 text-xs">
            <dl className="space-y-1">
              {pop.code && (
                <Row label={tc('code')} value={<span className="font-mono">{pop.code}</span>} />
              )}
              {pop.city && <Row label={t('popDetailDrawer.city')} value={pop.city} />}
              {(pop.latitude != null && pop.longitude != null) && (
                <Row
                  label={t('popDetailDrawer.coord')}
                  value={
                    <span className="font-mono">
                      {pop.latitude.toFixed(5)}, {pop.longitude.toFixed(5)}
                    </span>
                  }
                />
              )}
              {pop.notes && <Row label={tc('notes')} value={pop.notes} />}
            </dl>
          </section>
        )}

        {/* OLTs vinculadas */}
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
            <Link2 className="h-3.5 w-3.5" />
            {t('popDetailDrawer.oltsInPop', { count: linked.length })}
          </h3>
          {linked.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-3 text-xs italic text-text-muted">
              {t('popDetailDrawer.noLinkedOlts')}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {linked.map((olt) => (
                <li
                  key={olt.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-surface p-2 text-xs"
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{olt.name}</div>
                    <div className="text-text-muted">
                      {olt.vendor} {olt.model}
                      {olt.managementIp && (
                        <>
                          {' · '}
                          <code>{olt.managementIp}</code>
                        </>
                      )}
                    </div>
                  </div>
                  <Badge
                    tone={
                      olt.status === 'ONLINE'
                        ? 'success'
                        : olt.status === 'OFFLINE' || olt.status === 'UNREACHABLE'
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    {t(`popDetailDrawer.oltStatus.${olt.status}`)}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => setUnlinking(olt)}
                    className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-red-600"
                    title={t('popDetailDrawer.unlinkFromPop')}
                  >
                    <Unlink className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Vincular nova OLT */}
        <section className="rounded-md border border-border bg-surface-muted p-3">
          <Label htmlFor="link-olt">{t('popDetailDrawer.linkExistingOlt')}</Label>
          <div className="flex gap-2">
            <Select
              id="link-olt"
              value={picking}
              onChange={(e) => setPicking(e.target.value)}
              disabled={free.length === 0 || linking}
            >
              <option value="">
                {free.length === 0
                  ? t('popDetailDrawer.noFreeOlts')
                  : t('popDetailDrawer.selectPlaceholder')}
              </option>
              {free.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · {o.vendor} {o.model}
                </option>
              ))}
            </Select>
            <Button
              onClick={handleLink}
              disabled={!picking || linking}
              loading={linking}
              size="sm"
            >
              {t('popDetailDrawer.link')}
            </Button>
          </div>
          <FieldHelp>
            {t.rich('popDetailDrawer.createOltHelp', {
              code: (chunks) => <code className="text-2xs">{chunks}</code>,
            })}
          </FieldHelp>
        </section>
      </div>

      {unlinking && (
        <ConfirmDialog
          open
          onClose={() => setUnlinking(null)}
          onConfirm={() => handleUnlink(unlinking)}
          title={t('popDetailDrawer.unlinkConfirmTitle', { name: unlinking.name })}
          message={t('popDetailDrawer.unlinkConfirmMessage')}
          confirmLabel={t('popDetailDrawer.unlink')}
          variant="danger"
        />
      )}
    </aside>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-text-muted">{label}</dt>
      <dd className="flex-1 text-text">{value}</dd>
    </div>
  );
}
