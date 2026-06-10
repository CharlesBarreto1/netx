#!/usr/bin/env node
/**
 * license-mint-dev.mjs — assina um token de licença NetX para TESTE LOCAL,
 * simulando o que o Hub (netx-hub) fará em produção. NÃO usar em produção: o
 * Hub é a única fonte legítima de tokens.
 *
 * A chave PRIVADA vem por env (nunca embutida) — pegue do cofre do Hub ou, em
 * dev, de ~/Documents/netx-hub-secrets/license-signing-key.dev.txt.
 *
 * Uso:
 *   LICENSE_PRIVATE_KEY_B64=<pkcs8/der base64> \
 *   node infra/installer/scripts/license-mint-dev.mjs \
 *     --instance <uuid> [--status ACTIVE|BLOCKED|SUSPENDED] \
 *     [--days 7] [--block-mode UI_ONLY|UI_AND_PROVISIONING] [--max 0]
 *
 * Imprime o token JWS. Pra testar o guard: cole num GET /v1/license/heartbeat
 * fake, ou injete direto em license_state.token e reinicie o core.
 */
import { createPrivateKey, sign as edSign } from 'node:crypto';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const privB64 = process.env.LICENSE_PRIVATE_KEY_B64;
if (!privB64) {
  console.error('ERRO: defina LICENSE_PRIVATE_KEY_B64 (pkcs8/der base64).');
  process.exit(1);
}
const instanceId = arg('instance', '');
if (!instanceId) {
  console.error('ERRO: --instance <uuid> é obrigatório.');
  process.exit(1);
}

const status = arg('status', 'ACTIVE');
const days = Number(arg('days', '7'));
const blockMode = arg('block-mode', 'UI_ONLY');
const maxContracts = Number(arg('max', '0'));

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const now = Math.floor(Date.now() / 1000);
const header = { alg: 'EdDSA', typ: 'netx-lic' };
const claims = {
  iss: 'netx-hub',
  sub: instanceId,
  status,
  plan: 'per-contract',
  maxContracts,
  blockMode,
  iat: now,
  exp: now + days * 86400,
};

const privateKey = createPrivateKey({
  key: Buffer.from(privB64, 'base64'),
  format: 'der',
  type: 'pkcs8',
});

const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
const signature = edSign(null, Buffer.from(signingInput), privateKey);
const token = `${signingInput}.${b64url(signature)}`;

console.log(token);
