import { randomBytes, createHash } from 'crypto';

const PREFIXES = {
  development: 'netx_dev',
  staging: 'netx_test',
  production: 'netx_live',
} as const;

export interface GeneratedApiKey {
  key: string;       // full key shown once to the user
  keyPrefix: string; // displayable prefix, stored in DB
  keyHash: string;   // SHA-256, stored in DB for lookup
}

/**
 * Generate an API key. Format: `<prefix>_<32 bytes base64url>`.
 * The prefix uses the environment so ops teams can spot misuse.
 */
export function generateApiKey(env: keyof typeof PREFIXES = 'development'): GeneratedApiKey {
  const prefix = PREFIXES[env];
  const raw = randomBytes(32).toString('base64url');
  const key = `${prefix}_${raw}`;
  const keyPrefix = `${prefix}_${raw.slice(0, 6)}`;
  const keyHash = createHash('sha256').update(key).digest('hex');
  return { key, keyPrefix, keyHash };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
