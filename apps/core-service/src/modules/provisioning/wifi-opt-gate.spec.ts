/**
 * WiFi-Opt — testes da matemática pura do rollout em ondas.
 *
 * Trava as regras de segurança ANTES do motor existir: rollback automático só
 * com evidência forte (baseline>0 + 2h + todas amostras zeradas), gate reprova
 * RSSI piorando/queda sustentada de 30%, e a regra das 48h entre ondas.
 */
import {
  canStartWave,
  evaluateGate,
  inHourWindow,
  ROLLBACK_OBSERVE_MS,
  shouldRollback,
  WAVE_COOLDOWN_MS,
  type GateDeviceSample,
} from './wifi-opt-gate';

const T0 = new Date('2026-07-10T03:00:00Z');
const hoursAfter = (h: number) => new Date(T0.getTime() + h * 3_600_000);

describe('shouldRollback — rollback automático só com evidência forte', () => {
  it('baseline 0 clientes → NUNCA (0→0 não prova nada)', () => {
    expect(shouldRollback(0, [{ clients: 0 }, { clients: 0 }], T0, hoursAfter(3))).toBe(false);
  });

  it('menos de 2h desde o push → não (madrugada zera clientes normalmente)', () => {
    expect(shouldRollback(5, [{ clients: 0 }], T0, hoursAfter(1))).toBe(false);
    // borda exata: 2h em ponto JÁ permite decidir
    expect(shouldRollback(5, [{ clients: 0 }], T0, new Date(T0.getTime() + ROLLBACK_OBSERVE_MS))).toBe(true);
  });

  it('qualquer amostra com clientes → não (SSID não quebrou pra todo mundo)', () => {
    expect(shouldRollback(5, [{ clients: 0 }, { clients: 2 }, { clients: 0 }], T0, hoursAfter(3))).toBe(false);
  });

  it('2h com só zeros → sim', () => {
    expect(shouldRollback(5, [{ clients: 0 }, { clients: 0 }], T0, hoursAfter(3))).toBe(true);
  });

  it('sem amostras pós-push → não (offline não é evidência de quebra)', () => {
    expect(shouldRollback(5, [], T0, hoursAfter(3))).toBe(false);
    // amostras sem leitura de Wi-Fi (clients null) também não contam
    expect(shouldRollback(5, [{ clients: null }], T0, hoursAfter(3))).toBe(false);
  });
});

describe('evaluateGate — veredito da onda', () => {
  const base = (deviceId: string, avgRssi: number | null, clients: number | null): GateDeviceSample => ({
    deviceId,
    avgRssi,
    clients,
  });

  it('RSSI melhorou (delta positivo) e clientes estáveis → pass', () => {
    const r = evaluateGate(
      [base('a', -70, 10), base('b', -60, 4)],
      [base('a', -65, 9), base('b', -58, 4)],
    );
    expect(r.pass).toBe(true);
    expect(r.avgRssiDelta).toBe(3.5); // ((-65+70) + (-58+60)) / 2
    expect(r.sustainedDrops).toEqual([]);
  });

  it('RSSI médio piorou (delta negativo) → reprova', () => {
    const r = evaluateGate([base('a', -60, 10)], [base('a', -68, 10)]);
    expect(r.pass).toBe(false);
    expect(r.avgRssiDelta).toBe(-8);
  });

  it('queda sustentada de 30%+ dos clientes reprova e lista o device', () => {
    // 10 → 6 clientes = 60% do baseline (< 70%) → drop sustentado
    const r = evaluateGate([base('a', -60, 10)], [base('a', -60, 6)]);
    expect(r.pass).toBe(false);
    expect(r.sustainedDrops).toEqual(['a']);
    // 10 → 7 = exatamente 70% NÃO é drop (limite é estrito)
    const ok = evaluateGate([base('a', -60, 10)], [base('a', -60, 7)]);
    expect(ok.pass).toBe(true);
    expect(ok.sustainedDrops).toEqual([]);
  });

  it('device sem amostras pós-push fica fora do delta e dos drops', () => {
    const r = evaluateGate([base('a', -60, 10), base('b', -70, 5)], [base('a', -59, 10)]);
    expect(r.pass).toBe(true);
    expect(r.avgRssiDelta).toBe(1); // só o par de 'a'
    expect(r.sustainedDrops).toEqual([]);
  });

  it('nenhum par medível → delta null e pass (sem evidência não reprova)', () => {
    const r = evaluateGate([base('a', null, null)], []);
    expect(r.pass).toBe(true);
    expect(r.avgRssiDelta).toBeNull();
  });
});

describe('canStartWave — regra das 48h', () => {
  it('sem onda anterior → ok', () => {
    expect(canStartWave(null, T0)).toEqual({ ok: true, reason: null });
  });

  it('última GATE_PASSED há mais de 48h → ok', () => {
    const last = { status: 'GATE_PASSED' as const, completedAt: T0 };
    expect(canStartWave(last, new Date(T0.getTime() + WAVE_COOLDOWN_MS + 1)).ok).toBe(true);
  });

  it('última GATE_PASSED há menos de 48h → bloqueia', () => {
    const last = { status: 'GATE_PASSED' as const, completedAt: T0 };
    const r = canStartWave(last, hoursAfter(47));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/48h/);
  });

  it('última GATE_FAILED bloqueia independente do tempo', () => {
    const last = { status: 'GATE_FAILED' as const, completedAt: T0 };
    const r = canStartWave(last, hoursAfter(100));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/GATE_FAILED/);
  });

  it('force destrava qualquer bloqueio (GATE_FAILED e cooldown)', () => {
    expect(canStartWave({ status: 'GATE_FAILED', completedAt: T0 }, hoursAfter(1), true).ok).toBe(true);
    expect(canStartWave({ status: 'GATE_PASSED', completedAt: T0 }, hoursAfter(1), true).ok).toBe(true);
  });
});

describe('inHourWindow — janela horária local (fail-closed)', () => {
  // ⚠️ America/Asuncion é -03 no tzdata novo (PY aboliu o DST em 2024) e -04
  // em jul no tzdata velho. Os instantes abaixo foram escolhidos pra TODAS as
  // asserções valerem nos DOIS offsets (teste não depende da versão do ICU).
  // 03:00Z = 00:00 local (-03) ou 23:00 do dia anterior (-04).
  const nowUtc3 = new Date('2026-07-10T03:00:00Z');

  it('dentro e fora da janela simples', () => {
    // 00:00/23:00 local NÃO está em [2,5)
    expect(inHourWindow('America/Asuncion', 2, 5, nowUtc3)).toBe(false);
    // 06:30Z = 03:30/02:30 local → dentro
    expect(inHourWindow('America/Asuncion', 2, 5, new Date('2026-07-10T06:30:00Z'))).toBe(true);
  });

  it('janela que cruza meia-noite (22 → 2)', () => {
    // 00:00/23:00 local ∈ [22, 2)
    expect(inHourWindow('America/Asuncion', 22, 2, nowUtc3)).toBe(true);
    // 07:00Z = 04:00/03:00 local ∉ [22, 2)
    expect(inHourWindow('America/Asuncion', 22, 2, new Date('2026-07-10T07:00:00Z'))).toBe(false);
  });

  it('timezone inválida → false (fail-closed, nunca age fora de hora)', () => {
    expect(inHourWindow('Fuso/Inexistente', 0, 24, nowUtc3)).toBe(false);
  });
});
