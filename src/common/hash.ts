import { createHash, randomBytes } from 'node:crypto';

/** sha256 hex de um segredo (license key) — guardamos o hash, não o claro. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Gera uma license key opaca (base64url, ~32 bytes de entropia). */
export function generateLicenseKey(): string {
  return (
    'netx_' +
    randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  );
}
