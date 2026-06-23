'use client';

/**
 * /os/[id] — tela única do técnico em campo, ramificada por tipo de O.S.
 *
 * Fluxo: a caminho (en-route) → check-in (IN_PROGRESS) → form de fechamento
 * conforme reason.kind → confirma (POST /complete-field). O backend "splita":
 *   INSTALLATION → provisiona tudo.
 *   SUPPORT      → fecha (+materiais/fotos). Campo "trocou ONT?":
 *                  Sim → SUPPORT_SWAP (troca de ONT). Não → SUPPORT.
 *   RETRIEVAL    → recolhe equipamento + desprovisiona + encerra contrato.
 */
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';

import { Button } from '@/components/ui/Button';
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox';
import {
  FieldHelp,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError, api } from '@/lib/api';
import { opticalApi, type OpticalPort } from '@/lib/optical-api';
import { stockApi, type StockLocation } from '@/lib/stock-api';
import { buildMapsNavUrl } from '@/lib/maps';
import {
  provisioningApi,
  type InstallTimelineEvent,
} from '@/lib/provisioning-api';
import { radacctApi } from '@/lib/radacct-api';
import {
  serviceOrdersApi,
  type CompleteFieldInput,
  type FieldMaterialInput,
  type ServiceOrderPhotoInput,
  type ServiceOrderResponse,
} from '@/lib/service-orders-api';
import { ServiceOrderMessages } from '@/components/service-orders/ServiceOrderMessages';
import { ServiceOrderAttachments } from '@/components/service-orders/ServiceOrderAttachments';
import { ContractSessionCard } from '@/components/contracts/ContractSessionCard';

type OltOption = {
  id: string;
  name: string;
  vendor: string;
  providerMode: string;
};

export default function OsDetailPage() {
  const t = useTranslations('technician');
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const {
    data: so,
    isLoading,
    mutate,
  } = useSWR<ServiceOrderResponse>(id ? serviceOrdersApi.getPath(id) : null);

  const isInProgress = so?.status === 'IN_PROGRESS';
  const kind = so?.reason?.kind ?? 'INSTALLATION';

  // Dados do form (só carrega quando em execução).
  const { data: olts } = useSWR<OltOption[]>(
    isInProgress ? '/v1/optical/olts' : null,
    (k: string) => api.get<OltOption[]>(k),
  );
  const { data: serials } = useSWR(
    isInProgress ? 'comodato-available' : null,
    () => stockApi.listComodatoAvailable(),
  );
  const { data: products } = useSWR(
    isInProgress ? 'consumiveis' : null,
    () => stockApi.listProducts({ type: 'CONSUMIVEL', isActive: true }),
  );
  const { data: locations } = useSWR(
    isInProgress ? 'stock-locations' : null,
    () => stockApi.listLocations({ isActive: true }),
  );

  // ── estado do form ──
  const [busy, setBusy] = useState(false);
  const [oltId, setOltId] = useState('');
  const [serialItemId, setSerialItemId] = useState('');
  const [selectedOnt, setSelectedOnt] = useState<ComboboxOption | null>(null);
  const [bypass, setBypass] = useState(false);
  const [snGpon, setSnGpon] = useState('');
  const [enclosureId, setEnclosureId] = useState(''); // CTO importada (Ufinet/própria)
  const [selectedCto, setSelectedCto] = useState<ComboboxOption | null>(null);
  const [portNumber, setPortNumber] = useState(''); // porta da CTO escolhida
  const [returnLocationId, setReturnLocationId] = useState('');
  const [swappedOnt, setSwappedOnt] = useState(false); // suporte: trocou ONT?
  const [closeDescription, setCloseDescription] = useState('');
  const [materials, setMaterials] = useState<FieldMaterialInput[]>([]);
  const [photos, setPhotos] = useState<ServiceOrderPhotoInput[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  // Fluxo de 2 etapas (instalação): resultado do provisionamento + modais.
  const [installResult, setInstallResult] = useState<InstallTimelineEvent[] | null>(null);
  const [swapOpen, setSwapOpen] = useState(false);

  // Modo confirmação: provisionou em campo (etapa 1) e a O.S ainda não fechou.
  // Trava a tela aqui até o técnico finalizar (etapa 2).
  const inConfirmation =
    !!so?.fieldProvisionedAt && so?.status !== 'COMPLETED' && kind === 'INSTALLATION';

  const selectedOlt = (olts ?? []).find((o) => o.id === oltId);
  const isUfinet =
    selectedOlt?.vendor === 'UFINET' &&
    selectedOlt?.providerMode === 'ORCHESTRATOR';

  // CTOs importadas (OpticalEnclosure) da OLT escolhida — fonte de verdade da
  // caixa/porta real (Ufinet importou todas no NetX). Busca server-side (são
  // milhares; rolar <select> é inviável). Contagem leve só pro empty-state.
  const { data: ctoCountResp } = useSWR(
    oltId ? ['os-cto-count', oltId] : null,
    () => opticalApi.list({ oltId, pageSize: 1 }),
  );
  const ctoCount = ctoCountResp?.pagination.total ?? null;
  const loadCtoOptions = useCallback(
    async (query: string): Promise<ComboboxOption[]> => {
      if (!oltId) return [];
      const resp = await opticalApi.list({
        oltId,
        search: query.trim() || undefined,
        pageSize: 50,
      });
      return resp.data.map((c) => ({
        value: c.id,
        label: c.code,
        sublabel: c.locationLabel ?? undefined,
      }));
    },
    [oltId],
  );
  // ONTs disponíveis em estoque — busca por serial (últimos números) no
  // Combobox; lista já vem carregada, então filtra client-side.
  const loadOntOptions = useCallback(
    async (query: string): Promise<ComboboxOption[]> => {
      const q = query.trim().toLowerCase();
      return (serials ?? [])
        .filter(
          (s) => !q || `${s.serial} ${s.product.name}`.toLowerCase().includes(q),
        )
        .slice(0, 50)
        .map((s) => ({
          value: s.id,
          label: s.serial,
          sublabel: `${s.product.name} (${s.location.code})`,
        }));
    },
    [serials],
  );

  // Portas da CTO escolhida (status livre/usada) — valida a porta.
  const { data: ports } = useSWR<OpticalPort[]>(
    enclosureId ? opticalApi.portsPath(enclosureId) : null,
  );

  // SUPPORT vira SUPPORT_SWAP quando o técnico marca "trocou ONT".
  const effectiveMode: CompleteFieldInput['mode'] =
    kind === 'INSTALLATION'
      ? 'INSTALLATION'
      : kind === 'RETRIEVAL'
        ? 'RETRIEVAL'
        : swappedOnt
          ? 'SUPPORT_SWAP'
          : 'SUPPORT';

  const needsOnt = effectiveMode === 'INSTALLATION' || effectiveMode === 'SUPPORT_SWAP';
  const needsReturn =
    effectiveMode === 'SUPPORT_SWAP' || effectiveMode === 'RETRIEVAL';

  // ── lifecycle ──
  async function doEnRoute() {
    // Abre o Google Maps em navegação ANTES de qualquer await — preserva o
    // user-gesture do clique (senão o mobile bloqueia o popup/app). No celular,
    // a URL universal aciona o app nativo do Maps e mantém o NetX aberto atrás.
    const navUrl = so?.contract ? buildMapsNavUrl(so.contract) : null;
    if (navUrl) {
      window.open(navUrl, '_blank', 'noopener,noreferrer');
    } else {
      toast.error(t('detail.noLocation'));
    }
    setBusy(true);
    try {
      await serviceOrdersApi.enRoute(id);
      await mutate();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.friendlyMessage : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }
  async function doCheckin() {
    setBusy(true);
    try {
      await serviceOrdersApi.checkin(id);
      await mutate();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.friendlyMessage : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }
  async function doReturnToQueue() {
    const reason = returnReason.trim();
    if (!reason) return;
    setBusy(true);
    try {
      await serviceOrdersApi.returnToQueue(id, reason);
      await mutate();
      setReturnOpen(false);
      setReturnReason('');
      toast.success(t('detail.returnedToQueue'));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.friendlyMessage : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  // ── upload de foto (presign → PUT no MinIO) ──
  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const { uploadUrl, storageKey } = await serviceOrdersApi.presignPhoto(
        id,
        file.name,
        file.type || undefined,
      );
      const put = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: file.type ? { 'Content-Type': file.type } : {},
      });
      if (!put.ok)
        throw new Error(t('errors.uploadStatus', { status: put.status }));
      setPhotos((p) => [
        ...p,
        { storageKey, contentType: file.type || null, sizeBytes: file.size },
      ]);
      toast.success(t('toast.photoSent'));
    } catch (er) {
      toast.error(er instanceof Error ? er.message : t('errors.uploadFailed'));
    } finally {
      setBusy(false);
    }
  }

  // ── materiais ──
  function addMaterial() {
    setMaterials((m) => [...m, { productId: '', locationId: '', quantity: 1 }]);
  }
  function setMaterial(i: number, patch: Partial<FieldMaterialInput>) {
    setMaterials((m) => m.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function removeMaterial(i: number) {
    setMaterials((m) => m.filter((_, idx) => idx !== i));
  }

  // ── validação + payload por modo ──
  function buildPayload(
    opts: { requireClose?: boolean } = {},
  ): { payload: CompleteFieldInput } | { error: string } {
    const requireClose = opts.requireClose ?? true;
    if (requireClose && !closeDescription.trim()) return { error: t('errors.closeRequired') };
    for (const m of materials) {
      if (!m.productId || !m.locationId)
        return { error: t('errors.materialsRequired') };
    }
    const ontFields = () => {
      if (bypass && !snGpon.trim()) return t('errors.snGponRequired');
      if (!bypass && !serialItemId) return t('errors.ontStockRequired');
      // Wi-Fi vem do contrato (definido no cadastro) — técnico não digita.
      return null;
    };

    if (effectiveMode === 'INSTALLATION') {
      if (!oltId) return { error: t('errors.oltRequired') };
      const e = ontFields();
      if (e) return { error: e };
      if (isUfinet && !enclosureId)
        return { error: t('errors.ctoRequired') };
      const ctoCode = selectedCto?.label ?? null;
      return {
        payload: {
          mode: 'INSTALLATION',
          install: {
            oltId,
            ...(bypass
              ? { allowStockBypass: true, snGpon: snGpon.trim() }
              : { serialItemId }),
            // Caixa real = code da CTO importada (Ufinet); porta = número da CTO.
            ...(isUfinet
              ? { ufinetCto: ctoCode, ufinetPort: portNumber || null }
              : ctoCode || portNumber
                ? { notes: `CTO: ${ctoCode ?? '—'} / Porta: ${portNumber || '—'}` }
                : {}),
          },
          ...(!isUfinet ? { enclosureId: enclosureId || null, enclosurePort: portNumber || null } : {}),
          materials,
          photos,
          closeDescription: closeDescription.trim(),
        },
      };
    }

    if (effectiveMode === 'SUPPORT_SWAP') {
      if (!returnLocationId)
        return { error: t('errors.returnOldRequired') };
      const e = ontFields();
      if (e) return { error: e };
      return {
        payload: {
          mode: 'SUPPORT_SWAP',
          swap: {
            returnLocationId,
            ...(bypass
              ? { allowStockBypass: true, newSnGpon: snGpon.trim() }
              : { newSerialItemId: serialItemId }),
          },
          materials,
          photos,
          closeDescription: closeDescription.trim(),
        },
      };
    }

    if (effectiveMode === 'RETRIEVAL') {
      if (!returnLocationId)
        return { error: t('errors.returnEquipRequired') };
      return {
        payload: {
          mode: 'RETRIEVAL',
          returnLocationId,
          photos,
          closeDescription: closeDescription.trim(),
        },
      };
    }

    // SUPPORT (sem troca)
    return {
      payload: {
        mode: 'SUPPORT',
        materials,
        photos,
        closeDescription: closeDescription.trim(),
      },
    };
  }

  async function confirm() {
    // Instalação = fluxo de 2 etapas: PROVISIONA (sem fechar) e cai na
    // confirmação. Demais modos seguem one-touch (fecha direto).
    const isInstall = effectiveMode === 'INSTALLATION';
    const r = buildPayload({ requireClose: !isInstall });
    if ('error' in r) {
      setErr(r.error);
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      if (isInstall) {
        const res = await serviceOrdersApi.provisionField(id, r.payload);
        setInstallResult(res.install.timeline);
        toast.success(t('toast.provisioned'));
        await mutate(); // so.fieldProvisionedAt agora setado → entra na confirmação
      } else {
        await serviceOrdersApi.completeField(id, r.payload);
        toast.success(t('toast.completed'));
        router.replace('/os');
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.friendlyMessage : t('errors.finishFailed'));
    } finally {
      setBusy(false);
    }
  }

  // Etapa 2: fecha a O.S e libera o técnico de volta pra fila.
  async function finalize() {
    if (!closeDescription.trim()) {
      setErr(t('errors.closeRequired'));
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await serviceOrdersApi.complete(id, { closeDescription: closeDescription.trim() });
      toast.success(t('toast.completed'));
      router.replace('/os');
    } catch (e) {
      setErr(e instanceof ApiError ? e.friendlyMessage : t('errors.finishFailed'));
    } finally {
      setBusy(false);
    }
  }

  // Re-tentar a MESMA ONT (re-sync RADIUS + TR-069), sem trocar equipamento.
  async function retry() {
    if (!so) return;
    setErr(null);
    setBusy(true);
    try {
      const res = await provisioningApi.reprovision(so.contractId);
      setInstallResult(res.timeline);
      toast.success(t('toast.retried'));
      await globalMutate(radacctApi.sessionPath(so.contractId));
    } catch (e) {
      setErr(e instanceof ApiError ? e.friendlyMessage : t('errors.finishFailed'));
    } finally {
      setBusy(false);
    }
  }

  // Bloqueio: enquanto não finalizar a confirmação, avisa antes de sair/fechar.
  useEffect(() => {
    if (!inConfirmation) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [inConfirmation]);

  if (isLoading || !so) return <PageLoader label={t('loadingOrder')} />;

  const KIND_LABEL = t(`kind.${kind}`);

  return (
    <div className="space-y-4">
      {!inConfirmation && (
        <Link href="/os" className="text-sm text-text-subtle hover:text-text">
          {t('detail.back')}
        </Link>
      )}

      <header className="rounded-lg border border-border bg-surface p-3">
        <div className="flex items-center justify-between">
          <span className="font-mono font-semibold">{so.code ?? '—'}</span>
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-semibold uppercase tracking-wider text-text-subtle">
            {KIND_LABEL}
          </span>
        </div>
        <div className="mt-1 text-sm font-medium">
          {so.customer?.displayName ?? t('customerFallback')}
        </div>
        <div className="mt-0.5 text-xs text-text-muted">
          {so.reason?.name}
          {so.city ? ` · ${so.city}` : ''}
        </div>
        <p className="mt-2 whitespace-pre-wrap text-sm text-text-muted">
          {so.openDescription}
        </p>
      </header>

      {/* ── Lifecycle ── */}
      {(so.status === 'OPEN' ||
        so.status === 'SCHEDULED' ||
        so.displayStatus === 'OVERDUE') && (
        <Button onClick={doEnRoute} loading={busy} className="w-full">
          {t('detail.enRoute')}
        </Button>
      )}
      {so.status === 'EN_ROUTE' && (
        <div className="space-y-2">
          <Button onClick={doCheckin} loading={busy} className="w-full">
            {t('detail.checkin')}
          </Button>
          {so.contract && buildMapsNavUrl(so.contract) && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                const u = so.contract ? buildMapsNavUrl(so.contract) : null;
                if (u) window.open(u, '_blank', 'noopener,noreferrer');
              }}
            >
              {t('detail.openNav')}
            </Button>
          )}
          <Button
            variant="ghost"
            className="w-full text-red-600 dark:text-red-400"
            onClick={() => {
              setReturnReason('');
              setReturnOpen(true);
            }}
          >
            {t('detail.cancelEnRoute')}
          </Button>
        </div>
      )}
      {so.status === 'COMPLETED' && (
        <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200">
          {t('detail.completed')}
          {so.closeDescription ? ` — ${so.closeDescription}` : ''}.
        </div>
      )}

      {/* ── Confirmação (instalação provisionada, aguardando fechar) ── */}
      {inConfirmation && (
        <ProvisionConfirmation
          contractId={so.contractId}
          timeline={installResult}
          closeDescription={closeDescription}
          setCloseDescription={setCloseDescription}
          busy={busy}
          err={err}
          onRetry={retry}
          onSwap={() => setSwapOpen(true)}
          onFinalize={finalize}
          t={t}
        />
      )}

      {swapOpen && (
        <SwapOntModal
          loadOntOptions={loadOntOptions}
          locations={locations ?? []}
          onClose={() => setSwapOpen(false)}
          onSwap={async (payload) => {
            const res = await provisioningApi.swapOnt(so.contractId, payload);
            setInstallResult([
              {
                action: 'OLT_AUTHORIZE',
                status: res.status === 'OK' ? 'SUCCESS' : 'FAILED',
                message: t('detail.swapDone'),
                durationMs: null,
                at: new Date().toISOString(),
                error: null,
              },
            ]);
            setSwapOpen(false);
            await globalMutate(radacctApi.sessionPath(so.contractId));
            toast.success(t('toast.swapped'));
          }}
          t={t}
        />
      )}

      {/* ── Form de fechamento (em execução) ── */}
      {isInProgress && !inConfirmation && (
        <section className="space-y-4 rounded-lg border border-border bg-surface p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold">
              {t('detail.closingTitle', { kind: KIND_LABEL })}
            </h2>
            <button
              type="button"
              onClick={() => {
                setReturnReason('');
                setReturnOpen(true);
              }}
              className="shrink-0 text-xs text-red-600 hover:underline dark:text-red-400"
            >
              {t('detail.cancelExecution')}
            </button>
          </div>

          {/* Suporte: trocou ONT? */}
          {kind === 'SUPPORT' && (
            <div className="rounded-md border border-border p-2">
              <Label>{t('detail.swapQuestion')}</Label>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => setSwappedOnt(false)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm ${!swappedOnt ? 'border-accent bg-accent-muted text-text' : 'border-border text-text-muted'}`}
                >
                  {t('detail.swapNo')}
                </button>
                <button
                  type="button"
                  onClick={() => setSwappedOnt(true)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm ${swappedOnt ? 'border-accent bg-accent-muted text-text' : 'border-border text-text-muted'}`}
                >
                  {t('detail.swapYes')}
                </button>
              </div>
            </div>
          )}

          {/* OLT (só instalação) */}
          {effectiveMode === 'INSTALLATION' && (
            <div>
              <Label htmlFor="olt" required>
                {t('detail.olt')}
              </Label>
              <Select
                id="olt"
                value={oltId}
                onChange={(e) => {
                  setOltId(e.target.value);
                  // Troca de OLT invalida a CTO/porta escolhidas (são por OLT).
                  setEnclosureId('');
                  setSelectedCto(null);
                  setPortNumber('');
                }}
              >
                <option value="">{t('detail.select')}</option>
                {(olts ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.vendor})
                  </option>
                ))}
              </Select>
            </div>
          )}

          {/* ONT nova (instalação + troca) */}
          {needsOnt && (
            <div>
              <Label required>
                {t('detail.ontSerialLabel', {
                  label:
                    effectiveMode === 'SUPPORT_SWAP'
                      ? t('detail.ontNew')
                      : t('detail.ont'),
                })}
              </Label>
              {!bypass ? (
                <Combobox
                  value={serialItemId}
                  selectedOption={selectedOnt}
                  onChange={(id, opt) => {
                    setSerialItemId(id);
                    setSelectedOnt(opt);
                  }}
                  loadOptions={loadOntOptions}
                  placeholder={t('detail.ontStockSelect')}
                  searchPlaceholder={t('detail.ontSearch')}
                  emptyText={t('detail.ontSearchEmpty')}
                />
              ) : (
                <Input
                  value={snGpon}
                  onChange={(e) => setSnGpon(e.target.value)}
                  placeholder={t('detail.snGponPlaceholder')}
                  className="font-mono"
                />
              )}
              <label className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                <input
                  type="checkbox"
                  checked={bypass}
                  onChange={(e) => setBypass(e.target.checked)}
                />
                {t('detail.ontBypass')}
              </label>
            </div>
          )}

          {/* Caixa/porta (só instalação) — dropdowns das CTOs importadas da OLT */}
          {effectiveMode === 'INSTALLATION' && oltId && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label required={isUfinet}>{t('detail.boxCto')}</Label>
                {ctoCount === 0 ? (
                  <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    {t('detail.noCtoInOlt')}
                  </p>
                ) : (
                  <Combobox
                    value={enclosureId}
                    selectedOption={selectedCto}
                    onChange={(id, opt) => {
                      setEnclosureId(id);
                      setSelectedCto(opt);
                      setPortNumber('');
                    }}
                    loadOptions={loadCtoOptions}
                    resetKey={oltId}
                    placeholder={t('detail.select')}
                    searchPlaceholder={t('detail.ctoSearch')}
                    emptyText={t('detail.ctoSearchEmpty')}
                  />
                )}
              </div>
              <div>
                <Label>{t('detail.portUsed')}</Label>
                <Select
                  value={portNumber}
                  onChange={(e) => setPortNumber(e.target.value)}
                  disabled={!enclosureId}
                >
                  <option value="">
                    {enclosureId ? t('detail.portSelect') : t('detail.chooseCto')}
                  </option>
                  {(ports ?? []).map((p) => (
                    <option
                      key={p.id}
                      value={String(p.number)}
                      disabled={p.status === 'USED' || p.status === 'DAMAGED'}
                    >
                      {t('detail.portN', { n: p.number })}
                      {p.status === 'USED'
                        ? ` ${t('detail.portOccupied')}`
                        : p.status === 'DAMAGED'
                          ? ` ${t('detail.portDamaged')}`
                          : ''}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          {/* Local de devolução (troca + retirada) */}
          {needsReturn && (
            <div>
              <Label required>
                {t('detail.returnLocation')}{' '}
                {effectiveMode === 'SUPPORT_SWAP'
                  ? t('detail.returnLocationOld')
                  : t('detail.returnLocationEquip')}
              </Label>
              <Select
                value={returnLocationId}
                onChange={(e) => setReturnLocationId(e.target.value)}
              >
                <option value="">{t('detail.select')}</option>
                {(locations ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} · {l.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {/* Wi-Fi herda do contrato (definido no cadastro) — técnico não digita. */}
          {needsOnt && (
            <p className="rounded-md bg-slate-50 p-2 text-xs text-text-muted dark:bg-slate-800">
              {t('detail.wifiFromContract')}
            </p>
          )}

          {/* Materiais (instalação + suporte, opcional) */}
          {effectiveMode !== 'RETRIEVAL' && (
            <div>
              <div className="flex items-center justify-between">
                <Label>{t('detail.materials')}</Label>
                <Button type="button" variant="ghost" onClick={addMaterial}>
                  {t('detail.addMaterial')}
                </Button>
              </div>
              {materials.map((m, i) => (
                <div key={i} className="mt-2 grid grid-cols-12 gap-2">
                  <div className="col-span-5">
                    <Select
                      value={m.productId}
                      onChange={(e) => setMaterial(i, { productId: e.target.value })}
                    >
                      <option value="">{t('detail.product')}</option>
                      {(products ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="col-span-4">
                    <Select
                      value={m.locationId}
                      onChange={(e) => setMaterial(i, { locationId: e.target.value })}
                    >
                      <option value="">{t('detail.location')}</option>
                      {(locations ?? []).map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={String(m.quantity)}
                      onChange={(e) =>
                        setMaterial(i, { quantity: Number(e.target.value) })
                      }
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMaterial(i)}
                    className="col-span-1 text-danger"
                    aria-label={t('detail.remove')}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Fotos (sempre) */}
          <div>
            <Label>{t('detail.photos')}</Label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onPickPhoto}
              className="block w-full text-sm"
            />
            {photos.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {photos.map((p, i) => (
                  <span
                    key={p.storageKey}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-muted px-2 py-1 text-xs"
                  >
                    📷 {i + 1}
                    <button
                      type="button"
                      onClick={() =>
                        setPhotos((ps) => ps.filter((_, idx) => idx !== i))
                      }
                      className="text-danger"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Fechamento (sempre) */}
          <div>
            <Label htmlFor="close" required>
              {t('detail.closeDescription')}
            </Label>
            <Textarea
              id="close"
              rows={3}
              value={closeDescription}
              onChange={(e) => setCloseDescription(e.target.value)}
            />
          </div>

          {err && (
            <div className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {err}
            </div>
          )}

          <Button onClick={confirm} loading={busy} className="w-full">
            {effectiveMode === 'RETRIEVAL'
              ? t('detail.confirmRetrieval')
              : effectiveMode === 'SUPPORT'
                ? t('detail.confirmSupport')
                : effectiveMode === 'INSTALLATION'
                  ? t('detail.provision')
                  : t('detail.confirmInstall')}
          </Button>
          <FieldHelp>
            {effectiveMode === 'INSTALLATION' && t('detail.helpInstall')}
            {effectiveMode === 'SUPPORT_SWAP' && t('detail.helpSwap')}
            {effectiveMode === 'SUPPORT' && t('detail.helpSupport')}
            {effectiveMode === 'RETRIEVAL' && t('detail.helpRetrieval')}
          </FieldHelp>
        </section>
      )}

      {/* Mensagens + anexos — comunicação e documentos da O.S (sempre visível) */}
      <section className="space-y-2 rounded-lg border border-border bg-surface p-3">
        <h2 className="text-sm font-semibold text-text">{t('detail.messagesTitle')}</h2>
        <ServiceOrderMessages serviceOrderId={so.id} canWrite />
      </section>
      <section className="space-y-2 rounded-lg border border-border bg-surface p-3">
        <h2 className="text-sm font-semibold text-text">{t('detail.attachmentsTitle')}</h2>
        <ServiceOrderAttachments serviceOrderId={so.id} canWrite />
      </section>

      {/* Modal: voltar pra fila (cancelar deslocamento/execução) — exige motivo */}
      {returnOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-4">
            <h3 className="text-base font-semibold text-text">
              {so.status === 'EN_ROUTE'
                ? t('detail.cancelEnRoute')
                : t('detail.cancelExecution')}
            </h3>
            <p className="mt-1 text-xs text-text-muted">{t('detail.returnHelp')}</p>
            <div className="mt-3">
              <Label htmlFor="return-reason">{t('detail.returnReasonLabel')}</Label>
              <Textarea
                id="return-reason"
                rows={3}
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder={t('detail.returnReasonPlaceholder')}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setReturnOpen(false)}
                disabled={busy}
              >
                {t('detail.keepGoing')}
              </Button>
              <Button
                variant="danger"
                onClick={doReturnToQueue}
                loading={busy}
                disabled={!returnReason.trim()}
              >
                {t('detail.confirmReturn')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type TFn = ReturnType<typeof useTranslations>;

function eventTone(status: InstallTimelineEvent['status']): string {
  switch (status) {
    case 'SUCCESS':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'FAILED':
    case 'TIMEOUT':
      return 'text-red-600 dark:text-red-400';
    default:
      return 'text-amber-600 dark:text-amber-400';
  }
}

/**
 * Tela de confirmação da instalação (etapa 2 do one-touch). O técnico fica
 * "preso" aqui: vê o cliente subir online, pode trocar/re-tentar a ONT, e só
 * sai ao Finalizar (que fecha a O.S).
 */
function ProvisionConfirmation({
  contractId,
  timeline,
  closeDescription,
  setCloseDescription,
  busy,
  err,
  onRetry,
  onSwap,
  onFinalize,
  t,
}: {
  contractId: string;
  timeline: InstallTimelineEvent[] | null;
  closeDescription: string;
  setCloseDescription: (v: string) => void;
  busy: boolean;
  err: string | null;
  onRetry: () => void;
  onSwap: () => void;
  onFinalize: () => void;
  t: TFn;
}) {
  return (
    <section className="space-y-4 rounded-lg border-2 border-accent bg-surface p-3">
      <div>
        <h2 className="text-sm font-bold">{t('confirm.title')}</h2>
        <p className="mt-1 text-xs text-text-muted">{t('confirm.subtitle')}</p>
      </div>

      {/* Status online do cliente (atualiza sozinho). */}
      <ContractSessionCard contractId={contractId} />

      {/* Resultado do provisionamento. */}
      {timeline && timeline.length > 0 && (
        <ol className="space-y-1 rounded-md border border-border bg-surface-muted p-2 text-xs">
          {timeline.map((ev, i) => (
            <li key={i} className={eventTone(ev.status)}>
              <span className="font-medium">{ev.status}</span> · {ev.message}
              {ev.error ? ` — ${ev.error}` : ''}
            </li>
          ))}
        </ol>
      )}

      {/* Ações de recuperação. */}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={onSwap} disabled={busy}>
          {t('confirm.swap')}
        </Button>
        <Button variant="outline" onClick={onRetry} loading={busy}>
          {t('confirm.retry')}
        </Button>
      </div>

      <div>
        <Label htmlFor="close-confirm" required>
          {t('detail.closeDescription')}
        </Label>
        <Textarea
          id="close-confirm"
          rows={3}
          value={closeDescription}
          onChange={(e) => setCloseDescription(e.target.value)}
        />
      </div>

      {err && (
        <div className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {err}
        </div>
      )}

      <Button onClick={onFinalize} loading={busy} className="w-full">
        {t('confirm.finalize')}
      </Button>
      <FieldHelp>{t('confirm.help')}</FieldHelp>
    </section>
  );
}

interface SwapPayload {
  newSerialItemId: string;
  returnLocationId: string;
}

/** Modal de troca de ONT na confirmação: nova ONT (busca) + devolução. O Wi-Fi
 *  herda do contrato (definido no cadastro). */
function SwapOntModal({
  loadOntOptions,
  locations,
  onClose,
  onSwap,
  t,
}: {
  loadOntOptions: (q: string) => Promise<ComboboxOption[]>;
  locations: StockLocation[];
  onClose: () => void;
  onSwap: (payload: SwapPayload) => Promise<void>;
  t: TFn;
}) {
  const [serialItemId, setSerialItemId] = useState('');
  const [selected, setSelected] = useState<ComboboxOption | null>(null);
  const [returnLocationId, setReturnLocationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = !!serialItemId && !!returnLocationId;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setError(null);
    setBusy(true);
    try {
      await onSwap({
        newSerialItemId: serialItemId,
        returnLocationId,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t('confirm.swapTitle')}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs text-text-muted">{t('confirm.swapDesc')}</p>
        <div>
          <Label required>{t('confirm.swapNewOnt')}</Label>
          <Combobox
            value={serialItemId}
            selectedOption={selected}
            onChange={(idv, opt) => {
              setSerialItemId(idv);
              setSelected(opt);
            }}
            loadOptions={loadOntOptions}
            placeholder={t('detail.ontStockSelect')}
            searchPlaceholder={t('detail.ontSearch')}
            emptyText={t('detail.ontSearchEmpty')}
          />
        </div>
        <div>
          <Label required>{t('confirm.swapReturnLocation')}</Label>
          <Select value={returnLocationId} onChange={(e) => setReturnLocationId(e.target.value)} required>
            <option value="">{t('detail.ontStockSelect')}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>
        <p className="rounded-md bg-slate-50 p-2 text-xs text-text-muted dark:bg-slate-800">
          {t('detail.wifiFromContract')}
        </p>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t('detail.cancel')}
          </Button>
          <Button type="submit" loading={busy} disabled={!valid}>
            {t('confirm.swap')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
