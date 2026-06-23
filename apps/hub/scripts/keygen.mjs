#!/usr/bin/env node
/**
 * keygen.mjs — gera um par Ed25519 para assinar licenças.
 *
 *   PRIVATE (pkcs8/der b64) → vai no .env do Hub (LICENSE_PRIVATE_KEY_B64),
 *                             guardada em cofre. NUNCA no git.
 *   PUBLIC  (spki/der b64)  → vai embarcada no NetX em
 *                             packages/shared/src/licensing/public-key.ts
 *
 * Uso: npm run keygen
 */
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const priv = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');

console.log('# === NetX license signing keypair ===');
console.log('# PRIVADA (Hub .env → LICENSE_PRIVATE_KEY_B64) — guarde em cofre, nunca no git:');
console.log(priv);
console.log('');
console.log('# PÚBLICA (NetX → packages/shared/src/licensing/public-key.ts):');
console.log(pub);
