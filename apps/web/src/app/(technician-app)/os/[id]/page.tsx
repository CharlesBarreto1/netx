'use client';

/**
 * /os/[id] — tela única do técnico em campo.
 *
 * Fluxo: a caminho (en-route) → check-in (IN_PROGRESS) → form único de
 * fechamento → confirma. No confirm, o backend "splita" tudo numa tacada
 * (provisiona + ativa contrato + RADIUS + TR-069 + estoque + Ufinet + fecha
 * a O.S) via /service-orders/:id/complete-installation.
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
import { stockApi } from '@/lib/stock-api';
import {
  serviceOrdersApi,
  type CompleteInstallationInput,
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
  const [caixa, setCaixa] = useState('');
  const [porta, setPorta] = useState('');
  const [ssid, setSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [closeDescription, setCloseDescription] = useState('');
  const [materials, setMaterials] = useState<FieldMaterialInput[]>([]);
  const [photos, setPhotos] = useState<ServiceOrderPhotoInput[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const selectedOlt = (olts ?? []).find((o) => o.id === oltId);
  const isUfinet =
    selectedOlt?.vendor === 'UFINET' &&
    selectedOlt?.providerMode === 'ORCHESTRATOR';

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
    setMaterials((m) => [
      ...m,
      { productId: '', locationId: '', quantity: 1 },
    ]);
  }
  function setMaterial(i: number, patch: Partial<FieldMaterialInput>) {
    setMaterials((m) =>
      m.map((it, idx) => (idx === i ? { ...it, ...patch } : it)),
    );
  }
  function removeMaterial(i: number) {
    setMaterials((m) => m.filter((_, idx) => idx !== i));
  }

  // ── confirmar (one-touch) ──
  function validate(): string | null {
    if (!oltId) return 'Escolha a OLT.';
    if (bypass && !snGpon.trim()) return 'Informe o serial GPON da ONT.';
    if (!bypass && !serialItemId) return 'Escolha a ONT do estoque (comodato).';
    if (!ssid.trim()) return 'Informe o nome da rede (SSID).';
    if (wifiPassword.trim().length < 8) return 'Senha Wi-Fi: mínimo 8 caracteres.';
    if (!closeDescription.trim()) return 'Descreva o fechamento.';
    for (const m of materials) {
      if (!m.productId || !m.locationId)
        return 'Materiais: selecione produto e local em todas as linhas.';
    }
    return null;
  }

  async function confirm() {
    const v = validate();
    if (v) {
      setErr(v);
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      const install: CompleteInstallationInput['install'] = {
        oltId,
        ssid: ssid.trim(),
        wifiPassword: wifiPassword.trim(),
        ...(bypass
          ? { allowStockBypass: true, snGpon: snGpon.trim() }
          : { serialItemId }),
        // Caixa/porta: Ufinet vai pra confirmação da ONT; OLT própria fica em notes.
        ...(isUfinet ? { ufinetCto: caixa || null, ufinetPort: porta || null } : {}),
        ...(!isUfinet && (caixa || porta)
          ? { notes: `Caixa: ${caixa || '—'} / Porta: ${porta || '—'}` }
          : {}),
      };
      const payload: CompleteInstallationInput = {
        install,
        materials,
        photos,
        closeDescription: closeDescription.trim(),
        ...(!isUfinet ? { enclosurePort: porta || null } : {}),
      };
      const res = await serviceOrdersApi.completeInstallation(id, payload);
      if (res.install.status === 'FAILED') {
        toast.error('Provisionamento falhou — veja a timeline.');
      } else {
        toast.success('Instalação concluída! 🎉');
        router.replace('/os');
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.friendlyMessage : 'Erro ao finalizar');
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !so) return <PageLoader label="Carregando O.S…" />;

  return (
    <div className="space-y-4">
      <Link href="/os" className="text-sm text-text-subtle hover:text-text">
        ← Minhas O.S
      </Link>

      <header className="rounded-lg border border-border bg-surface p-3">
        <div className="flex items-center justify-between">
          <span className="font-mono font-semibold">{so.code ?? '—'}</span>
          <span className="text-2xs uppercase tracking-wider text-text-subtle">
            {so.status}
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

      {/* ── Form único de fechamento (em execução) ── */}
      {isInProgress && (
        <section className="space-y-4 rounded-lg border border-border bg-surface p-3">
          <h2 className="text-sm font-bold">Fechamento da instalação</h2>

          <div>
            <Label htmlFor="olt" required>
              OLT
            </Label>
            <Select
              id="olt"
              value={oltId}
              onChange={(e) => setOltId(e.target.value)}
            >
              <option value="">— selecione —</option>
              {(olts ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.vendor})
                </option>
              ))}
            </Select>
          </div>

          {/* ONT */}
          <div>
            <Label required>ONT (serial GPON)</Label>
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

          {/* Caixa / porta (adaptativo pela OLT) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{isUfinet ? 'Caixa Ufinet (CTO)' : 'Caixa usada (CTO)'}</Label>
              <Input value={caixa} onChange={(e) => setCaixa(e.target.value)} />
            </div>
            <div>
              <Label>Porta usada</Label>
              <Input value={porta} onChange={(e) => setPorta(e.target.value)} />
            </div>
          </div>
          {!isUfinet && (
            <FieldHelp>
              OLT própria: caixa/porta ficam registradas na O.S (vínculo
              ONT↔porta cadastrada chega numa próxima versão).
            </FieldHelp>
          )}

          {/* Wi-Fi */}
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

          {/* Materiais */}
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
                    onChange={(e) =>
                      setMaterial(i, { locationId: e.target.value })
                    }
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

          {/* Fotos */}
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

          {/* Fechamento */}
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
            ✅ Confirmar instalação (one-touch)
          </Button>
          <FieldHelp>
            Ao confirmar: ativa o contrato, movimenta o estoque, provisiona,
            vincula a ONT ao TR-069 e finaliza a O.S — tudo de uma vez.
          </FieldHelp>
        </section>
      )}
    </div>
  );
}
