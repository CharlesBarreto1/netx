'use client';

/**
 * /olts — CRUD admin de OLTs. Restrito a `olts.admin` (creds SSH/API
 * são sensíveis).
 *
 * Suporta dois modos: DIRECT (SSH em OLT real) e ORCHESTRATOR (API tipo
 * Ufinet). Form troca campos visíveis baseado no providerMode.
 */
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

import type { LatLng } from '@/components/mapping/LocationPicker';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FieldHelp, Input, Label, Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';

const LocationPicker = dynamic(
  () =>
    import('@/components/mapping/LocationPicker').then((m) => m.LocationPicker),
  {
    ssr: false,
    loading: () => (
      <div className="h-[320px] animate-pulse rounded-md bg-surface-muted" />
    ),
  },
);
import {
  oltsApi,
  type CreateOltRequest,
  type Olt,
  type OltProviderMode,
  type OltStatus,
  type OltVendor,
} from '@/lib/provisioning-api';

const VENDORS: OltVendor[] = [
  'HUAWEI', 'ZTE', 'DATACOM', 'FIBERHOME', 'NOKIA', 'PARKS', 'UFINET', 'GENERIC',
];

function statusColor(s: OltStatus): string {
  switch (s) {
    case 'ONLINE':      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    case 'OFFLINE':     return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    case 'UNREACHABLE': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
    default:            return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
}

export default function OltsPage() {
  const canAdmin = hasPermission('olts.admin');
  const { data, isLoading, mutate } = useSWR('olts', () => oltsApi.list({ pageSize: 100 }));
  const [editing, setEditing] = useState<Olt | null>(null);
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null);

  if (isLoading) return <PageLoader />;
  const olts = data?.data ?? [];

  async function handleTest(id: string) {
    setTesting(id);
    setTestResult(null);
    try {
      const r = await oltsApi.testConnection(id);
      setTestResult({ id, ok: r.success, msg: `${r.message} (${r.durationMs}ms)` });
      await mutate();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'erro';
      setTestResult({ id, ok: false, msg });
    } finally {
      setTesting(null);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">OLTs</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            OLTs diretas (SSH) e orquestradores externos (Ufinet API). Credenciais
            são criptografadas at-rest com KMS.
          </p>
        </div>
        {canAdmin && (
          <Button onClick={() => setCreating(true)}>Nova OLT</Button>
        )}
      </header>

      {olts.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Nenhuma OLT cadastrada. Clique &quot;Nova OLT&quot; pra cadastrar.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Nome</th>
                <th className="px-3 py-2 text-left font-medium">Vendor/Modelo</th>
                <th className="px-3 py-2 text-left font-medium">Modo</th>
                <th className="px-3 py-2 text-left font-medium">Endpoint</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {olts.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-900">
                  <td className="px-3 py-2 font-medium">{o.name}</td>
                  <td className="px-3 py-2">
                    <span className="text-xs text-slate-500">{o.vendor}</span>{' '}
                    {o.model}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs">{o.providerMode}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {o.providerMode === 'DIRECT'
                      ? o.managementIp
                      : o.providerMode === 'EXTERNAL'
                        ? <span className="italic text-slate-500">— (manual)</span>
                        : o.apiEndpoint}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(o.status)}`}>
                      {o.status}
                    </span>
                    {testResult?.id === o.id && (
                      <p className={`mt-1 text-xs ${testResult.ok ? 'text-green-600' : 'text-red-600'}`}>
                        {testResult.msg}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {canAdmin && (
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={testing === o.id}
                          onClick={() => handleTest(o.id)}
                        >
                          Testar
                        </Button>
                      )}
                      <Link href={`/olts/${o.id}`}>
                        <Button size="sm" variant="outline">
                          Portas PON
                        </Button>
                      </Link>
                      {canAdmin && (
                        <Button size="sm" variant="ghost" onClick={() => setEditing(o)}>
                          Editar
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <OltFormModal
          olt={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await mutate();
          }}
        />
      )}
    </div>
  );
}

interface OltFormModalProps {
  olt: Olt | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

function OltFormModal({ olt, onClose, onSaved }: OltFormModalProps) {
  const [form, setForm] = useState<CreateOltRequest>({
    name: olt?.name ?? '',
    vendor: olt?.vendor ?? 'HUAWEI',
    model: olt?.model ?? '',
    // EXTERNAL como default — útil pra MVP onde Ufinet/OLT são manuais.
    // DIRECT/ORCHESTRATOR exigem implementação de driver (Fase 2/BR).
    providerMode: olt?.providerMode ?? 'EXTERNAL',
    managementIp: olt?.managementIp ?? null,
    sshPort: olt?.sshPort ?? 22,
    sshUser: olt?.sshUser ?? null,
    sshPassword: null, // sempre vazio em edit; envia só se preencher
    apiEndpoint: olt?.apiEndpoint ?? null,
    apiAuthType: olt?.apiAuthType ?? null,
    apiCredentials: null,
    serviceVlanId: olt?.serviceVlanId ?? null,
    defaultUpProfile: olt?.defaultUpProfile ?? null,
    defaultDownProfile: olt?.defaultDownProfile ?? null,
  });
  // Geolocalização — null se ainda não marcada no mapa.
  const [location, setLocation] = useState<LatLng | null>(
    olt?.latitude != null && olt?.longitude != null
      ? { latitude: olt.latitude, longitude: olt.longitude }
      : null,
  );
  // Config estruturada da Ufinet (apiConfig, não-secreta) — cada polígono Ufinet
  // é uma OLT. Segredos (clientId/clientSecret/accessKey) vão em apiCredentials.
  const initCfg = (olt?.apiConfig ?? {}) as Record<string, string | undefined>;
  const [ufinet, setUfinet] = useState({
    operator: initCfg.operator ?? '',
    region: initCfg.region ?? '',
    contractId: initCfg.contractId ?? '',
    polygonAlias: initCfg.polygonAlias ?? '',
    userName: initCfg.userName ?? '',
    country: initCfg.country ?? 'Paraguay',
    city: initCfg.city ?? '',
    nms: initCfg.nms ?? 'HUAWEI-NCE',
    nmsId: initCfg.nmsId ?? '2',
    bandwidthProfile: initCfg.bandwidthProfile ?? 'ZUX 1G',
    bandwidthProfileId: initCfg.bandwidthProfileId ?? '499',
    scope: initCfg.scope ?? '',
    tokenUrl:
      initCfg.tokenUrl ??
      'https://login.microsoftonline.com/7820112f-0e93-4eca-9b2f-88061e82e876/oauth2/v2.0/token',
  });
  const [ufinetCreds, setUfinetCreds] = useState({ clientId: '', clientSecret: '', accessKey: '' });
  const setUf = (k: keyof typeof ufinet, v: string) => setUfinet((s) => ({ ...s, [k]: v }));
  const setCred = (k: keyof typeof ufinetCreds, v: string) =>
    setUfinetCreds((s) => ({ ...s, [k]: v }));
  const isUfinet = form.vendor === 'UFINET' && form.providerMode === 'ORCHESTRATOR';
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // Strip senha vazia em edit (não sobrescreve a existente)
      const payload: CreateOltRequest = {
        ...form,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
      };
      if (olt && (payload.sshPassword === '' || payload.sshPassword == null)) {
        delete (payload as Partial<CreateOltRequest>).sshPassword;
      }
      if (isUfinet) {
        payload.apiAuthType = 'OAUTH2';
        payload.apiConfig = { ...ufinet };
        // Credenciais: só envia se preencheu (em edit, vazio = mantém as atuais).
        const hasCreds = ufinetCreds.clientId || ufinetCreds.clientSecret || ufinetCreds.accessKey;
        if (hasCreds) {
          payload.apiCredentials = { ...ufinetCreds };
        } else {
          delete (payload as Partial<CreateOltRequest>).apiCredentials;
        }
      }
      if (olt) {
        await oltsApi.update(olt.id, payload);
      } else {
        await oltsApi.create(payload);
      }
      await onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'erro';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  const set = <K extends keyof CreateOltRequest>(k: K, v: CreateOltRequest[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal open onClose={onClose} title={olt ? 'Editar OLT' : 'Nova OLT'}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="name">Nome *</Label>
            <Input id="name" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="OLT POP-Centro" />
          </div>
          <div>
            <Label htmlFor="vendor">Vendor *</Label>
            <Select id="vendor" value={form.vendor} onChange={(e) => set('vendor', e.target.value as OltVendor)}>
              {VENDORS.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="model">Modelo *</Label>
            <Input id="model" required value={form.model} onChange={(e) => set('model', e.target.value)} placeholder="MA5800-X7" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="providerMode">Modo *</Label>
            <Select id="providerMode" value={form.providerMode} onChange={(e) => set('providerMode', e.target.value as OltProviderMode)}>
              <option value="EXTERNAL">EXTERNAL (provisão manual fora do NetX — Ufinet manual, web OLT, etc)</option>
              <option value="DIRECT">DIRECT (NetX fala SSH/NETCONF na OLT)</option>
              <option value="ORCHESTRATOR">ORCHESTRATOR (Ufinet API ou outro provider)</option>
            </Select>
            {form.providerMode === 'EXTERNAL' && (
              <p className="mt-1 text-xs text-slate-500">
                NetX só registra a ONT no banco e segue pra RADIUS + TR-069.
                Você é responsável por provisionar SN na OLT real (Ufinet, NMS, etc).
              </p>
            )}
          </div>

          {form.providerMode === 'EXTERNAL' ? (
            <div className="sm:col-span-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
              ℹ️ Em modo <strong>EXTERNAL</strong> não há credenciais — NetX não
              conecta diretamente na OLT. Cadastre apenas nome/vendor/modelo pra
              inventário e use no fluxo de provisionamento normal.
            </div>
          ) : form.providerMode === 'DIRECT' ? (
            <>
              <div className="sm:col-span-2"><h3 className="text-xs font-semibold uppercase text-slate-500">SSH</h3></div>
              <div>
                <Label htmlFor="managementIp">IP de gerência *</Label>
                <Input id="managementIp" required value={form.managementIp ?? ''} onChange={(e) => set('managementIp', e.target.value)} placeholder="10.0.0.1" />
              </div>
              <div>
                <Label htmlFor="sshPort">Porta SSH</Label>
                <Input id="sshPort" type="number" value={form.sshPort ?? 22} onChange={(e) => set('sshPort', Number(e.target.value))} />
              </div>
              <div>
                <Label htmlFor="sshUser">Usuário *</Label>
                <Input id="sshUser" required value={form.sshUser ?? ''} onChange={(e) => set('sshUser', e.target.value)} />
              </div>
              <div>
                <Label htmlFor="sshPassword">Senha {olt ? '(deixe vazio pra manter)' : '*'}</Label>
                <Input id="sshPassword" type="password" required={!olt} value={form.sshPassword ?? ''} onChange={(e) => set('sshPassword', e.target.value)} />
              </div>
            </>
          ) : (
            <>
              <div className="sm:col-span-2"><h3 className="text-xs font-semibold uppercase text-slate-500">API orquestrador</h3></div>
              <div className="sm:col-span-2">
                <Label htmlFor="apiEndpoint">Endpoint *</Label>
                <Input id="apiEndpoint" required value={form.apiEndpoint ?? ''} onChange={(e) => set('apiEndpoint', e.target.value)} placeholder="https://apim-ufinet-qa.azure-api.net/multiop/" />
              </div>

              {isUfinet ? (
                <>
                  <div className="sm:col-span-2">
                    <FieldHelp>
                      Rede neutra Ufinet (TMF). Cada <strong>polígono</strong> Ufinet é uma OLT.
                      As credenciais são criptografadas; em edição, deixe-as vazias pra manter.
                    </FieldHelp>
                  </div>
                  <div>
                    <Label htmlFor="uf-operator">Operator *</Label>
                    <Input id="uf-operator" required value={ufinet.operator} onChange={(e) => setUf('operator', e.target.value)} placeholder="ZUX_PY" />
                  </div>
                  <div>
                    <Label htmlFor="uf-region">Region *</Label>
                    <Input id="uf-region" required value={ufinet.region} onChange={(e) => setUf('region', e.target.value)} placeholder="MQN-PY" />
                  </div>
                  <div>
                    <Label htmlFor="uf-contractId">contractId TMF *</Label>
                    <Input id="uf-contractId" required value={ufinet.contractId} onChange={(e) => setUf('contractId', e.target.value)} placeholder="FTTH_ZUX_PY" />
                  </div>
                  <div>
                    <Label htmlFor="uf-polygon">Polygon alias</Label>
                    <Input id="uf-polygon" value={ufinet.polygonAlias} onChange={(e) => setUf('polygonAlias', e.target.value)} placeholder="JLMPY-MALLORQUIN" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="uf-userName">Usuário API (username) *</Label>
                    <Input id="uf-userName" required value={ufinet.userName} onChange={(e) => setUf('userName', e.target.value)} placeholder="ufinet.api@multiopufinet.onmicrosoft.com" />
                  </div>
                  <div>
                    <Label htmlFor="uf-country">País</Label>
                    <Input id="uf-country" value={ufinet.country} onChange={(e) => setUf('country', e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="uf-city">Cidade</Label>
                    <Input id="uf-city" value={ufinet.city} onChange={(e) => setUf('city', e.target.value)} placeholder="MALLORQUIN" />
                  </div>
                  <div>
                    <Label htmlFor="uf-nms">NMS</Label>
                    <Input id="uf-nms" value={ufinet.nms} onChange={(e) => setUf('nms', e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="uf-nmsId">NMS id</Label>
                    <Input id="uf-nmsId" value={ufinet.nmsId} onChange={(e) => setUf('nmsId', e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="uf-bw">Bandwidth profile</Label>
                    <Input id="uf-bw" value={ufinet.bandwidthProfile} onChange={(e) => setUf('bandwidthProfile', e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="uf-bwId">Bandwidth profile id</Label>
                    <Input id="uf-bwId" value={ufinet.bandwidthProfileId} onChange={(e) => setUf('bandwidthProfileId', e.target.value)} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="uf-scope">OAuth scope *</Label>
                    <Input id="uf-scope" required value={ufinet.scope} onChange={(e) => setUf('scope', e.target.value)} placeholder="api://ufinet.com/ZuxNet/qa/.default" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="uf-tokenUrl">Token URL (OAuth)</Label>
                    <Input id="uf-tokenUrl" value={ufinet.tokenUrl} onChange={(e) => setUf('tokenUrl', e.target.value)} />
                  </div>

                  <div className="sm:col-span-2"><h3 className="text-xs font-semibold uppercase text-slate-500">Credenciais (cifradas)</h3></div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="uf-clientId">client_id {olt ? '(vazio = manter)' : '*'}</Label>
                    <Input id="uf-clientId" value={ufinetCreds.clientId} onChange={(e) => setCred('clientId', e.target.value)} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="uf-clientSecret">client_secret {olt ? '(vazio = manter)' : '*'}</Label>
                    <Input id="uf-clientSecret" type="password" value={ufinetCreds.clientSecret} onChange={(e) => setCred('clientSecret', e.target.value)} />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="uf-accessKey">Access key {olt ? '(vazio = manter)' : '*'}</Label>
                    <Input id="uf-accessKey" type="password" value={ufinetCreds.accessKey} onChange={(e) => setCred('accessKey', e.target.value)} />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <Label htmlFor="apiAuthType">Auth *</Label>
                    <Select id="apiAuthType" value={form.apiAuthType ?? 'API_KEY'} onChange={(e) => set('apiAuthType', e.target.value as 'OAUTH2' | 'API_KEY' | 'MTLS')}>
                      <option value="API_KEY">API_KEY</option>
                      <option value="OAUTH2">OAUTH2</option>
                      <option value="MTLS">MTLS</option>
                    </Select>
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="apiCredentialsJson">Credenciais (JSON)</Label>
                    <textarea
                      id="apiCredentialsJson"
                      rows={3}
                      className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-xs shadow-sm dark:border-slate-700 dark:bg-slate-800"
                      placeholder='{ "apiKey": "..." } ou { "clientId":"...", "clientSecret":"..." }'
                      onChange={(e) => {
                        try {
                          set('apiCredentials', e.target.value ? JSON.parse(e.target.value) : null);
                          setError(null);
                        } catch {
                          setError('JSON inválido');
                        }
                      }}
                    />
                  </div>
                </>
              )}
            </>
          )}

          <div className="sm:col-span-2"><h3 className="text-xs font-semibold uppercase text-slate-500">Defaults</h3></div>
          <div>
            <Label htmlFor="serviceVlanId">VLAN serviço</Label>
            <Input id="serviceVlanId" type="number" value={form.serviceVlanId ?? ''} onChange={(e) => set('serviceVlanId', e.target.value ? Number(e.target.value) : null)} />
          </div>
          <div></div>
          <div>
            <Label htmlFor="defaultUpProfile">Profile upload</Label>
            <Input id="defaultUpProfile" value={form.defaultUpProfile ?? ''} onChange={(e) => set('defaultUpProfile', e.target.value || null)} />
          </div>
          <div>
            <Label htmlFor="defaultDownProfile">Profile download</Label>
            <Input id="defaultDownProfile" value={form.defaultDownProfile ?? ''} onChange={(e) => set('defaultDownProfile', e.target.value || null)} />
          </div>

          <div className="sm:col-span-2"><h3 className="text-xs font-semibold uppercase text-slate-500">Ubicación</h3></div>
          <div className="sm:col-span-2">
            <FieldHelp>
              Clic en el mapa para fijar la OLT, o &quot;Mi ubicación&quot;
              si estás físicamente en el POP. Aparece en /mapping/network.
            </FieldHelp>
            <LocationPicker value={location} onChange={setLocation} />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={saving}>{olt ? 'Salvar' : 'Criar'}</Button>
        </div>
      </form>
    </Modal>
  );
}
