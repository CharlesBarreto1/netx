'use client';

/**
 * Aba "Copiloto" — Q&A de diagnóstico grounded (porta o `CopilotPanel`).
 * A IA usa métricas + eventos + config já coletados pra montar hipótese citando
 * evidências. Read-only inegociável: explica e sugere, nunca age no equipamento.
 */
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/Input';
import { notify } from '@/lib/notify';
import { nmsApi } from '@/lib/nms-api';

export function CopilotTab({ deviceId }: { deviceId: string }) {
  const { data: status } = useSWR('nms/ai/status', () => nmsApi.aiStatus(), {
    shouldRetryOnError: false,
  });
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);

  const available = status?.available;

  async function ask() {
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    setAnswer('');
    try {
      const r = await nmsApi.copilot(deviceId, q);
      setAnswer(r.answer);
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Copiloto de diagnóstico (IA)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {available === false ? (
          <p className="text-sm text-slate-500">
            IA indisponível — habilite o motor de IA do NetX em{' '}
            <span className="font-medium">Configurações › IA</span>. O copiloto usa a IA do NetX
            (não tem chave própria).
          </p>
        ) : (
          <>
            <div className="flex gap-2">
              <Input
                className="flex-1"
                placeholder="Ex.: por que a xe-0/0/0 está com erro? a óptica está saudável?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void ask()}
              />
              <Button variant="primary" loading={busy} onClick={() => void ask()}>
                <Sparkles className="h-4 w-4" /> Perguntar
              </Button>
            </div>
            {answer && (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                {answer}
              </pre>
            )}
            <p className="text-xs text-slate-400">
              Read-only: o copiloto explica e sugere com base nos dados coletados; nunca age no
              equipamento.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
