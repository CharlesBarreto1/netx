'use client';

/**
 * CopilotRail — rail direito do Copiloto de IA "Conselheira" (o "Nexus").
 *
 * Princípio de produto inegociável: a IA é CONSELHEIRA. Resume, correlaciona e
 * explica, mas NUNCA age sozinha — só responde, ancorada nos dados do tenant
 * (read-only). O violeta (token --ai) é exclusivo da IA: "proposta, não ação".
 *
 * Chat real sobre POST /v1/ai/ask (motor netx-ai: Ollama self-hosted + fallback
 * de nuvem). Cada pergunta é independente (sem memória de conversa no backend);
 * a transcrição local serve só de histórico visual.
 */

import { ChevronRight, Info, Send, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { aiApi } from '@/lib/ai-api';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { hasPermission } from '@/lib/session';

const STORAGE_KEY = 'netx.ui.railOpen';

interface Turn {
  role: 'user' | 'ai';
  text: string;
  meta?: string;
  error?: boolean;
}

const SUGGESTIONS = [
  'Quantos contratos ativos eu tenho?',
  'Tem incidente de rede aberto agora?',
  'Como estão meus clientes por status?',
];

export function CopilotRail() {
  const t = useTranslations('copilot');
  const canUse = hasPermission('ai.ask');

  const [open, setOpen] = useState(true);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) setOpen(stored === '1');
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, loading]);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  };

  async function send(q: string) {
    const text = q.trim();
    if (!text || loading) return;
    setTurns((prev) => [...prev, { role: 'user', text }]);
    setInput('');
    setLoading(true);
    try {
      const r = await aiApi.ask(text);
      setTurns((prev) => [
        ...prev,
        {
          role: 'ai',
          text: r.answer,
          meta: `${r.provider}${r.usedFallback ? ' · nuvem' : ''}`,
        },
      ]);
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : 'Falha ao consultar a IA. Verifique o Motor de IA em Configurações.';
      setTurns((prev) => [...prev, { role: 'ai', text: msg, error: true }]);
    } finally {
      setLoading(false);
    }
  }

  // Sem permissão de copiloto → rail não aparece.
  if (!canUse) return null;

  // ── Recolhido (52px) ──────────────────────────────────────────────────────
  if (!open) {
    return (
      <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[52px] shrink-0 border-l border-border bg-surface/40 lg:flex lg:flex-col lg:items-center lg:gap-3 lg:pt-3">
        <button
          type="button"
          onClick={toggle}
          title={t('expand')}
          aria-label={t('expand')}
          className="relative grid h-9 w-9 place-items-center rounded-lg bg-ai-muted text-ai ring-1 ring-ai/30 transition-colors hover:bg-ai/20"
        >
          <Sparkles className="h-[18px] w-[18px]" />
        </button>
        <span className="h-2 w-2 animate-pulse-soft rounded-full bg-success" />
      </aside>
    );
  }

  // ── Aberto (344px): chat ──────────────────────────────────────────────────
  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[344px] shrink-0 flex-col border-l border-border bg-surface/40 lg:flex">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ai-muted text-ai ring-1 ring-ai/30">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text">{t('title')}</div>
          <div className="truncate text-2xs text-text-subtle">{t('subtitle')}</div>
        </div>
        <button
          type="button"
          onClick={toggle}
          title={t('collapse')}
          aria-label={t('collapse')}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-subtle transition-colors hover:bg-surface-hover hover:text-text"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Conversa */}
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg bg-ai-muted/60 px-3 py-2 text-2xs text-ai ring-1 ring-ai/20">
              <Info className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>{t('neverActsAlone')}</span>
            </div>
            <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
              {t('suggestionsLabel')}
            </div>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-lg border border-dashed border-ai/40 bg-ai-muted/30 px-3 py-2 text-left text-xs text-text-muted transition-colors hover:bg-ai-muted/60 hover:text-text"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-lg rounded-br-sm bg-surface-hover px-3 py-2 text-xs leading-snug text-text">
                {turn.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ai-muted text-ai ring-1 ring-ai/30">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    'rounded-lg rounded-tl-sm px-3 py-2 text-xs leading-snug',
                    turn.error
                      ? 'bg-danger-muted/50 text-danger ring-1 ring-danger/20'
                      : 'bg-ai-muted/40 text-text',
                  )}
                >
                  <p className="whitespace-pre-wrap">{turn.text}</p>
                </div>
                {turn.meta && (
                  <div className="mt-0.5 pl-1 font-mono text-[10px] text-text-subtle">{turn.meta}</div>
                )}
              </div>
            </div>
          ),
        )}

        {loading && (
          <div className="flex items-center gap-2 pl-8 text-2xs text-text-subtle">
            <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-ai" />
            {t('thinking')}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder={t('askPlaceholder')}
            disabled={loading}
            className="max-h-28 flex-1 resize-none rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text placeholder:text-text-subtle focus:border-ai focus:outline-hidden focus:ring-1 focus:ring-ai/40 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void send(input)}
            disabled={loading || !input.trim()}
            title={t('send')}
            aria-label={t('send')}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ai text-ai-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
