/**
 * Regras de alarme do painel do NOC — testes da decisão pura de disparo.
 *
 * O que estes testes travam, acima de tudo: ALARME POR AUSÊNCIA DE DADO É BUG.
 * Sem baseline, com o NMS fora do ar ou com tráfego abaixo do piso, o painel
 * tem que ficar calado. Um alarme falso na madrugada é o que ensina o operador
 * a ignorar a tela — e aí os verdadeiros passam batido também.
 */
import { deriveAlarms, type AlarmInput, type AlarmThresholds } from './alarm-rules';

const T: AlarmThresholds = {
  pppoeDropWarnPct: 10,
  pppoeDropCritPct: 25,
  pppoeDropMinAbs: 5,
  trafficDeltaWarnPct: 40,
  trafficDeltaCritPct: 65,
  trafficMinBps: 10_000_000,
  staleMin: 15,
};

/** Rede saudável: nada dispara. Cada teste altera só o que quer exercer. */
function healthy(): AlarmInput {
  return {
    sessions: { active: 100, contracts: 110, baseline: 100, deltaPct: 0, at: '2026-07-21T12:00:00Z' },
    traffic: {
      inBps: 500_000_000,
      outBps: 100_000_000,
      baselineBps: 600_000_000,
      deltaPct: 0,
      series: [],
    },
    devices: { total: 10, online: 10, offline: 0, desynced: 0, staleTelemetry: 0 },
    olts: { total: 2, online: 2, offline: 0, items: [] },
    optical: {
      measured: 500,
      ok: 500,
      low: 0,
      high: 0,
      critical: 0,
      rxLowDbm: -27,
      rxHighDbm: -8,
      worst: [],
    },
  };
}

const kinds = (i: AlarmInput): string[] => deriveAlarms(i, T).map((a) => a.kind);

describe('rede saudável', () => {
  it('não dispara nada', () => {
    expect(deriveAlarms(healthy(), T)).toEqual([]);
  });
});

describe('PPPoE — queda de sessões', () => {
  it('sem baseline não alarma (histórico ainda sendo coletado)', () => {
    const i = healthy();
    i.sessions = { ...i.sessions, active: 1, baseline: null, deltaPct: null };
    expect(kinds(i)).not.toContain('PPPOE_DROP');
  });

  it('queda percentual relevante MAS poucas sessões perdidas → não alarma', () => {
    // Rede pequena: 12 → 10 é -16.7%, acima do limiar percentual, mas só 2
    // sessões. Sem o piso absoluto isto alarmaria toda noite.
    const i = healthy();
    i.sessions = { ...i.sessions, active: 10, baseline: 12, deltaPct: -16.7 };
    expect(kinds(i)).not.toContain('PPPOE_DROP');
  });

  it('muitas sessões perdidas MAS percentual pequeno → não alarma', () => {
    // 10.000 → 9.940: 60 sessões (acima do piso), mas -0.6% é rotina.
    const i = healthy();
    i.sessions = { ...i.sessions, active: 9_940, baseline: 10_000, deltaPct: -0.6 };
    expect(kinds(i)).not.toContain('PPPOE_DROP');
  });

  it('percentual E absoluto acima do limiar → WARNING', () => {
    const i = healthy();
    i.sessions = { ...i.sessions, active: 88, baseline: 100, deltaPct: -12 };
    const a = deriveAlarms(i, T).find((x) => x.kind === 'PPPOE_DROP');
    expect(a?.severity).toBe('WARNING');
  });

  it('queda ≥ limiar crítico → CRITICAL', () => {
    const i = healthy();
    i.sessions = { ...i.sessions, active: 70, baseline: 100, deltaPct: -30 };
    const a = deriveAlarms(i, T).find((x) => x.kind === 'PPPOE_DROP');
    expect(a?.severity).toBe('CRITICAL');
  });

  it('borda exata do limiar já dispara', () => {
    const i = healthy();
    i.sessions = { ...i.sessions, active: 90, baseline: 100, deltaPct: -10 };
    expect(kinds(i)).toContain('PPPOE_DROP');
  });

  it('crescimento de sessões nunca alarma', () => {
    const i = healthy();
    i.sessions = { ...i.sessions, active: 150, baseline: 100, deltaPct: 50 };
    expect(kinds(i)).not.toContain('PPPOE_DROP');
  });
});

describe('Tráfego — queda e pico', () => {
  it('NMS fora do ar (bps null) não alarma — "não sei" não é "zero"', () => {
    const i = healthy();
    i.traffic = { ...i.traffic, inBps: null, outBps: null, deltaPct: -100 };
    expect(kinds(i)).not.toContain('TRAFFIC_DROP');
  });

  it('tráfego abaixo do piso não alarma, por maior que seja o percentual', () => {
    // 1 Mbps → 3 Mbps de madrugada: +200%, e absolutamente irrelevante.
    const i = healthy();
    i.traffic = { ...i.traffic, inBps: 2_000_000, outBps: 1_000_000, baselineBps: 1_000_000, deltaPct: 200 };
    expect(kinds(i)).not.toContain('TRAFFIC_SPIKE');
  });

  it('queda acima do limiar → TRAFFIC_DROP', () => {
    const i = healthy();
    i.traffic = { ...i.traffic, inBps: 200_000_000, outBps: 40_000_000, deltaPct: -60 };
    const a = deriveAlarms(i, T).find((x) => x.kind === 'TRAFFIC_DROP');
    expect(a?.severity).toBe('WARNING');
  });

  it('subida acima do limiar → TRAFFIC_SPIKE (pico é tão suspeito quanto queda)', () => {
    const i = healthy();
    i.traffic = { ...i.traffic, inBps: 900_000_000, outBps: 200_000_000, deltaPct: 83 };
    const a = deriveAlarms(i, T).find((x) => x.kind === 'TRAFFIC_SPIKE');
    expect(a?.severity).toBe('CRITICAL');
  });

  it('variação dentro da faixa normal não alarma', () => {
    const i = healthy();
    i.traffic = { ...i.traffic, deltaPct: 25 };
    expect(kinds(i)).not.toContain('TRAFFIC_SPIKE');
  });
});

describe('Frota', () => {
  it('NMS indisponível (offline null) não alarma', () => {
    const i = healthy();
    i.devices = { total: null, online: null, offline: null, desynced: 0, staleTelemetry: 0 };
    expect(kinds(i)).not.toContain('DEVICES_OFFLINE');
  });

  it('1 device offline → WARNING; 2+ → CRITICAL', () => {
    const one = healthy();
    one.devices = { ...one.devices, online: 9, offline: 1 };
    expect(deriveAlarms(one, T).find((a) => a.kind === 'DEVICES_OFFLINE')?.severity).toBe('WARNING');

    const many = healthy();
    many.devices = { ...many.devices, online: 7, offline: 3 };
    expect(deriveAlarms(many, T).find((a) => a.kind === 'DEVICES_OFFLINE')?.severity).toBe('CRITICAL');
  });

  it('telemetria atrasada é INFO — avisa que o painel pode estar velho', () => {
    const i = healthy();
    i.devices = { ...i.devices, staleTelemetry: 2 };
    expect(deriveAlarms(i, T).find((a) => a.kind === 'STALE_TELEMETRY')?.severity).toBe('INFO');
  });
});

describe('OLTs', () => {
  it('OLT em UNKNOWN não conta como queda ("nunca testou" ≠ "caiu")', () => {
    const i = healthy();
    i.olts = {
      total: 1,
      online: 0,
      offline: 0, // o serviço já exclui UNKNOWN da contagem
      items: [
        {
          id: 'o1',
          name: 'OLT-Centro',
          vendor: 'HUAWEI',
          status: 'UNKNOWN',
          lastSeenAt: null,
          ontsTotal: 100,
          ontsOnline: 0,
          ontsOffline: 0,
        },
      ],
    };
    expect(kinds(i)).not.toContain('OLT_OFFLINE');
  });

  it('OLT offline → CRITICAL, com as ONTs potencialmente afetadas no texto', () => {
    const i = healthy();
    i.olts = {
      total: 2,
      online: 1,
      offline: 1,
      items: [
        {
          id: 'o1',
          name: 'OLT-Centro',
          vendor: 'HUAWEI',
          status: 'OFFLINE',
          lastSeenAt: null,
          ontsTotal: 240,
          ontsOnline: 0,
          ontsOffline: 240,
        },
        {
          id: 'o2',
          name: 'OLT-Norte',
          vendor: 'ZTE',
          status: 'ONLINE',
          lastSeenAt: null,
          ontsTotal: 100,
          ontsOnline: 100,
          ontsOffline: 0,
        },
      ],
    };
    const a = deriveAlarms(i, T).find((x) => x.kind === 'OLT_OFFLINE');
    expect(a?.severity).toBe('CRITICAL');
    expect(a?.detail).toContain('OLT-Centro');
    expect(a?.detail).toContain('240');
    // A OLT saudável não pode aparecer no alarme.
    expect(a?.detail).not.toContain('OLT-Norte');
  });
});

describe('Óptica', () => {
  it('ONTs em LOS/falha → CRITICAL', () => {
    const i = healthy();
    i.optical = { ...i.optical, critical: 12 };
    const a = deriveAlarms(i, T).find((x) => x.kind === 'OPTICAL_CRITICAL');
    expect(a?.severity).toBe('CRITICAL');
    expect(a?.detail).toContain('12');
  });

  it('sinal fraco/saturado sozinho não é alarme (é tendência, não queda)', () => {
    const i = healthy();
    i.optical = { ...i.optical, ok: 400, low: 80, high: 20, critical: 0 };
    expect(kinds(i)).not.toContain('OPTICAL_CRITICAL');
  });
});

describe('ordenação', () => {
  it('mais graves primeiro — o operador lê de cima pra baixo', () => {
    const i = healthy();
    i.devices = { ...i.devices, staleTelemetry: 3 }; // INFO
    i.sessions = { ...i.sessions, active: 88, baseline: 100, deltaPct: -12 }; // WARNING
    i.optical = { ...i.optical, critical: 5 }; // CRITICAL

    const sev = deriveAlarms(i, T).map((a) => a.severity);
    expect(sev).toEqual(['CRITICAL', 'WARNING', 'INFO']);
  });
});
