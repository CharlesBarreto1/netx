import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Hash de senha com scrypt (sem dependência nativa). Formato:
 * `scrypt$<saltHex>$<hashHex>`. scrypt é memory-hard — bom contra brute force.
 */
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const got = scryptSync(password, salt, expected.length || KEYLEN);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
