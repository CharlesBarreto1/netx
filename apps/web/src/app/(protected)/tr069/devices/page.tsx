'use client';

/**
 * /tr069/devices — listagem básica de dispositivos TR-069.
 *
 * Fase 1: tabela só popula quando o ProvisioningService cria devices
 * placeholder via Tr069TasksService. Inform real só vem na Fase 3 quando
 * apps/cwmp-server existir.
 */
import useSWR from 'swr';

import { PageLoader } from '@/components/ui/Spinner';
import { tr069Api, type Tr069DeviceRow } from '@/lib/provisioning-api';

export default function Tr069DevicesPage() {
  const { data, isLoading, error } = useSWR<Tr069DeviceRow[]>(
    'tr069/devices',
    () => tr069Api.listDevices(),
    { refreshInterval: 60_000 },
  );

  if (isLoading) return <PageLoader />;
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        Erro ao carregar devices TR-069.
      </div>
    );
  }
  const rows = data ?? [];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Dispositivos TR-069</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          CPEs gerenciados via TR-069/CWMP. Fase 1 cria placeholders durante o
          provisionamento. Aplicação real de Wi-Fi e reboot fica disponível
          quando o servidor CWMP (Fase 3) estiver ativo.
        </p>
      </header>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
        <strong>Fase 1:</strong> tasks são enfileiradas em <code>tr069_tasks</code>{' '}
        mas não há ACS escutando porta 7547 ainda. As tasks ficam{' '}
        <code>PENDING</code> até a Fase 3 entregar o <code>apps/cwmp-server</code>.
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Nenhum device ainda. Ative um cliente em <code>/provisioning/install</code>{' '}
          pra criar o primeiro placeholder.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Device ID</th>
                <th className="px-3 py-2 text-left font-medium">Fabricante</th>
                <th className="px-3 py-2 text-left font-medium">SN GPON</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Último Inform</th>
                <th className="px-3 py-2 text-right font-medium">Tasks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="px-3 py-2 font-mono text-xs">{d.deviceId}</td>
                  <td className="px-3 py-2">{d.manufacturer ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{d.ont?.snGpon ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">
                      {d.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {d.lastInformAt ? new Date(d.lastInformAt).toLocaleString('pt-BR') : 'aguardando'}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">{d._count.tasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
