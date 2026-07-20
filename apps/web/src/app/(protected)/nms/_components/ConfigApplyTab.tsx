'use client';

/**
 * Aba "Aplicar config" — escrita em equipamento (porta o `ConfigApplyPanel`).
 * Fluxo seguro: planejar (dry-run diff) → aplicar (rollback automático armado)
 * → verificar acesso → confirmar. Sem confirmar, o equipamento reverte sozinho
 * (Junos `commit confirmed`; Mikrotik backup + auto-revert; IOS-XE `revert timer`). Só operator+.
 */
import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/Modal';
import { notify } from '@/lib/notify';
import { nmsApi, type VerifyResult } from '@/lib/nms-api';

import { DiffView } from './DiffView';

export function ConfigApplyTab({ deviceId, vendor }: { deviceId: string; vendor: string }) {
  const [config, setConfig] = useState('');
  const [confirmMinutes, setConfirmMinutes] = useState(5);
  const [diff, setDiff] = useState('');
  const [planned, setPlanned] = useState(false);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState<'plan' | 'apply' | 'confirm' | null>(null);
  const [askApply, setAskApply] = useState(false);

  const pending = useSWR(`nms/${deviceId}/pending`, () => nmsApi.config.pending(deviceId));
  const history = useSWR(`nms/${deviceId}/changes`, () => nmsApi.config.changes(deviceId));
  const isPending = !!pending.data;

  const placeholder =
    vendor === 'mikrotik'
      ? '/ip address add address=10.0.0.2/24 interface=ether1'
      : vendor === 'cisco_iosxe'
        ? 'interface TenGigabitEthernet0/0/1\n description uplink-core'
        : vendor === 'parks'
          ? 'interface tengigabitethernet1/3/1\n description uplink-core'
          : 'set interfaces ge-0/0/0 description "uplink-core"';

  function reloadState() {
    void pending.mutate();
    void history.mutate();
  }

  function onEdit(v: string) {
    setConfig(v);
    setPlanned(false);
    setDiff('');
  }

  async function plan() {
    setBusy('plan');
    try {
      const r = await nmsApi.config.plan(deviceId, config);
      setDiff(r.diff);
      setPlanned(true);
      if (!r.diff.trim()) notify.info('Sem mudança (config idêntica).');
    } catch (e) {
      setPlanned(false);
      notify.apiError(e);
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    setAskApply(false);
    setBusy('apply');
    setVerify(null);
    try {
      const r = await nmsApi.config.apply(deviceId, config, confirmMinutes);
      setDiff(r.diff || diff);
      setVerify(r.verify);
      notify.success(r.detail || 'Config aplicada — confirme antes do rollback.');
      reloadState();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    setBusy('confirm');
    try {
      const r = await nmsApi.config.confirm(deviceId);
      setVerify(null);
      setPlanned(false);
      notify.success(r.detail || 'Mudança confirmada.');
      reloadState();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Aplicar configuração ({vendor}) — escrita</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-500">
          Padrão seguro: planejar → revisar o diff → aplicar (rollback automático armado) → verificar
          acesso → confirmar. Sem confirmar, o equipamento reverte sozinho.
        </p>

        <textarea
          className="w-full min-h-[120px] rounded-md border border-slate-300 bg-white p-3 font-mono text-sm text-slate-800 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          placeholder={placeholder}
          value={config}
          onChange={(e) => onEdit(e.target.value)}
          disabled={isPending}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            loading={busy === 'plan'}
            disabled={busy !== null || !config.trim() || isPending}
            onClick={() => void plan()}
          >
            1· Planejar (diff)
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy === 'apply'}
            disabled={busy !== null || !planned || !diff.trim() || isPending}
            onClick={() => setAskApply(true)}
          >
            2· Aplicar
          </Button>
          <label className="flex items-center gap-1.5 text-sm text-slate-500">
            rollback em
            <input
              type="number"
              min={1}
              max={60}
              value={confirmMinutes}
              onChange={(e) => setConfirmMinutes(Number(e.target.value) || 5)}
              disabled={isPending}
              className="w-16 rounded-md border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-900"
            />
            min
          </label>
          {isPending && (
            <Button
              variant="primary"
              size="sm"
              loading={busy === 'confirm'}
              disabled={busy !== null}
              onClick={() => void confirm()}
            >
              3· Confirmar (travar)
            </Button>
          )}
        </div>

        {verify && (
          <p
            className={`text-sm ${verify.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}
          >
            verify: {verify.detail}
          </p>
        )}

        {isPending && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Mudança aplicada mas <strong>NÃO confirmada</strong>
              {pending.data?.confirmDeadline
                ? ` (rollback ~${new Date(pending.data.confirmDeadline).toLocaleTimeString()})`
                : ''}
              . Verifique o acesso ao equipamento e clique “Confirmar” antes do rollback automático.
            </span>
          </div>
        )}

        {diff.trim() && <DiffView diff={diff} />}

        {(history.data ?? []).length > 0 && (
          <div>
            <div className="mb-1 text-xs text-slate-500">Histórico de mudanças</div>
            <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-3 py-2 font-medium">Quando</th>
                    <th className="px-3 py-2 font-medium">Quem</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Verify</th>
                  </tr>
                </thead>
                <tbody>
                  {(history.data ?? []).slice(0, 8).map((h) => (
                    <tr key={h.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {new Date(h.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-500">{h.actor}</td>
                      <td className="px-3 py-2">{h.status}</td>
                      <td className="px-3 py-2">
                        {h.verifyOk === null ? '—' : h.verifyOk ? 'ok' : 'falhou'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={askApply}
        onClose={() => setAskApply(false)}
        onConfirm={() => void apply()}
        title="Aplicar configuração no equipamento?"
        message={`A config vai efetivar com rollback automático em ${confirmMinutes} min caso você não confirme. Revisou o diff?`}
        confirmLabel="Aplicar"
        variant="danger"
      />
    </Card>
  );
}
