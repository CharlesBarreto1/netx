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
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import {
  FieldHelp,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError, api } from '@/lib/api';
import { opticalApi, type OpticalPort } from '@/lib/optical-api';
import { stockApi } from '@/lib/stock-api';
import {
  serviceOrdersApi,
  type CompleteFieldInput,
  type FieldMaterialInput,
  type ServiceOrderPhotoInput,
  type ServiceOrderResponse,
} from '@/lib/service-orders-api';

type OltOption = {
  id: string;
  name: string;
  vendor: string;
  providerMode: string;
};

function genPassword() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++)
    out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export default function OsDetailPage() {
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
  const [bypass, setBypass] = useState(false);
  const [snGpon, setSnGpon] = useState('');
  const [enclosureId, setEnclosureId] = useState(''); // CTO importada (Ufinet/própria)
  const [portNumber, setPortNumber] = useState(''); // porta da CTO escolhida
  const [ssid, setSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [returnLocationId, setReturnLocationId] = useState('');
  const [swappedOnt, setSwappedOnt] = useState(false); // suporte: trocou ONT?
  const [closeDescription, setCloseDescription] = useState('');
  const [materials, setMaterials] = useState<FieldMaterialInput[]>([]);
  const [photos, setPhotos] = useState<ServiceOrderPhotoInput[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const selectedOlt = (olts ?? []).find((o) => o.id === oltId);
  const isUfinet =
    selectedOlt?.vendor === 'UFINET' &&
    selectedOlt?.providerMode === 'ORCHESTRATOR';

  // CTOs importadas (OpticalEnclosure) da OLT escolhida — fonte de verdade da
  // caixa/porta real (Ufinet importou todas no NetX). Evita campo livre.
  const { data: enclosuresResp } = useSWR(
    oltId ? opticalApi.listPath({ oltId, pageSize: 500 }) : null,
  );
  const enclosures = (enclosuresResp as { data?: { id: string; code: string }[] } | undefined)?.data ?? [];
  // Portas da CTO escolhida (status livre/usada) — valida a porta.
  const { data: ports } = useSWR<OpticalPort[]>(
    enclosureId ? opticalApi.portsPath(enclosureId) : null,
  );
  const selectedEnclosure = enclosures.find((c) => c.id === enclosureId);

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
    setBusy(true);
    try {
      await serviceOrdersApi.enRoute(id);
      await mutate();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.friendlyMessage : 'Erro');
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
      toast.error(e instanceof ApiError ? e.friendlyMessage : 'Erro');
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
      if (!put.ok) throw new Error(`upload falhou (${put.status})`);
      setPhotos((p) => [
        ...p,
        { storageKey, contentType: file.type || null, sizeBytes: file.size },
      ]);
      toast.success('Foto enviada');
    } catch (er) {
      toast.error(er instanceof Error ? er.message : 'Falha no upload');
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
  function buildPayload(): { payload: CompleteFieldInput } | { error: string } {
    if (!closeDescription.trim()) return { error: 'Descreva o fechamento.' };
    for (const m of materials) {
      if (!m.productId || !m.locationId)
        return { error: 'Materiais: selecione produto e local em todas as linhas.' };
    }
    const ontFields = () => {
      if (bypass && !snGpon.trim()) return 'Informe o serial GPON da ONT.';
      if (!bypass && !serialItemId) return 'Escolha a ONT do estoque (comodato).';
      if (!ssid.trim()) return 'Informe o nome da rede (SSID).';
      if (wifiPassword.trim().length < 8) return 'Senha Wi-Fi: mínimo 8 caracteres.';
      return null;
    };

    if (effectiveMode === 'INSTALLATION') {
      if (!oltId) return { error: 'Escolha a OLT.' };
      const e = ontFields();
      if (e) return { error: e };
      if (isUfinet && !enclosureId)
        return { error: 'Escolha a caixa (CTO) que atende o cliente.' };
      const ctoCode = selectedEnclosure?.code ?? null;
      return {
        payload: {
          mode: 'INSTALLATION',
          install: {
            oltId,
            ssid: ssid.trim(),
            wifiPassword: wifiPassword.trim(),
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
        return { error: 'Escolha o local de devolução da ONT antiga.' };
      const e = ontFields();
      if (e) return { error: e };
      return {
        payload: {
          mode: 'SUPPORT_SWAP',
          swap: {
            returnLocationId,
            ssid: ssid.trim(),
            wifiPassword: wifiPassword.trim(),
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
        return { error: 'Escolha o local de devolução do equipamento.' };
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
    const r = buildPayload();
    if ('error' in r) {
      setErr(r.error);
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await serviceOrdersApi.completeField(id, r.payload);
      toast.success('O.S finalizada! 🎉');
      router.replace('/os');
    } catch (e) {
      setErr(e instanceof ApiError ? e.friendlyMessage : 'Erro ao finalizar');
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !so) return <PageLoader label="Carregando O.S…" />;

  const KIND_LABEL = {
    INSTALLATION: 'Instalação',
    SUPPORT: 'Suporte',
    RETRIEVAL: 'Retirada',
  }[kind];

  return (
    <div className="space-y-4">
      <Link href="/os" className="text-sm text-text-subtle hover:text-text">
        ← Minhas O.S
      </Link>

      <header className="rounded-lg border border-border bg-surface p-3">
        <div className="flex items-center justify-between">
          <span className="font-mono font-semibold">{so.code ?? '—'}</span>
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-semibold uppercase tracking-wider text-text-subtle">
            {KIND_LABEL}
          </span>
        </div>
        <div className="mt-1 text-sm font-medium">
          {so.customer?.displayName ?? 'Cliente'}
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
          🚗 Iniciar deslocamento
        </Button>
      )}
      {so.status === 'EN_ROUTE' && (
        <Button onClick={doCheckin} loading={busy} className="w-full">
          📍 Cheguei — fazer check-in
        </Button>
      )}
      {so.status === 'COMPLETED' && (
        <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200">
          ✅ O.S concluída
          {so.closeDescription ? ` — ${so.closeDescription}` : ''}.
        </div>
      )}

      {/* ── Form de fechamento (em execução) ── */}
      {isInProgress && (
        <section className="space-y-4 rounded-lg border border-border bg-surface p-3">
          <h2 className="text-sm font-bold">Fechamento — {KIND_LABEL}</h2>

          {/* Suporte: trocou ONT? */}
          {kind === 'SUPPORT' && (
            <div className="rounded-md border border-border p-2">
              <Label>Precisou trocar a ONT?</Label>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => setSwappedOnt(false)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm ${!swappedOnt ? 'border-accent bg-accent-muted text-text' : 'border-border text-text-muted'}`}
                >
                  Não
                </button>
                <button
                  type="button"
                  onClick={() => setSwappedOnt(true)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm ${swappedOnt ? 'border-accent bg-accent-muted text-text' : 'border-border text-text-muted'}`}
                >
                  Sim — trocar ONT
                </button>
              </div>
            </div>
          )}

          {/* OLT (só instalação) */}
          {effectiveMode === 'INSTALLATION' && (
            <div>
              <Label htmlFor="olt" required>
                OLT
              </Label>
              <Select id="olt" value={oltId} onChange={(e) => setOltId(e.target.value)}>
                <option value="">— selecione —</option>
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
              <Label required>{effectiveMode === 'SUPPORT_SWAP' ? 'ONT nova' : 'ONT'} (serial GPON)</Label>
              {!bypass ? (
                <Select
                  value={serialItemId}
                  onChange={(e) => setSerialItemId(e.target.value)}
                >
                  <option value="">— escolha do estoque (comodato) —</option>
                  {(serials ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.serial} · {s.product.name} ({s.location.code})
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={snGpon}
                  onChange={(e) => setSnGpon(e.target.value)}
                  placeholder="Serial GPON (ex.: 48575443...)"
                  className="font-mono"
                />
              )}
              <label className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                <input
                  type="checkbox"
                  checked={bypass}
                  onChange={(e) => setBypass(e.target.checked)}
                />
                ONT fora do estoque (digitar serial manualmente)
              </label>
            </div>
          )}

          {/* Caixa/porta (só instalação) — dropdowns das CTOs importadas da OLT */}
          {effectiveMode === 'INSTALLATION' && oltId && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label required={isUfinet}>Caixa (CTO)</Label>
                <Select
                  value={enclosureId}
                  onChange={(e) => {
                    setEnclosureId(e.target.value);
                    setPortNumber('');
                  }}
                >
                  <option value="">
                    {enclosures.length ? '— selecione —' : 'nenhuma CTO nesta OLT'}
                  </option>
                  {enclosures.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Porta usada</Label>
                <Select
                  value={portNumber}
                  onChange={(e) => setPortNumber(e.target.value)}
                  disabled={!enclosureId}
                >
                  <option value="">
                    {enclosureId ? '— porta —' : 'escolha a CTO'}
                  </option>
                  {(ports ?? []).map((p) => (
                    <option
                      key={p.id}
                      value={String(p.number)}
                      disabled={p.status === 'USED' || p.status === 'DAMAGED'}
                    >
                      Porta {p.number}
                      {p.status === 'USED'
                        ? ' (ocupada)'
                        : p.status === 'DAMAGED'
                          ? ' (danificada)'
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
                Local de devolução{' '}
                {effectiveMode === 'SUPPORT_SWAP' ? '(ONT antiga)' : '(equipamento)'}
              </Label>
              <Select
                value={returnLocationId}
                onChange={(e) => setReturnLocationId(e.target.value)}
              >
                <option value="">— selecione —</option>
                {(locations ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} · {l.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {/* Wi-Fi (instalação + troca) */}
          {needsOnt && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="ssid" required>
                  Nome da rede (SSID)
                </Label>
                <Input
                  id="ssid"
                  value={ssid}
                  onChange={(e) => setSsid(e.target.value)}
                  maxLength={32}
                />
              </div>
              <div>
                <Label htmlFor="wifi" required>
                  Senha Wi-Fi
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="wifi"
                    value={wifiPassword}
                    onChange={(e) => setWifiPassword(e.target.value)}
                    className="font-mono"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setWifiPassword(genPassword())}
                  >
                    Gerar
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Materiais (instalação + suporte, opcional) */}
          {effectiveMode !== 'RETRIEVAL' && (
            <div>
              <div className="flex items-center justify-between">
                <Label>Materiais usados</Label>
                <Button type="button" variant="ghost" onClick={addMaterial}>
                  + Material
                </Button>
              </div>
              {materials.map((m, i) => (
                <div key={i} className="mt-2 grid grid-cols-12 gap-2">
                  <div className="col-span-5">
                    <Select
                      value={m.productId}
                      onChange={(e) => setMaterial(i, { productId: e.target.value })}
                    >
                      <option value="">Produto</option>
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
                      <option value="">Local</option>
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
                    aria-label="Remover"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Fotos (sempre) */}
          <div>
            <Label>Fotos</Label>
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
              Descrição de fechamento
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
              ? '✅ Confirmar retirada'
              : effectiveMode === 'SUPPORT'
                ? '✅ Finalizar atendimento'
                : '✅ Confirmar (one-touch)'}
          </Button>
          <FieldHelp>
            {effectiveMode === 'INSTALLATION' &&
              'Ativa o contrato, movimenta o estoque, provisiona, vincula ao TR-069 e fecha a O.S — tudo de uma vez.'}
            {effectiveMode === 'SUPPORT_SWAP' &&
              'Devolve a ONT antiga ao estoque, provisiona a nova (rede/TR-069) e fecha a O.S.'}
            {effectiveMode === 'SUPPORT' &&
              'Registra o atendimento (materiais/fotos) e fecha a O.S, sem mexer no provisionamento.'}
            {effectiveMode === 'RETRIEVAL' &&
              'Recolhe o equipamento ao estoque, desprovisiona e encerra o contrato.'}
          </FieldHelp>
        </section>
      )}
    </div>
  );
}
