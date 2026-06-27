'use client';

/**
 * /copiloto — Copiloto de IA do NetX (grounded read-only).
 *
 * Faz perguntas ancoradas num snapshot real do tenant (contratos/clientes/
 * incidentes). Cada pergunta é independente (o backend não guarda memória de
 * conversa); a tela mostra o histórico só para leitura. A IA é conselheira —
 * só explica/resume, nunca executa ação.
 *
 * Em CPU local a resposta leva minutos; para uso fluido, ligue o fallback de
 * nuvem em Configurações › Motor de IA. Strings inline pt-BR (padrão novo).
 */
import { useRef, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FieldHelp, Textarea } from '@/components/ui/Input';
import { ApiError } from '@/lib/api';
import { aiApi } from '@/lib/ai-api';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  meta?: string;
}

const SUGESTOES = [
  'Quantos contratos ativos eu tenho?',
  'Tem algum incidente de rede aberto agora?',
  'Como estão meus clientes por status?',
];

export default function CopilotoPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const send = async (q: string) => {
    const text = q.trim();
    if (!text || loading) return;
    setTurns((t) => [...t, { role: 'user', text }]);
    setQuestion('');
    setLoading(true);
    try {
      const r = await aiApi.ask(text);
      setTurns((t) => [
        ...t,
        {
          role: 'assistant',
          text: r.answer,
          meta: `${r.provider}${r.usedFallback ? ' · fallback nuvem' : ''}`,
        },
      ]);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : 'Falha ao consultar a IA (pode ter excedido o tempo — ligue o fallback de nuvem).';
      setTurns((t) => [...t, { role: 'assistant', text: `⚠️ ${msg}`, meta: 'erro' }]);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }));
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-9rem)] max-w-3xl flex-col">
      <div className="mb-3">
        <h1 className="text-xl font-semibold">Copiloto de IA</h1>
        <p className="text-sm text-muted-foreground">
          Pergunte sobre a operação. As respostas são ancoradas nos seus dados (read-only) — a IA
          nunca altera nada.
        </p>
      </div>

      {/* Transcrição */}
      <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-border bg-card/40 p-4">
        {turns.length === 0 && (
          <div className="space-y-3 pt-4 text-center">
            <p className="text-sm text-muted-foreground">Experimente perguntar:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGESTOES.map((s) => (
                <Button key={s} variant="outline" onClick={() => void send(s)} disabled={loading}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={
                t.role === 'user'
                  ? 'max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
                  : 'max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm'
              }
            >
              <div className="whitespace-pre-wrap">{t.text}</div>
              {t.meta && (
                <div className="mt-1 text-[11px] opacity-60">
                  {t.role === 'assistant' && t.meta !== 'erro' && (
                    <Badge variant="success">IA</Badge>
                  )}{' '}
                  {t.meta}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              pensando… (em CPU local pode levar minutos)
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Entrada */}
      <div className="mt-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(question);
              }
            }}
            placeholder="Pergunte algo sobre sua operação… (Enter envia, Shift+Enter quebra linha)"
            rows={2}
            className="flex-1 resize-none"
            disabled={loading}
          />
          <Button onClick={() => void send(question)} disabled={loading || !question.trim()}>
            Enviar
          </Button>
        </div>
        <FieldHelp>
          Cada pergunta é independente (sem memória de conversa). Para respostas rápidas, ligue o
          fallback de nuvem em Configurações › Motor de IA.
        </FieldHelp>
      </div>
    </div>
  );
}
