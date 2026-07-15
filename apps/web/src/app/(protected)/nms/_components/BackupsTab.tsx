'use client';

/**
 * Aba "Backups" — versionamento de config em git (porta o `BackupPanel` do SPA).
 * Lista snapshots, faz backup on-demand e mostra o diff de cada versão.
 */
import { useState } from 'react';
import { DownloadCloud } from 'lucide-react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { notify } from '@/lib/notify';
import { nmsApi, type SnapshotDetail } from '@/lib/nms-api';

import { DiffView } from './DiffView';

export function BackupsTab({ deviceId, canWrite }: { deviceId: string; canWrite: boolean }) {
  const { data: snaps, mutate } = useSWR(`nms/${deviceId}/snapshots`, () =>
    nmsApi.snapshots(deviceId),
  );
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<SnapshotDetail | null>(null);
  const [loadingSnap, setLoadingSnap] = useState<string | null>(null);

  async function runBackup() {
    setBusy(true);
    try {
      const r = await nmsApi.backup(deviceId);
      notify.success(
        r.changed
          ? `Nova versão: ${r.diffSummary ?? r.gitHash.slice(0, 8)}`
          : 'Sem mudança na config.',
      );
      await mutate();
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  }

  async function openSnap(id: string) {
    setLoadingSnap(id);
    setDetail(null);
    try {
      setDetail(await nmsApi.snapshot(deviceId, id));
    } catch (e) {
      notify.apiError(e);
    } finally {
      setLoadingSnap(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Backup de configuração (git)</CardTitle>
        {canWrite && (
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void runBackup()}>
            <DownloadCloud className="h-4 w-4" /> Fazer backup agora
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!snaps || snaps.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum snapshot ainda — rode um backup.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-800/50">
                <tr>
                  <th className="px-3 py-2 font-medium">Quando</th>
                  <th className="px-3 py-2 font-medium">Commit</th>
                  <th className="px-3 py-2 font-medium">Mudança</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {snaps.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(s.capturedAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-500">{s.gitHash.slice(0, 8)}</td>
                    <td className="px-3 py-2 text-slate-500">{s.diffSummary ?? '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={loadingSnap === s.id}
                        onClick={() => void openSnap(s.id)}
                      >
                        ver diff
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {detail && (
          <div className="mt-4">
            <div className="text-xs text-slate-500">
              {new Date(detail.capturedAt).toLocaleString()} · {detail.gitHash.slice(0, 8)} ·{' '}
              {detail.diffSummary ?? '—'}
            </div>
            {detail.diff.trim() ? (
              <DiffView diff={detail.diff} />
            ) : (
              <pre className="mt-3 max-h-96 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3 font-mono text-xs text-slate-200 dark:border-slate-700">
                {detail.config.slice(0, 4000)}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
