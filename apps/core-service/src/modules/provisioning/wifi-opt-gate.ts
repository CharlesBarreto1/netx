/**
 * WiFi-Opt — matemática PURA do rollout em ondas (sem NestJS, sem Prisma).
 *
 * Três decisões do motor de ondas (wifi-opt-rollout.service.ts) moram aqui pra
 * serem testáveis sem DB, no mesmo espírito do wifi-opt.resolver:
 *
 *   - `shouldRollback` — o rollback AUTOMÁTICO só dispara com evidência forte:
 *     baseline tinha clientes E já se passaram ≥2h do push E existe ≥1 amostra
 *     pós-push E TODAS as amostras vieram zeradas. Madrugada com 0 clientes é
 *     NORMAL — por isso a exigência de baseline>0 + janela de 2h contínuas
 *     (falso positivo de rollback re-escreve SSID do cliente à toa).
 *
 *   - `evaluateGate` — veredito da onda: RSSI médio não pode PIORAR
 *     (avgRssiDelta ≥ 0) e nenhuma ONT pode perder clientes de forma
 *     sustentada (< 70% do baseline). Zero ROLLED_BACK é checado pelo caller
 *     (é estado da onda, não amostra).
 *
 *   - `canStartWave` — regra das 48h: só inicia onda nova se a última terminou
 *     GATE_PASSED há ≥48h (timestamp persistido + cutoff — não existe scheduler
 *     de delay na casa). GATE_FAILED/CANCELLED bloqueiam até um `force`
 *     explícito (tr069.admin) destravar.
 *
 * `inHourWindow` é cópia fiel do helper privado do Tr069ReconcileService
 * (fail-closed: timezone inválida → false, nunca age fora de hora) — exposto
 * aqui com `now` injetável pra ser testável e reusável pelo motor de ondas.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */

/** Observação mínima pós-push antes de decidir rollback/APPLIED (2h). */
export const ROLLBACK_OBSERVE_MS = 2 * 3_600_000;

/** Espera pós-push antes de contar amostras de verificação (30 min). */
export const VERIFY_DELAY_MS = 30 * 60_000;

/** Queda sustentada = clientes pós-push abaixo desta fração do baseline. */
export const SUSTAINED_DROP_RATIO = 0.7;

/** Cooldown entre ondas (48h desde completedAt da última GATE_PASSED). */
export const WAVE_COOLDOWN_MS = 48 * 3_600_000;

/** Amostra agregada por device (baseline OU pós-push) — insumo do gate. */
export interface GateDeviceSample {
  /** Tr069Device.id (dbId) — chave de pareamento baseline↔pós. */
  deviceId: string;
  /** RSSI médio dos clientes (dBm, negativo). null = sem leitura. */
  avgRssi: number | null;
  /** Total de clientes associados (2.4G + 5G). null = sem leitura. */
  clients: number | null;
}

export interface GateResult {
  pass: boolean;
  /** Média dos deltas (pós − baseline) de RSSI, dBm. null = nenhum par medível. */
  avgRssiDelta: number | null;
  /** deviceIds com queda sustentada de clientes (< 70% do baseline). */
  sustainedDrops: string[];
}

/**
 * Gate de qualidade da onda: compara agregados pós-push com o baseline.
 * Device sem amostra pós-push (ou sem RSSI num dos lados) fica FORA do delta
 * e da detecção de queda — sem dado não há veredito individual (o caso
 * "sumiu todo mundo" é papel do shouldRollback por device, não do gate).
 */
export function evaluateGate(
  baseline: GateDeviceSample[],
  post: GateDeviceSample[],
): GateResult {
  const postById = new Map(post.map((p) => [p.deviceId, p]));

  const deltas: number[] = [];
  const sustainedDrops: string[] = [];

  for (const b of baseline) {
    const p = postById.get(b.deviceId);
    if (!p) continue; // sem amostras pós-push — não julga

    if (b.avgRssi !== null && p.avgRssi !== null) {
      deltas.push(p.avgRssi - b.avgRssi);
    }
    if (
      b.clients !== null &&
      b.clients > 0 &&
      p.clients !== null &&
      p.clients < b.clients * SUSTAINED_DROP_RATIO
    ) {
      sustainedDrops.push(b.deviceId);
    }
  }

  const avgRssiDelta =
    deltas.length === 0
      ? null
      : Math.round((deltas.reduce((a, d) => a + d, 0) / deltas.length) * 100) / 100;

  // Sem nenhum par medível o delta não reprova (null = "sem evidência"); a
  // reprovação por dados exige dado. ROLLED_BACK>0 reprova no caller.
  const pass = (avgRssiDelta === null || avgRssiDelta >= 0) && sustainedDrops.length === 0;
  return { pass, avgRssiDelta, sustainedDrops };
}

/** Amostra pós-push de UM device — insumo do rollback automático. */
export interface RollbackSample {
  /** Total de clientes (2.4G + 5G) da leitura. null = leitura sem Wi-Fi. */
  clients: number | null;
}

/**
 * Rollback automático dispara SSE (todas obrigatórias):
 *   1. baseline tinha clientes (baseline 0 → 0 pós-push não prova nada);
 *   2. ≥2h desde o push (madrugada zera clientes normalmente — precisa de
 *      janela sustentada, não de um instante);
 *   3. ≥1 amostra pós-push COM leitura (sem amostra = ONT offline/sem coleta,
 *      não evidência de quebra);
 *   4. TODAS as amostras com clients === 0 (uma única leitura com cliente
 *      derruba a hipótese de "SSID quebrou pra todo mundo").
 */
export function shouldRollback(
  baselineClients: number,
  samplesAfterPush: RollbackSample[],
  pushedAt: Date,
  now: Date,
): boolean {
  if (baselineClients <= 0) return false;
  if (now.getTime() - pushedAt.getTime() < ROLLBACK_OBSERVE_MS) return false;
  const measured = samplesAfterPush.filter((s) => s.clients !== null);
  if (measured.length === 0) return false;
  return measured.every((s) => s.clients === 0);
}

/**
 * Status da última onda relevante (união literal local — mantém este arquivo
 * puro, sem depender do client Prisma gerado; espelha WifiOptWaveStatus).
 */
export type WaveStatusForStart =
  | 'DRAFT'
  | 'RUNNING'
  | 'GATE_PASSED'
  | 'GATE_FAILED'
  | 'CANCELLED';

export interface CanStartWaveResult {
  ok: boolean;
  /** Motivo legível do bloqueio (null quando ok). */
  reason: string | null;
}

/**
 * Regra das 48h. `lastWave` = onda mais recente do tenant que já TERMINOU
 * (GATE_PASSED/GATE_FAILED/CANCELLED — o caller exclui DRAFT e trata RUNNING
 * como bloqueio próprio). `force` (tr069.admin) destrava qualquer bloqueio.
 */
export function canStartWave(
  lastWave: { status: WaveStatusForStart; completedAt: Date | null } | null,
  now: Date,
  force = false,
): CanStartWaveResult {
  if (force || !lastWave) return { ok: true, reason: null };

  if (lastWave.status !== 'GATE_PASSED') {
    return {
      ok: false,
      reason: `última onda terminou ${lastWave.status} — revise o gateReport ou use force`,
    };
  }
  const completedAt = lastWave.completedAt?.getTime() ?? null;
  if (completedAt === null || now.getTime() - completedAt < WAVE_COOLDOWN_MS) {
    return {
      ok: false,
      reason: 'aguarde 48h desde a conclusão da última onda (ou use force)',
    };
  }
  return { ok: true, reason: null };
}

/**
 * Hora local do tenant está em [start, end) (suporta janela que cruza
 * meia-noite)? Fail-closed: timezone inválida → false (nunca empurra pacote
 * fora de janela por engano). Cópia do inHourWindow do Tr069ReconcileService
 * com `now` injetável (testes).
 */
export function inHourWindow(
  timezone: string,
  start: number,
  end: number,
  now: Date = new Date(),
): boolean {
  try {
    const h = parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        hour12: false,
      }).format(now),
      10,
    );
    return start <= end ? h >= start && h < end : h >= start || h < end;
  } catch {
    return false;
  }
}
