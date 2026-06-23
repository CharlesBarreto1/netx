'use client';

/**
 * CopilotRail — rail direito do Copiloto de IA "Conselheira" (Fase 3 do redesign
 * de shell, design_handoff_netx_shell §8).
 *
 * Princípio de produto inegociável: a IA é CONSELHEIRA. Sugere, correlaciona e
 * explica, mas NUNCA age sozinha — toda ação passa por confirmação humana
 * explícita: `idle → confirm → done` (ou `idle → dismissed`). O violeta é
 * exclusivo da IA (token --ai), justamente para distingui-la como "proposta,
 * não ação".
 *
 * Estado nesta fase: sugestões e feed são MOCK (no real virão do motor netx-ai
 * e do event bus via SSE — ver TODO no feed). A máquina de estados e o chrome
 * já são finais.
 */

import { ArrowRight, Check, ChevronRight, Info, Sparkles, TriangleAlert, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

type SuggestionState = 'idle' | 'confirm' | 'done' | 'dismissed';

interface Suggestion {
  id: string;
  /** Correlação entre módulos, ex.: "ERP × Call". */
  correlation: string;
  /** Confiança 0–100. */
  confidence: number;
  title: string;
  body: string;
  /** Label do botão de ação (idle), ex.: "Preparar lembrete (47)". */
  action: string;
  /** Nota mostrada no passo de confirmação (o que será feito). */
  confirmNote: string;
}

type ModuleTone = 'erp' | 'nms' | 'cpe' | 'monitor' | 'call';

interface LiveEvent {
  id: number;
  module: ModuleTone;
  text: string;
  time: string;
}

const STORAGE_KEY = 'netx.ui.railOpen';

// Mock — no real, virão do motor de IA chaveadas pela lente ativa (Fase 4).
const MOCK_SUGGESTIONS: Suggestion[] = [
  {
    id: 's1',
    correlation: 'ERP × Call',
    confidence: 92,
    title: '47 contratos vencem em 3 dias sem boleto enviado',
    body: 'Cruzei faturamento com a fila de atendimento: dá para disparar um lembrete amigável antes do vencimento e reduzir inadimplência.',
    action: 'Preparar lembrete (47)',
    confirmNote:
      'Vou enfileirar 47 mensagens de lembrete de vencimento. Nada é enviado até você confirmar aqui.',
  },
  {
    id: 's2',
    correlation: 'NMS × Monitor',
    confidence: 87,
    title: 'OLT-ASU-01 com RX degradando há 40min',
    body: 'A potência óptica caiu 4 dB e 3 alarmes correlacionam à mesma PON. Sugiro abrir um incidente P2 e notificar o NOC.',
    action: 'Abrir incidente P2',
    confirmNote: 'Vou criar um incidente P2 vinculado à OLT-ASU-01 e à PON afetada.',
  },
];

const EVENT_POOL: Array<Omit<LiveEvent, 'id' | 'time'>> = [
  { module: 'erp', text: 'Contrato #18432 ativado — Asunción Centro' },
  { module: 'cpe', text: 'ONT trocada no contrato #17905 (rede própria)' },
  { module: 'nms', text: 'SW-CORE-02 voltou a 99,9% de uptime' },
  { module: 'monitor', text: 'Alarme P3 reconhecido em RTR-BORDER-01' },
  { module: 'call', text: 'Chamado #4821 resolvido — 1ª resposta 2min' },
  { module: 'erp', text: 'Fatura paga via Pix — R$ 149,90' },
];

const MODULE_TONE: Record<ModuleTone, string> = {
  erp: 'text-accent-strong bg-accent-muted',
  nms: 'text-success bg-success-muted',
  cpe: 'text-info bg-info-muted',
  monitor: 'text-warning bg-warning-muted',
  call: 'text-text-muted bg-surface-hover',
};

const DOT_TONE: Record<ModuleTone, string> = {
  erp: 'bg-accent',
  nms: 'bg-success',
  cpe: 'bg-info',
  monitor: 'bg-warning',
  call: 'bg-text-subtle',
};

export function CopilotRail() {
  const t = useTranslations('copilot');
  const [open, setOpen] = useState(true);
  const [states, setStates] = useState<Record<string, SuggestionState>>({});
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const evId = useRef(0);

  // Hidrata o estado aberto/recolhido do localStorage após mount (evita
  // mismatch de hidratação).
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) setOpen(stored === '1');
  }, []);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  };

  // Feed ao vivo — MOCK por timer. TODO(Fase 3): trocar por SSE/WebSocket
  // assinando a exchange `netx.events` do event bus (envelope.type → chip,
  // envelope.occurredAt → timestamp).
  useEffect(() => {
    if (!open) return;
    let i = 0;
    const push = () => {
      const tpl = EVENT_POOL[i % EVENT_POOL.length];
      i += 1;
      evId.current += 1;
      const now = new Date();
      setEvents((prev) =>
        [
          {
            id: evId.current,
            module: tpl.module,
            text: tpl.text,
            time: now.toLocaleTimeString('pt-BR', { hour12: false }),
          },
          ...prev,
        ].slice(0, 22),
      );
    };
    push();
    const timer = setInterval(push, 4800);
    return () => clearInterval(timer);
  }, [open]);

  const setState = (id: string, s: SuggestionState) =>
    setStates((prev) => ({ ...prev, [id]: s }));

  const activeCount = MOCK_SUGGESTIONS.filter(
    (s) => (states[s.id] ?? 'idle') !== 'dismissed' && (states[s.id] ?? 'idle') !== 'done',
  ).length;

  // ── Recolhido (52px): só o sparkle violeta + badge + pulso ──────────────
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
          {activeCount > 0 && (
            <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-ai px-1 text-[10px] font-semibold text-ai-foreground">
              {activeCount}
            </span>
          )}
        </button>
        <span className="h-2 w-2 animate-pulse-soft rounded-full bg-success" />
      </aside>
    );
  }

  // ── Aberto (344px) ──────────────────────────────────────────────────────
  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[344px] shrink-0 flex-col border-l border-border bg-surface/40 lg:flex">
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {/* Header */}
        <div className="flex items-start gap-3 px-4 pb-3 pt-4">
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

        {/* Aviso: nunca age sozinha */}
        <div className="mx-4 mb-4 flex items-start gap-2 rounded-lg bg-ai-muted/60 px-3 py-2 text-2xs text-ai ring-1 ring-ai/20">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{t('neverActsAlone')}</span>
        </div>

        {/* Sugestões */}
        <div className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
          {t('suggestionsLabel')}
        </div>
        <div className="flex flex-col gap-2.5 px-4 pb-5">
          {MOCK_SUGGESTIONS.map((s) => (
            <SuggestionCard
              key={s.id}
              s={s}
              state={states[s.id] ?? 'idle'}
              onState={(st) => setState(s.id, st)}
            />
          ))}
        </div>

        {/* Eventos ao vivo */}
        <div className="flex items-center gap-2 px-4 pb-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
            {t('liveEvents')}
          </span>
          <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-success" />
          <span className="text-2xs text-text-subtle">{t('realtime')}</span>
        </div>
        <ol className="flex flex-col gap-0 px-4 pb-6">
          {events.map((e) => (
            <li key={e.id} className="flex animate-fade-in-up gap-2.5 py-1.5">
              <span className="relative mt-1 flex flex-col items-center">
                <span className={cn('h-2 w-2 rounded-full', DOT_TONE[e.module])} />
                <span className="mt-1 w-px flex-1 bg-border" />
              </span>
              <div className="min-w-0 flex-1 pb-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide',
                      MODULE_TONE[e.module],
                    )}
                  >
                    {e.module}
                  </span>
                  <span className="font-mono text-[10px] text-text-subtle">{e.time}</span>
                </div>
                <p className="mt-0.5 text-xs leading-snug text-text-muted">{e.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Card de sugestão — máquina de estados idle → confirm → done | dismissed.
function SuggestionCard({
  s,
  state,
  onState,
}: {
  s: Suggestion;
  state: SuggestionState;
  onState: (s: SuggestionState) => void;
}) {
  const t = useTranslations('copilot');
  if (state === 'dismissed') return null;

  return (
    <div className="rounded-xl border border-dashed border-ai/40 bg-ai-muted/30 p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="rounded bg-ai-muted px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-ai">
          {t('suggestionBadge')}
        </span>
        <span className="truncate text-2xs text-text-subtle">{s.correlation}</span>
        <span className="ml-auto font-mono text-2xs text-text-subtle">{s.confidence}%</span>
      </div>
      <div className="text-[13px] font-semibold leading-snug text-text">{s.title}</div>
      <p className="mt-1 text-xs leading-snug text-text-muted">{s.body}</p>

      {/* idle */}
      {state === 'idle' && (
        <div className="mt-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onState('confirm')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent-strong"
          >
            {s.action}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onState('dismissed')}
            className="rounded-lg px-2 py-1.5 text-xs text-text-subtle transition-colors hover:bg-surface-hover hover:text-text"
          >
            {t('dismiss')}
          </button>
        </div>
      )}

      {/* confirm — humano sempre aplica */}
      {state === 'confirm' && (
        <div className="mt-2.5 rounded-lg bg-bg px-3 py-2.5 ring-1 ring-warning/30">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-warning">
            <TriangleAlert className="h-3.5 w-3.5" />
            {t('onlyYouApply')}
          </div>
          <p className="mt-1 text-xs leading-snug text-text-muted">{s.confirmNote}</p>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => onState('done')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-success px-2.5 py-1.5 text-xs font-semibold text-success-foreground transition-colors hover:brightness-110"
            >
              <Check className="h-3.5 w-3.5" />
              {t('confirmApply')}
            </button>
            <button
              type="button"
              onClick={() => onState('idle')}
              className="rounded-lg px-2 py-1.5 text-xs text-text-subtle transition-colors hover:bg-surface-hover hover:text-text"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {/* done */}
      {state === 'done' && (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-success-muted/50 px-3 py-2 ring-1 ring-success/25">
          <Check className="mt-px h-3.5 w-3.5 shrink-0 text-success" />
          <div>
            <div className="text-xs font-semibold text-success">{t('appliedByYou')}</div>
            <div className="text-2xs text-text-subtle">{t('appliedNote')}</div>
          </div>
          <button
            type="button"
            onClick={() => onState('dismissed')}
            className="ml-auto grid h-5 w-5 place-items-center rounded text-text-subtle hover:text-text"
            aria-label={t('dismiss')}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
