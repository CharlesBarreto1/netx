'use client';

/**
 * /tr069/firmware — catálogo de firmware CPE + rollout via RPC Download.
 *
 * Upload da imagem por fabricante/modelo e disparo pro parque inteiro do
 * modelo ou pra seriais escolhidos. O resultado REAL de cada device vem do
 * TransferComplete (fault 9018 = imagem rejeitada pelo CPE — ex.: lock de
 * customização de operadora, visto ao vivo na ZTE F670L TLCO.GRP2).
 */
import { useMemo, useRef, useState } from 'react';
import useSWR from 'swr';

import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import {
  tr069Api,
  type Tr069DeviceRow,
  type Tr069FirmwareDeployResult,
  type Tr069FirmwareDeployStatus,
  type Tr069FirmwareRow,
  type Tr069FirmwareVendor,
} from '@/lib/provisioning-api';

const VENDORS: Tr069FirmwareVendor[] = ['HUAWEI', 'ZTE', 'VSOL', 'ZYXEL'];

const STATUS_CLS: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  RUNNING: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
  DONE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

export default function Tr069FirmwarePage() {
  const { data: firmwares, isLoading, error, mutate } = useSWR<Tr069FirmwareRow[]>(
    'tr069/firmwares',
    () => tr069Api.listFirmwares(),
    { refreshInterval: 30_000 },
  );
  const { data: devices } = useSWR<Tr069DeviceRow[]>('tr069/devices', () => tr069Api.listDevices());

  const [deployFw, setDeployFw] = useState<Tr069FirmwareRow | null>(null);
  const [statusFw, setStatusFw] = useState<Tr069FirmwareRow | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const models = useMemo(
    () => [...new Set((devices ?? []).map((d) => d.productClass).filter(Boolean))] as string[],
    [devices],
  );

  if (isLoading) return <PageLoader />;
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        Erro ao carregar o catálogo de firmware.
      </div>
    );
  }
  const rows = firmwares ?? [];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Firmware CPE</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Suba a imagem por fabricante/modelo e dispare pro parque inteiro do modelo ou pra seriais
          escolhidos. O CPE baixa do próprio ACS e aplica no próximo Inform.
        </p>
      </header>

      {banner && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
          {banner}
        </div>
      )}

      <UploadCard models={models} onDone={(m) => { setBanner(m); void mutate(); }} />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Nenhum firmware no catálogo — suba a primeira imagem acima.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Fabricante</th>
                <th className="px-3 py-2 text-left font-medium">Modelo</th>
                <th className="px-3 py-2 text-left font-medium">Versão</th>
                <th className="px-3 py-2 text-left font-medium">Arquivo</th>
                <th className="px-3 py-2 text-left font-medium">Parque</th>
                <th className="px-3 py-2 text-left font-medium">Na versão</th>
                <th className="px-3 py-2 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {rows.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                  <td className="px-3 py-2">{f.vendor}</td>
                  <td className="px-3 py-2 font-medium">{f.productClass}</td>
                  <td className="px-3 py-2 font-mono text-xs">{f.version}</td>
                  <td className="px-3 py-2 text-xs text-slate-500" title={`sha256 ${f.checksum}`}>
                    {f.fileName} · {mb(f.fileSize)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {f.deviceOnline} online / {f.deviceTotal}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {f.deviceOnVersion}/{f.deviceTotal}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setDeployFw(f)}
                        className="rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700"
                      >
                        Disparar
                      </button>
                      <button
                        onClick={() => setStatusFw(f)}
                        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                      >
                        Status
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm(`Excluir ${f.productClass} ${f.version} do catálogo?`)) return;
                          try {
                            await tr069Api.deleteFirmware(f.id);
                            void mutate();
                          } catch (e) {
                            alert(errMsg(e));
                          }
                        }}
                        className="rounded-md border border-red-300 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
                      >
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deployFw && (
        <DeployModal
          fw={deployFw}
          devices={(devices ?? []).filter((d) => d.productClass === deployFw.productClass)}
          onClose={() => setDeployFw(null)}
          onDone={(r) => {
            setDeployFw(null);
            setBanner(
              `Rollout ${deployFw.version}: ${r.enqueued} na fila` +
                (r.skippedSameVersion ? `, ${r.skippedSameVersion} já na versão` : '') +
                (r.skippedInflight ? `, ${r.skippedInflight} com download em curso` : '') +
                (r.skippedOffline ? `, ${r.skippedOffline} offline` : '') +
                '.',
            );
          }}
        />
      )}
      {statusFw && <StatusModal fw={statusFw} onClose={() => setStatusFw(null)} />}
    </div>
  );
}

// ── Upload ────────────────────────────────────────────────────────────────────

function UploadCard({ models, onDone }: { models: string[]; onDone: (msg: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [vendor, setVendor] = useState<Tr069FirmwareVendor>('ZTE');
  const [productClass, setProductClass] = useState('');
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file || !productClass.trim() || !version.trim()) {
      setErr('Arquivo, modelo e versão são obrigatórios.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('vendor', vendor);
      form.append('productClass', productClass.trim());
      form.append('version', version.trim());
      if (notes.trim()) form.append('notes', notes.trim());
      await tr069Api.uploadFirmware(form);
      onDone(`Firmware ${productClass.trim()} ${version.trim()} adicionado ao catálogo.`);
      setProductClass('');
      setVersion('');
      setNotes('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'rounded-md border border-slate-200 bg-transparent px-3 py-1.5 text-sm dark:border-slate-700';
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <h2 className="mb-3 text-sm font-semibold">Subir firmware</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Arquivo (.bin)
          <input ref={fileRef} type="file" accept=".bin,.img,.fw" className="text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Fabricante
          <select value={vendor} onChange={(e) => setVendor(e.target.value as Tr069FirmwareVendor)} className={inputCls}>
            {VENDORS.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Modelo (ProductClass)
          <input
            value={productClass}
            onChange={(e) => setProductClass(e.target.value)}
            placeholder="F670L"
            list="fw-models"
            className={`${inputCls} w-40`}
          />
          <datalist id="fw-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Versão
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="V9.0.11P3N10"
            className={`${inputCls} w-44`}
          />
        </label>
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-slate-500">
          Observações
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </label>
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {busy ? 'Enviando…' : 'Enviar'}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        ⚠️ O modelo precisa ser o ProductClass EXATO do Inform (veja em Dispositivos TR-069) — o
        disparo só aceita devices do mesmo modelo. CPEs de operadora podem recusar imagem de outra
        customização (TransferComplete fault 9018).
      </p>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </div>
  );
}

// ── Disparo ───────────────────────────────────────────────────────────────────

function DeployModal({
  fw,
  devices,
  onClose,
  onDone,
}: {
  fw: Tr069FirmwareRow;
  devices: Tr069DeviceRow[];
  onClose: () => void;
  onDone: (r: Tr069FirmwareDeployResult) => void;
}) {
  const [target, setTarget] = useState<'MODEL' | 'DEVICES'>('MODEL');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [onlyOnline, setOnlyOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const fire = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await tr069Api.deployFirmware(fw.id, {
        target,
        ...(target === 'DEVICES' ? { deviceIds: [...selected] } : {}),
        onlyOnline,
      });
      onDone(r);
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  };

  const count = target === 'MODEL' ? (onlyOnline ? fw.deviceOnline : fw.deviceTotal) : selected.size;
  return (
    <Modal title={`Disparar ${fw.productClass} → ${fw.version}`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <label className="flex items-start gap-2">
          <input type="radio" checked={target === 'MODEL'} onChange={() => setTarget('MODEL')} className="mt-1" />
          <span>
            <strong>Parque inteiro do modelo</strong> — todos os {fw.productClass} do tenant (
            {fw.deviceOnline} online / {fw.deviceTotal}).
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" checked={target === 'DEVICES'} onChange={() => setTarget('DEVICES')} className="mt-1" />
          <span>
            <strong>Seriais específicos</strong> — escolha abaixo.
          </span>
        </label>

        {target === 'DEVICES' && (
          <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
            {devices.length === 0 && (
              <p className="p-3 text-xs text-slate-500">Nenhum device {fw.productClass} no tenant.</p>
            )}
            {devices.map((d) => (
              <label
                key={d.id}
                className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-xs last:border-0 dark:border-slate-800"
              >
                <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                <span className="font-mono">{d.deviceId}</span>
                <span className="text-slate-400">{d.softwareVersion ?? 'versão ?'}</span>
                <span
                  className={`ml-auto rounded px-1.5 py-0.5 ${d.status === 'ONLINE' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}
                >
                  {d.status}
                </span>
              </label>
            ))}
          </div>
        )}

        <label className="flex items-center gap-2 text-xs text-slate-500">
          <input type="checkbox" checked={onlyOnline} onChange={(e) => setOnlyOnline(e.target.checked)} />
          Só devices online (offline recebem quando voltarem, se desmarcado)
        </label>

        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          O CPE baixa a imagem, grava a flash e <strong>reinicia sozinho</strong> (2–5 min fora do
          ar). Quem já está na versão {fw.version} é pulado.
        </p>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700">
            Cancelar
          </button>
          <button
            onClick={() => void fire()}
            disabled={busy || count === 0}
            className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {busy ? 'Disparando…' : `Disparar pra ${count} device(s)`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Status ────────────────────────────────────────────────────────────────────

function StatusModal({ fw, onClose }: { fw: Tr069FirmwareRow; onClose: () => void }) {
  const { data } = useSWR<Tr069FirmwareDeployStatus>(
    `tr069/firmwares/${fw.id}/status`,
    () => tr069Api.firmwareStatus(fw.id),
    { refreshInterval: 10_000 },
  );
  return (
    <Modal title={`Status do rollout — ${fw.productClass} ${fw.version}`} onClose={onClose}>
      {!data ? (
        <p className="text-sm text-slate-500">Carregando…</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={`rounded px-2 py-1 ${STATUS_CLS.PENDING}`}>na fila: {data.counts.pending}</span>
            <span className={`rounded px-2 py-1 ${STATUS_CLS.RUNNING}`}>baixando: {data.counts.running}</span>
            <span className={`rounded px-2 py-1 ${STATUS_CLS.DONE}`}>aplicado: {data.counts.done}</span>
            <span className={`rounded px-2 py-1 ${STATUS_CLS.FAILED}`}>falhou: {data.counts.failed}</span>
            <span className="rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">
              na versão: {data.deviceOnVersion}
            </span>
          </div>
          {data.devices.length === 0 ? (
            <p className="text-xs text-slate-500">Nenhum disparo desse firmware ainda.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-800">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Device</th>
                    <th className="px-2 py-1.5 text-left font-medium">Versão atual</th>
                    <th className="px-2 py-1.5 text-left font-medium">Status</th>
                    <th className="px-2 py-1.5 text-left font-medium">Erro</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.devices.map((d) => (
                    <tr key={d.taskId}>
                      <td className="px-2 py-1.5 font-mono">{d.deviceId}</td>
                      <td className="px-2 py-1.5">{d.softwareVersion ?? '—'}</td>
                      <td className="px-2 py-1.5">
                        <span className={`rounded px-1.5 py-0.5 ${STATUS_CLS[d.status] ?? STATUS_CLS.PENDING}`}>
                          {d.status}
                        </span>
                      </td>
                      <td className="max-w-64 truncate px-2 py-1.5 text-slate-500" title={d.error ?? ''}>
                        {d.error ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-slate-400">
            fault 9018 = o CPE rejeitou a imagem (customização de operadora diferente) — nada foi
            gravado no device.
          </p>
        </div>
      )}
    </Modal>
  );
}

// ── Modal base ────────────────────────────────────────────────────────────────

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
