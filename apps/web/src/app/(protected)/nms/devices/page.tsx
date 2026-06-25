'use client';

/**
 * /nms/devices — Roteadores gerenciados pelo NMS, DENTRO do shell do NetX.
 *
 * É o módulo NMS (apps/nms) embutido no ecossistema: as chamadas vão pro gateway
 * em /v1/nms/* (canal 4), com SSO (o JWT do operador do NetX é aceito pelo NMS)
 * e entitlement netx-nms checado no gateway. Cadastra Juniper e Mikrotik —
 * mesmo MK que o NetX usa como BNG, aqui como device de rede (saúde/backup/SSH).
 *
 * Ver docs/ecosystem/INTEGRATION-RUNBOOK.md §A.
 */
import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { FieldHelp, Input, Label, Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  NMS_VENDORS,
  nmsApi,
  type CreateNmsDeviceRequest,
  type NmsDevice,
  type NmsVendor,
} from '@/lib/nms-api';

interface FormState {
  hostname: string;
  mgmtIp: string;
  vendor: NmsVendor;
  model: string;
  site: string;
  username: string;
  password: string;
  snmpCommunity: string;
}

const EMPTY_FORM: FormState = {
  hostname: '',
  mgmtIp: '',
  vendor: 'mikrotik',
  model: '',
  site: '',
  username: '',
  password: '',
  snmpCommunity: '',
};

function vendorLabel(v: NmsVendor): string {
  return NMS_VENDORS.find((x) => x.value === v)?.label ?? v;
}

export default function NmsDevicesPage() {
  const canManage = hasPermission('users.write') || hasPermission('network.write');
  const { data, error, isLoading, mutate } = useSWR<NmsDevice[], unknown>(
    'nms-devices',
    () => nmsApi.listDevices(),
    { shouldRetryOnError: false },
  );

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<NmsDevice | null>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.hostname.trim() || !form.mgmtIp.trim()) {
      toast.error('Informe hostname e IP de gerência.');
      return;
    }
    setSaving(true);
    try {
      const body: CreateNmsDeviceRequest = {
        hostname: form.hostname.trim(),
        mgmtIp: form.mgmtIp.trim(),
        vendor: form.vendor,
        model: form.model.trim() || undefined,
        site: form.site.trim() || undefined,
      };
      const device = await nmsApi.createDevice(body);

      // Credenciais são opcionais no cadastro; se preencheu usuário, grava no cofre do NMS.
      if (form.username.trim()) {
        await nmsApi.setCredentials(device.id, {
          username: form.username.trim(),
          password: form.password.trim() || undefined,
          snmpCommunity: form.snmpCommunity.trim() || undefined,
        });
      }
      toast.success(`Roteador "${device.hostname}" cadastrado.`);
      setOpen(false);
      setForm(EMPTY_FORM);
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao cadastrar roteador.');
    } finally {
      setSaving(false);
    }
  }

  async function onTest(d: NmsDevice) {
    setTesting(d.id);
    try {
      const r = await nmsApi.connectivityTest(d.id);
      const parts = (['ssh', 'netconf', 'snmp'] as const)
        .filter((k) => r[k])
        .map((k) => `${k.toUpperCase()}: ${r[k]?.ok ? 'ok' : 'falhou'}`);
      toast.success(`Teste de ${d.hostname} — ${parts.join(' · ') || 'enfileirado'}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha no teste de conexão.');
    } finally {
      setTesting(null);
    }
  }

  async function onDelete() {
    if (!toDelete) return;
    try {
      await nmsApi.deleteDevice(toDelete.id);
      toast.success(`Roteador "${toDelete.hostname}" removido.`);
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Falha ao remover.');
    } finally {
      setToDelete(null);
    }
  }

  // Estados de borda: módulo não licenciado (403) ou NMS fora do ar (502).
  const apiErr = error as ApiError | undefined;
  const notEntitled = apiErr?.status === 403;
  const unreachable = apiErr?.status === 502 || apiErr?.status === 503;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text">Roteadores (NMS)</h1>
          <p className="text-sm text-text-muted">
            Equipamentos de rede gerenciados pelo NMS — Juniper e Mikrotik.
          </p>
        </div>
        {canManage && !notEntitled && !unreachable && (
          <Button variant="primary" onClick={() => setOpen(true)}>
            Cadastrar roteador
          </Button>
        )}
      </header>

      {isLoading && <PageLoader />}

      {notEntitled && (
        <div className="rounded-md border border-border bg-surface-muted p-6 text-sm text-text-muted">
          O módulo <strong>NMS</strong> não está habilitado nesta licença.
        </div>
      )}

      {unreachable && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-6 text-sm text-text">
          O serviço do <strong>NMS</strong> está fora do ar (gateway não alcançou
          o módulo). Suba a stack do NMS e tente de novo.
        </div>
      )}

      {data && !isLoading && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Hostname</th>
                <th className="px-4 py-2 font-medium">IP de gerência</th>
                <th className="px-4 py-2 font-medium">Vendor</th>
                <th className="px-4 py-2 font-medium">Modelo</th>
                <th className="px-4 py-2 font-medium">Site</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                    Nenhum roteador cadastrado ainda.
                  </td>
                </tr>
              )}
              {data.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="px-4 py-2 font-medium text-text">{d.hostname}</td>
                  <td className="px-4 py-2 font-mono text-text-muted">{d.mgmtIp}</td>
                  <td className="px-4 py-2">{vendorLabel(d.vendor)}</td>
                  <td className="px-4 py-2 text-text-muted">{d.model || '—'}</td>
                  <td className="px-4 py-2 text-text-muted">{d.site || '—'}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={testing === d.id}
                        onClick={() => void onTest(d)}
                      >
                        Testar conexão
                      </Button>
                      {canManage && (
                        <Button variant="ghost" size="sm" onClick={() => setToDelete(d)}>
                          Excluir
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

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Cadastrar roteador"
        description="Adiciona um equipamento ao inventário do NMS."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" loading={saving} onClick={onSubmit}>
              Cadastrar
            </Button>
          </div>
        }
      >
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Hostname</Label>
              <Input
                value={form.hostname}
                onChange={(e) => set('hostname', e.target.value)}
                placeholder="rb-core-01"
                autoFocus
              />
            </div>
            <div>
              <Label>IP de gerência</Label>
              <Input
                value={form.mgmtIp}
                onChange={(e) => set('mgmtIp', e.target.value)}
                placeholder="10.0.0.1"
              />
            </div>
            <div>
              <Label>Vendor</Label>
              <Select value={form.vendor} onChange={(e) => set('vendor', e.target.value as NmsVendor)}>
                {NMS_VENDORS.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Modelo (opcional)</Label>
              <Input
                value={form.model}
                onChange={(e) => set('model', e.target.value)}
                placeholder="CCR2004 / MX80"
              />
            </div>
            <div className="col-span-2">
              <Label>Site (opcional)</Label>
              <Input value={form.site} onChange={(e) => set('site', e.target.value)} placeholder="POP Centro" />
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <p className="mb-2 text-sm font-medium text-text">Credenciais (opcional)</p>
            <FieldHelp>
              Guardadas cifradas no cofre do NMS — só o device-gateway as lê. Pode
              deixar em branco e configurar depois.
            </FieldHelp>
            <div className="mt-3 grid grid-cols-3 gap-4">
              <div>
                <Label>Usuário SSH</Label>
                <Input value={form.username} onChange={(e) => set('username', e.target.value)} />
              </div>
              <div>
                <Label>Senha</Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                />
              </div>
              <div>
                <Label>SNMP community</Label>
                <Input
                  value={form.snmpCommunity}
                  onChange={(e) => set('snmpCommunity', e.target.value)}
                  placeholder="public"
                />
              </div>
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={onDelete}
        title="Remover roteador"
        message={`Remover "${toDelete?.hostname}" do inventário do NMS? Esta ação não pode ser desfeita.`}
        confirmLabel="Remover"
        variant="danger"
      />
    </div>
  );
}
