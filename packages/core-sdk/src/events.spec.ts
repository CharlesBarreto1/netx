import {
  makeEnvelope,
  NoopEventPublisher,
  type EventEnvelope,
  type EventPublisher,
} from './events';

describe('makeEnvelope', () => {
  it('preenche id/occurredAt/version com defaults seguros', () => {
    const env = makeEnvelope({
      type: 'netx-erp.contract.created',
      source: 'netx-erp',
      tenantId: 't1',
      payload: { contractId: 'c1' },
    });
    expect(typeof env.id).toBe('string');
    expect(env.id.length).toBeGreaterThan(0);
    expect(env.version).toBe(1);
    expect(env.source).toBe('netx-erp');
    expect(env.tenantId).toBe('t1');
    expect(env.payload).toEqual({ contractId: 'c1' });
    // occurredAt é ISO 8601 parseável
    expect(Number.isNaN(Date.parse(env.occurredAt))).toBe(false);
  });

  it('gera ids únicos por chamada', () => {
    const a = makeEnvelope({ type: 't', source: 'netx-erp', tenantId: 't1', payload: 1 });
    const b = makeEnvelope({ type: 't', source: 'netx-erp', tenantId: 't1', payload: 1 });
    expect(a.id).not.toBe(b.id);
  });

  it('respeita overrides de id/occurredAt/version e correlationId', () => {
    const env = makeEnvelope({
      type: 't',
      source: 'netx-cpe',
      tenantId: 't1',
      payload: null,
      id: 'fixo',
      occurredAt: '2026-06-22T00:00:00.000Z',
      version: 3,
      correlationId: 'corr-1',
    });
    expect(env.id).toBe('fixo');
    expect(env.occurredAt).toBe('2026-06-22T00:00:00.000Z');
    expect(env.version).toBe(3);
    expect(env.correlationId).toBe('corr-1');
  });

  it('omite correlationId quando ausente (não vira undefined explícito)', () => {
    const env = makeEnvelope({ type: 't', source: 'netx-erp', tenantId: 't1', payload: 1 });
    expect('correlationId' in env).toBe(false);
  });
});

describe('NoopEventPublisher', () => {
  it('publish resolve sem efeito (bus desligado)', async () => {
    const pub: EventPublisher = new NoopEventPublisher();
    const env: EventEnvelope = makeEnvelope({
      type: 't',
      source: 'netx-erp',
      tenantId: 't1',
      payload: {},
    });
    await expect(pub.publish(env)).resolves.toBeUndefined();
  });
});
