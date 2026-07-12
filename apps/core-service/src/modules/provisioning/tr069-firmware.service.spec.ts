/**
 * planFirmwareDeploy — regras de alvo do rollout de firmware.
 *
 * Invariantes: cada device pulado conta em UM só motivo (offline → versão →
 * em-curso, nessa ordem) e OFFLINE entra na fila quando onlyOnline=false
 * (pega a task quando voltar — comportamento desejado pra parque instável).
 */
import { planFirmwareDeploy, type FirmwareDeployCandidate } from './tr069-firmware.service';

const dev = (
  id: string,
  status: string,
  softwareVersion: string | null,
): FirmwareDeployCandidate => ({ id, deviceId: `6CD2A2-${id}`, status, softwareVersion });

describe('planFirmwareDeploy', () => {
  const V = 'V9.0.11P3N10';

  it('enfileira só ONLINE fora da versão e sem DOWNLOAD em curso', () => {
    const plan = planFirmwareDeploy(
      [dev('a', 'ONLINE', 'V9.0.10P1N12A'), dev('b', 'ONLINE', V), dev('c', 'OFFLINE', null)],
      V,
      { onlyOnline: true, skipSameVersion: true },
      new Set(),
    );
    expect(plan.enqueueIds).toEqual(['a']);
    expect(plan.skippedSameVersion).toBe(1);
    expect(plan.skippedOffline).toBe(1);
    expect(plan.skippedInflight).toBe(0);
  });

  it('device com DOWNLOAD em curso é pulado (não duplica task)', () => {
    const plan = planFirmwareDeploy(
      [dev('a', 'ONLINE', null), dev('b', 'ONLINE', null)],
      V,
      { onlyOnline: true, skipSameVersion: true },
      new Set(['b']),
    );
    expect(plan.enqueueIds).toEqual(['a']);
    expect(plan.skippedInflight).toBe(1);
  });

  it('onlyOnline=false inclui OFFLINE (recebe a task quando voltar)', () => {
    const plan = planFirmwareDeploy(
      [dev('a', 'OFFLINE', null)],
      V,
      { onlyOnline: false, skipSameVersion: true },
      new Set(),
    );
    expect(plan.enqueueIds).toEqual(['a']);
    expect(plan.skippedOffline).toBe(0);
  });

  it('skipSameVersion=false força re-flash de quem já está na versão', () => {
    const plan = planFirmwareDeploy(
      [dev('a', 'ONLINE', V)],
      V,
      { onlyOnline: true, skipSameVersion: false },
      new Set(),
    );
    expect(plan.enqueueIds).toEqual(['a']);
  });

  it('cada device pulado conta em UM motivo só (offline vence versão)', () => {
    const plan = planFirmwareDeploy(
      [dev('a', 'OFFLINE', V)],
      V,
      { onlyOnline: true, skipSameVersion: true },
      new Set(['a']),
    );
    expect(plan.skippedOffline).toBe(1);
    expect(plan.skippedSameVersion).toBe(0);
    expect(plan.skippedInflight).toBe(0);
  });
});
