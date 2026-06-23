import { describe, expect, it } from 'vitest';
import { assertJobIsSafe } from './jobs.js';

const base = {
  jobId: '00000000-0000-0000-0000-000000000001',
  deviceId: '00000000-0000-0000-0000-000000000002',
  requestedBy: 'charles',
  requestedAt: '2026-06-19T12:00:00.000Z',
  kind: 'connectivity-test' as const,
  params: { mgmtIp: '10.0.0.1', username: 'netx' },
};

describe('assertJobIsSafe', () => {
  it('aceita job de leitura', () => {
    expect(() => assertJobIsSafe({ ...base, accessMode: 'read' })).not.toThrow();
  });

  it('default accessMode é read', () => {
    expect(assertJobIsSafe({ ...base }).accessMode).toBe('read');
  });

  it('recusa job de escrita sem approvedBy', () => {
    expect(() => assertJobIsSafe({ ...base, accessMode: 'write' })).toThrow(/approvedBy/);
  });

  it('aceita job de escrita com aprovação humana', () => {
    expect(() =>
      assertJobIsSafe({ ...base, accessMode: 'write', approvedBy: 'noc-lead' }),
    ).not.toThrow();
  });
});
