'use client';

/**
 * Aba "Playbooks" — blocos de comando nomeados, read-only (porta o
 * `PlaybooksPanel` do SPA). Lista por vendor, executa e mostra a saída.
 */
import { useState } from 'react';
import { Play } from 'lucide-react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { notify } from '@/lib/notify';
import { nmsApi, type Playbook } from '@/lib/nms-api';

export function PlaybooksTab({
  deviceId,
  vendor,
  canWrite,
}: {
  deviceId: string;
  vendor: string;
  canWrite: boolean;
}) {
  const { data: playbooks } = useSWR(`nms/playbooks/${vendor}`, () => nmsApi.playbooks(vendor));
  const [running, setRunning] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [output, setOutput] = useState('');

  async function run(pb: Playbook) {
    setRunning(pb.id);
    setTitle(`${pb.name} — ${pb.command}`);
    setOutput('executando…');
    try {
      const r = await nmsApi.runPlaybook(deviceId, pb.id);
      setOutput(r.output || '(sem saída)');
    } catch (e) {
      notify.apiError(e);
      setOutput('');
    } finally {
      setRunning(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Diagnóstico — playbooks (read-only)</CardTitle>
      </CardHeader>
      <CardContent>
        {!canWrite ? (
          <p className="text-sm text-slate-500">Seu papel (viewer) não executa playbooks.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(playbooks ?? []).map((pb) => (
              <Button
                key={pb.id}
                variant="secondary"
                size="sm"
                loading={running === pb.id}
                disabled={running !== null}
                onClick={() => void run(pb)}
              >
                <Play className="h-4 w-4" /> {pb.name}
              </Button>
            ))}
            {(playbooks ?? []).length === 0 && (
              <p className="text-sm text-slate-500">Nenhum playbook para este vendor.</p>
            )}
          </div>
        )}

        {output && (
          <div className="mt-4">
            <div className="text-xs text-slate-500">{title}</div>
            <pre className="mt-2 max-h-96 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3 font-mono text-xs text-slate-200 dark:border-slate-700">
              {output}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
