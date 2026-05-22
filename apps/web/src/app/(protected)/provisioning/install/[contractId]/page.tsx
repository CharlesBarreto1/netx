'use client';

/**
 * /provisioning/install/[contractId] — formulário mobile-first do técnico
 * pra ativar um cliente em campo.
 *
 * Fluxo:
 *   1. Técnico abre via QR/link da página /provisioning/pending
 *   2. Vê dados do contrato (cliente, endereço, plano)
 *   3. Seleciona OLT, digita SN GPON da ONT, define Wi-Fi
 *   4. Clica "Ativar" → backend orquestra OLT+RADIUS+TR-069
 *   5. UI mostra timeline ao vivo dos passos
 */
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import {
  oltsApi,
  provisioningApi,
  type InstallCustomerResponse,
  type InstallTimelineEvent,
  type Olt,
} from '@/lib/provisioning-api';
import { stockApi, type ComodatoAvailableSerial } from '@/lib/stock-api';

function generatePassword(): string {
  // 10 chars, sem ambíguos (0/O, 1/l) — fácil de ditar no campo
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  const arr = new Uint8Array(10);
  crypto.getRandomValues(arr);
  for (let i = 0; i < arr.length; i++) out += alphabet[arr[i] % alphabet.length];
  return out;
}

function statusBadgeColor(status: InstallTimelineEvent['status']): string {
  switch (status) {
    case 'SUCCESS': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    case 'FAILED':  return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    case 'TIMEOUT': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
    default:        return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  }
}

export default function InstallPage() {
  const params = useParams();
  const router = useRouter();
  const contractId = params.contractId as string;

  // OLTs cadastradas pra dropdown
  const { data: oltsResp, isLoading: oltsLoading } = useSWR(
    'olts',
    () => oltsApi.list({ pageSize: 100 }),
  );
  const olts: Olt[] = oltsResp?.data ?? [];

  // Equipamentos PATRIMONIAIS disponíveis em estoque (filtrados por ACL no backend)
  const { data: availableSerials } = useSWR<ComodatoAvailableSerial[]>(
    'comodato/available',
    () => stockApi.listComodatoAvailable(),
  );

  // Form state
  const [oltId, setOltId] = useState('');
  const [serialItemId, setSerialItemId] = useState('');
  const [allowStockBypass, setAllowStockBypass] = useState(false);
  const [snGpon, setSnGpon] = useState('');
  const [ponFrame, setPonFrame] = useState('0');
  const [ponSlot, setPonSlot] = useState('1');
  const [macAddress, setMacAddress] = useState('');
  const [serialPhysical, setSerialPhysical] = useState('');
  const [ssid, setSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  // VLAN da WAN PPPoE — preset da OLT já vem com 1010; reaplicado via TR-069.
  const [pppoeVlan, setPppoeVlan] = useState('1010');
  // Modo Wi-Fi — depende do modelo da ONT (band steering x dual band).
  const [wifiBandMode, setWifiBandMode] = useState<'BAND_STEERING' | 'DUAL_BAND'>(
    'BAND_STEERING',
  );
  const [notes, setNotes] = useState('');

  // Result state
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<InstallCustomerResponse | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (oltsLoading) return <PageLoader />;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await provisioningApi.install(contractId, {
        oltId,
        serialItemId: allowStockBypass ? null : serialItemId || null,
        allowStockBypass,
        snGpon: allowStockBypass ? snGpon.trim().toUpperCase() : null,
        ponFrame: ponFrame ? Number(ponFrame) : null,
        ponSlot: ponSlot ? Number(ponSlot) : null,
        macAddress: macAddress.trim() || null,
        serialPhysical: serialPhysical.trim() || null,
        ssid: ssid.trim(),
        wifiPassword,
        pppoeVlan: Number(pppoeVlan) || 1010,
        wifiBandMode,
        notes: notes.trim() || null,
      });
      setResult(res);
    } catch (err) {
      const msg = err instanceof ApiError
        ? err.message || `Erro ${err.status}`
        : err instanceof Error
          ? err.message
          : 'Erro desconhecido';
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="space-y-1">
          <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${
            result.status === 'OK'
              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
              : result.status === 'FAILED'
                ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                : 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
          }`}>
            {result.status === 'OK' ? '✅' : result.status === 'FAILED' ? '❌' : '⚠️'}{' '}
            {result.status === 'OK' ? 'Cliente ativado' : result.status === 'FAILED' ? 'Falhou' : 'Parcial'}
          </div>
          <h1 className="text-2xl font-bold">Resultado da instalação</h1>
        </header>

        <ol className="space-y-3">
          {result.timeline.map((ev, i) => (
            <li
              key={i}
              className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeColor(ev.status)}`}>
                    {ev.status}
                  </span>
                  <span className="text-sm font-medium">{ev.action}</span>
                </div>
                {ev.durationMs !== null && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {(ev.durationMs / 1000).toFixed(2)}s
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{ev.message}</p>
              {ev.error && (
                <p className="mt-1 text-xs text-red-700 dark:text-red-300">{ev.error}</p>
              )}
            </li>
          ))}
        </ol>

        <div className="flex gap-2">
          <Button onClick={() => router.push('/provisioning/pending')}>Voltar pra lista</Button>
          <Button
            variant="secondary"
            onClick={() => {
              setResult(null);
              setSnGpon('');
              setMacAddress('');
              setSerialPhysical('');
            }}
          >
            Reativar com outros dados
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Ativar cliente</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Contrato <code className="text-xs">{contractId.slice(0, 8)}</code>
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-4">
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            OLT
          </h2>

          <div>
            <Label htmlFor="oltId">OLT</Label>
            <select
              id="oltId"
              value={oltId}
              onChange={(e) => setOltId(e.target.value)}
              required
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="">Selecione…</option>
              {olts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.vendor} {o.model}) — {o.status}
                </option>
              ))}
            </select>
            {olts.length === 0 && (
              <p className="mt-1 text-xs text-orange-600 dark:text-orange-400">
                Nenhuma OLT cadastrada. Admin precisa cadastrar em /olts.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ponFrame">Frame</Label>
              <Input
                id="ponFrame"
                type="number"
                min="0"
                value={ponFrame}
                onChange={(e) => setPonFrame(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ponSlot">Slot/Porta PON</Label>
              <Input
                id="ponSlot"
                type="number"
                min="0"
                value={ponSlot}
                onChange={(e) => setPonSlot(e.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            ONT (estoque)
          </h2>

          {!allowStockBypass ? (
            <div>
              <Label htmlFor="serialItemId">Equipamento do estoque *</Label>
              <Select
                id="serialItemId"
                required
                value={serialItemId}
                onChange={(e) => setSerialItemId(e.target.value)}
              >
                <option value="">Selecione…</option>
                {(availableSerials ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.serial} — {s.product.name}
                    {s.location?.name ? ` @ ${s.location.name}` : ''}
                  </option>
                ))}
              </Select>
              {(availableSerials ?? []).length === 0 && (
                <p className="mt-1 text-xs text-orange-600 dark:text-orange-400">
                  ⚠️ Nenhum equipamento disponível em estoque. Registre uma compra
                  em <code>/stock/purchases</code> ou ative o bypass abaixo (debug).
                </p>
              )}
              <p className="mt-1 text-xs text-slate-500">
                Só aparecem produtos PATRIMONIAIS (ex.: ONT) com status{' '}
                <code>IN_STOCK</code>. SN GPON será lido do serial selecionado.
              </p>
            </div>
          ) : (
            <div>
              <Label htmlFor="snGpon">SN GPON *</Label>
              <Input
                id="snGpon"
                required
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={snGpon}
                onChange={(e) => setSnGpon(e.target.value.toUpperCase())}
                placeholder="HWTC12AB34CD"
                className="font-mono"
              />
              <p className="mt-1 text-xs text-slate-500">
                Etiqueta no chassi da ONT (ou caixa). Huawei começa com HWTC.
              </p>
            </div>
          )}

          <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-900 dark:bg-amber-950">
            <input
              type="checkbox"
              checked={allowStockBypass}
              onChange={(e) => setAllowStockBypass(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-amber-900 dark:text-amber-200">
              <strong>Ignorar validação de estoque</strong> (debug/migração).
              Marque só se ainda não cadastrou ONTs como produto patrimonial.
              Em produção normal, mantém desmarcado pra evitar &quot;ONT fantasma&quot;.
            </span>
          </label>

          <div>
            <Label htmlFor="macAddress">MAC (opcional)</Label>
            <Input
              id="macAddress"
              value={macAddress}
              onChange={(e) => setMacAddress(e.target.value)}
              placeholder="AA:BB:CC:DD:EE:FF"
              className="font-mono"
            />
            <p className="mt-1 text-xs text-slate-500">
              Se a OLT já reportou, deixe vazio — vai vir do provider.
            </p>
          </div>

          <div>
            <Label htmlFor="serialPhysical">Serial físico (opcional)</Label>
            <Input
              id="serialPhysical"
              value={serialPhysical}
              onChange={(e) => setSerialPhysical(e.target.value)}
              placeholder="Inventário interno"
            />
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Wi-Fi
          </h2>

          <div>
            <Label htmlFor="wifiBandMode">Modelo da ONT</Label>
            <Select
              id="wifiBandMode"
              value={wifiBandMode}
              onChange={(e) =>
                setWifiBandMode(e.target.value as 'BAND_STEERING' | 'DUAL_BAND')
              }
            >
              <option value="BAND_STEERING">
                EG8145X6 / EG8145-X10 — band steering (rede única)
              </option>
              <option value="DUAL_BAND">
                EG8145V5 — bandas separadas (2.4G + 5G-)
              </option>
            </Select>
            <p className="mt-1 text-xs text-slate-500">
              Band steering: 2.4 e 5 GHz com o mesmo nome. Bandas separadas: a
              rede 5 GHz recebe o prefixo <code>5G-</code>.
            </p>
          </div>

          <div>
            <Label htmlFor="ssid">Nome da rede (SSID) *</Label>
            <Input
              id="ssid"
              required
              maxLength={32}
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
              placeholder="Silva-Casa"
            />
            {wifiBandMode === 'DUAL_BAND' && ssid.trim() && (
              <p className="mt-1 text-xs text-slate-500">
                2.4 GHz: <code>{ssid.trim()}</code> · 5 GHz:{' '}
                <code>5G-{ssid.trim()}</code>
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="wifiPassword">Senha Wi-Fi *</Label>
            <div className="flex gap-2">
              <Input
                id="wifiPassword"
                required
                minLength={8}
                maxLength={63}
                value={wifiPassword}
                onChange={(e) => setWifiPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                className="flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => setWifiPassword(generatePassword())}
              >
                Gerar
              </Button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Aplicado em 2.4 GHz e 5 GHz via TR-069.
            </p>
          </div>

          <div>
            <Label htmlFor="pppoeVlan">VLAN da WAN PPPoE</Label>
            <Input
              id="pppoeVlan"
              type="number"
              min={1}
              max={4094}
              value={pppoeVlan}
              onChange={(e) => setPppoeVlan(e.target.value)}
              className="font-mono sm:max-w-[160px]"
            />
            <p className="mt-1 text-xs text-slate-500">
              Padrão 1010 — o preset da OLT já traz essa VLAN na WAN2; o NetX
              reaplica via TR-069 por garantia. Só usada em contratos PPPoE.
            </p>
          </div>
        </section>

        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Notas (opcional)
          </h2>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: ONT colada atrás do quadro elétrico"
            rows={2}
          />
        </section>

        {submitError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {submitError}
          </div>
        )}

        <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <Button
            type="submit"
            disabled={
              submitting ||
              !oltId ||
              (!allowStockBypass && !serialItemId) ||
              (allowStockBypass && !snGpon.trim())
            }
            className="w-full"
          >
            {submitting ? 'Ativando…' : 'Ativar cliente'}
          </Button>
        </div>
      </form>
    </div>
  );
}
