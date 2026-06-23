import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

// promisify infere a sobrecarga sem `options`; tipamos para a variante com parâmetros de custo.
const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Hash de senha com scrypt nativo do Node (sem dependência nativa que complique o Docker — ADR 0007).
 * Formato: `scrypt:N:r:p:saltB64:hashB64`. Os parâmetros ficam embutidos para permitir rehash futuro.
 */
const N = 16384; // custo de CPU/memória (2^14)
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(plain, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt:${N}:${R}:${P}:${salt.toString('base64')}:${derived.toString('base64')}`;
}

/** Verifica a senha em tempo constante. Retorna false (em vez de lançar) para qualquer hash malformado. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const salt = Buffer.from(saltB64!, 'base64');
  const expected = Buffer.from(hashB64!, 'base64');
  const derived = await scrypt(plain, salt, expected.length, { N: n, r, p });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
