import * as argon2 from 'argon2';

export interface Argon2Options {
  memoryCost?: number;
  timeCost?: number;
  parallelism?: number;
}

const DEFAULTS: Required<Argon2Options> = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * Hash a plaintext password with argon2id (OWASP 2024 recommended).
 */
export async function hashPassword(password: string, opts: Argon2Options = {}): Promise<string> {
  const config = { ...DEFAULTS, ...opts };
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: config.memoryCost,
    timeCost: config.timeCost,
    parallelism: config.parallelism,
  });
}

/**
 * Verify a plaintext password against a stored argon2 hash.
 * Returns false on any error instead of throwing (to avoid leaking timing info).
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Basic password strength check. Full password policy is delegated to the
 * auth module's controller — this function is just the bare-minimum gate.
 */
export function assertPasswordStrength(password: string): void {
  const errors: string[] = [];
  if (password.length < 12) errors.push('mínimo de 12 caracteres');
  if (!/[a-z]/.test(password)) errors.push('pelo menos uma letra minúscula');
  if (!/[A-Z]/.test(password)) errors.push('pelo menos uma letra maiúscula');
  if (!/\d/.test(password)) errors.push('pelo menos um dígito');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('pelo menos um caractere especial');
  if (errors.length) {
    throw new Error(`Senha fraca: ${errors.join(', ')}`);
  }
}
