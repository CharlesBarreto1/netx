import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.util.js';

describe('password.util', () => {
  it('faz round-trip de hash e verificação', async () => {
    const hash = await hashPassword('senha-super-secreta');
    expect(hash.startsWith('scrypt:')).toBe(true);
    expect(hash).not.toContain('senha-super-secreta');
    expect(await verifyPassword('senha-super-secreta', hash)).toBe(true);
  });

  it('rejeita senha errada', async () => {
    const hash = await hashPassword('correta');
    expect(await verifyPassword('errada', hash)).toBe(false);
  });

  it('usa salt aleatório (hashes diferentes para a mesma senha)', async () => {
    const a = await hashPassword('igual');
    const b = await hashPassword('igual');
    expect(a).not.toBe(b);
  });

  it('retorna false (sem lançar) para hash malformado', async () => {
    expect(await verifyPassword('x', 'lixo')).toBe(false);
    expect(await verifyPassword('x', 'scrypt:so:tres:campos')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });
});
