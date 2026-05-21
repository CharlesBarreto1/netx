'use client';

/**
 * Card de gerenciamento Wi-Fi do contrato.
 *
 * Mostra SSID atual + status da última task TR-069. Botão "Editar Wi-Fi"
 * abre modal com novo SSID + senha + checkbox "Reiniciar ONT".
 *
 * Aplicação ao CPE é assíncrona via TR-069 — operador vê estado da última
 * task (PENDING → RUNNING → DONE/FAILED) por polling SWR.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ApiError } from '@/lib/api';
import {
  contractsApi,
  type ContractWifiStatus,
  type UpdateContractWifiInput,
} from '@/lib/contracts-api';
import { hasPermission } from '@/lib/session';

interface Props {
  contractId: string;
}

function generatePassword(): string {
  const alphabet =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  const arr = new Uint8Array(10);
  crypto.getRandomValues(arr);
  for (let i = 0; i < arr.length; i++) out += alphabet[arr[i] % alphabet.length];
  return out;
}

function fmtRelative(iso: string | null): string {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

function taskBadgeTone(status: string): string {
  switch (status) {
    case 'DONE':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
    case 'FAILED':
      return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
    case 'CANCELLED':
      return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
    case 'RUNNING':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
    default:
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
  }
}

export function ContractWifiCard({ contractId }: Props) {
  const { data, isLoading, mutate } = useSWR<ContractWifiStatus>(
    `/v1/contracts/${contractId}/wifi`,
    () => contractsApi.wifiStatus(contractId),
    {
      // Poll mais agressivo quando há task PENDING/RUNNING pra UI mostrar
      // DONE rápido. Quando estável, refresh a cada 30s só.
      refreshInterval: (latest) => {
        if (!latest) return 5000;
        const s = latest.lastTask?.status;
        if (s === 'PENDING' || s === 'RUNNING') return 5000;
        return 30_000;
      },
    },
  );
  const canEdit = hasPermission('contracts.write');
  const [editing, setEditing] = useState(false);

  if (isLoading || !data) {
    return (
      <div className="rounded-md border border-border bg-surface p-4 text-sm text-text-muted">
        Carregando Wi-Fi…
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
            Wi-Fi
          </h3>
          {data.ssid ? (
            <>
              <div className="text-base font-medium text-text">
                {data.ssid}{' '}
                <span className="text-xs font-normal text-text-muted">
                  (2.4&nbsp;GHz)
                </span>
              </div>
              <div className="text-base font-medium text-text">
                {data.ssid}-5G{' '}
                <span className="text-xs font-normal text-text-muted">
                  (5&nbsp;GHz)
                </span>
              </div>
              <p className="text-xs text-text-muted">
                Senha:{' '}
                {data.hasWifiPassword ? (
                  <span className="font-mono">••••••••••</span>
                ) : (
                  <span className="italic">não configurada</span>
                )}
              </p>
            </>
          ) : (
            <p className="text-sm text-text-muted italic">
              Wi-Fi ainda não configurado neste contrato.
            </p>
          )}
        </div>
        {canEdit && data.hasTr069Device && (
          <Button size="sm" onClick={() => setEditing(true)}>
            Editar Wi-Fi
          </Button>
        )}
      </div>

      {!data.hasTr069Device && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          ⚠️ Contrato sem ONT TR-069 vinculada. Ative o cliente em{' '}
          <code>/provisioning/install</code> primeiro pra liberar a gestão de Wi-Fi.
        </div>
      )}

      {data.lastTask && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-xs uppercase tracking-wide text-text-muted">
            Última task TR-069:
          </span>
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${taskBadgeTone(
              data.lastTask.status,
            )}`}
          >
            {data.lastTask.action} · {data.lastTask.status}
          </span>
          <span className="text-xs text-text-muted">
            criada {fmtRelative(data.lastTask.createdAt)}
            {data.lastTask.completedAt
              ? ` · concluída ${fmtRelative(data.lastTask.completedAt)}`
              : ''}
          </span>
          {data.lastTask.error && (
            <p className="basis-full text-xs text-red-700 dark:text-red-300">
              {data.lastTask.error}
            </p>
          )}
        </div>
      )}

      {data.lastInformAt && (
        <p className="mt-2 text-xs text-text-muted">
          📡 Último Inform do CPE: {fmtRelative(data.lastInformAt)}
        </p>
      )}

      {editing && (
        <EditWifiModal
          contractId={contractId}
          initialSsid={data.ssid ?? ''}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await mutate();
          }}
        />
      )}
    </div>
  );
}

interface EditWifiModalProps {
  contractId: string;
  initialSsid: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

function EditWifiModal({
  contractId,
  initialSsid,
  onClose,
  onSaved,
}: EditWifiModalProps) {
  const [ssid, setSsid] = useState(initialSsid);
  const [pwd, setPwd] = useState('');
  const [reboot, setReboot] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const input: UpdateContractWifiInput = { ssid, wifiPassword: pwd, reboot };
      await contractsApi.updateWifi(contractId, input);
      await onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Editar Wi-Fi">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <Label htmlFor="ssid" required>
            SSID
          </Label>
          <Input
            id="ssid"
            required
            maxLength={32}
            value={ssid}
            onChange={(e) => setSsid(e.target.value)}
            placeholder="Silva-Casa"
          />
          <p className="mt-1 text-xs text-text-muted">
            Aplicado em 2.4&nbsp;GHz como informado e em 5&nbsp;GHz com sufixo{' '}
            <code>-5G</code> automático.
          </p>
        </div>

        <div>
          <Label htmlFor="wifiPwd" required>
            Senha Wi-Fi
          </Label>
          <div className="flex gap-2">
            <Input
              id="wifiPwd"
              required
              minLength={8}
              maxLength={63}
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              className="flex-1"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPwd(generatePassword())}
            >
              Gerar
            </Button>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            Padrão WPA2-PSK (8–63 chars). Senha será cifrada at-rest com KMS.
          </p>
        </div>

        <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
          <input
            type="checkbox"
            checked={reboot}
            onChange={(e) => setReboot(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Reiniciar ONT após aplicar</span>
            <span className="block text-xs text-text-muted">
              Recomendado se cliente reclamar que o Wi-Fi novo não apareceu.
              Adiciona ~60s de downtime. Sem marcar, a Huawei aplica sem
              reboot na maioria dos casos.
            </span>
          </span>
        </label>

        <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
          ℹ️ Aplicação acontece no próximo Inform do CPE (típico até ~60s).
          O cartão da tela mostrará o status (PENDING → RUNNING → DONE).
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={saving}>
            Aplicar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
