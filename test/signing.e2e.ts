/**
 * Teste de compatibilidade Hub ↔ NetX: o token assinado pelo SigningService do
 * Hub é aceito pelo verificador real do NetX (verifyLicenseToken). Prova que os
 * dois lados usam exatamente o mesmo formato — qualquer drift quebra aqui.
 *
 * Usa a chave DEV (cuja pública está embarcada no NetX). Fontes da privada,
 * em ordem: env LICENSE_PRIVATE_KEY_B64 → arquivo de segredos dev.
 *
 * Uso: npm run test:signing
 * (requer o NetX shared compilado: cd ../../netx && npm run build -w @netx/shared)
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { SigningService } from '../src/signing/signing.service';

function loadDevPrivateKey(): string {
  if (process.env.LICENSE_PRIVATE_KEY_B64) return process.env.LICENSE_PRIVATE_KEY_B64;
  const secretsFile = join(homedir(), 'Documents/netx-hub-secrets/license-signing-key.dev.txt');
  if (existsSync(secretsFile)) {
    const txt = readFileSync(secretsFile, 'utf8');
    const m = /PRIVATE_KEY_B64[^:]*:\s*([A-Za-z0-9+/=]+)/.exec(txt);
    if (m) return m[1];
  }
  throw new Error(
    'Defina LICENSE_PRIVATE_KEY_B64 (chave DEV cuja pública está embarcada no NetX).',
  );
}

// Verificador real do NetX (dist compilado do sibling repo).
function loadNetxVerifier(): {
  verifyLicenseToken: (t: string) => { ok: boolean; reason?: string; claims?: any };
  licenseDecision: (v: any, now: number) => { effect: string };
} {
  const candidates = [
    join(__dirname, '../../netx/packages/shared/dist/licensing/token.js'),
    join(__dirname, '../../../netx/packages/shared/dist/licensing/token.js'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return require(p);
  }
  throw new Error(
    'NetX shared não compilado. Rode em ~/Documents/netx: npm run build -w @netx/shared',
  );
}

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`❌ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

function main() {
  process.env.LICENSE_PRIVATE_KEY_B64 = loadDevPrivateKey();
  const signing = new SigningService();
  const { verifyLicenseToken, licenseDecision } = loadNetxVerifier();
  const instanceId = '11111111-1111-4111-8111-111111111111';

  // 1) ACTIVE → verifica e decide ALLOW
  const active = signing.issue({
    instanceId,
    status: 'ACTIVE',
    blockMode: 'UI_ONLY',
    plan: 'per-contract',
    maxContracts: 0,
  });
  const v1 = verifyLicenseToken(active.token);
  assert(v1.ok, 'token ACTIVE é verificado pelo NetX');
  assert(v1.claims?.sub === instanceId, 'claim sub = instanceId');
  const now = Math.floor(Date.now() / 1000);
  assert(licenseDecision(v1, now).effect === 'ALLOW', 'decisão ACTIVE = ALLOW');

  // 2) BLOCKED → decide BLOCK_UI
  const blocked = signing.issue({
    instanceId,
    status: 'BLOCKED',
    blockMode: 'UI_ONLY',
    plan: 'per-contract',
    maxContracts: 0,
  });
  const v2 = verifyLicenseToken(blocked.token);
  assert(v2.ok, 'token BLOCKED é verificado pelo NetX');
  assert(licenseDecision(v2, now).effect === 'BLOCK_UI', 'decisão BLOCKED = BLOCK_UI');

  // 3) token adulterado → rejeitado
  const tampered = active.token.slice(0, -4) + 'AAAA';
  assert(!verifyLicenseToken(tampered).ok, 'token adulterado é rejeitado');

  // 4) token COM claim `modules` → verificado e claim preservado (forward-compat).
  // Prova que o claim viaja sob a assinatura e o verificador novo o tolera.
  const withMods = signing.sign({
    iss: 'netx-hub',
    sub: instanceId,
    status: 'ACTIVE',
    plan: 'per-contract',
    maxContracts: 0,
    blockMode: 'UI_ONLY',
    iat: now,
    exp: now + 7 * 86400,
    graceUntil: now + 9 * 86400,
    modules: ['netx-erp', 'netx-cpe'],
  });
  const v4 = verifyLicenseToken(withMods);
  assert(v4.ok, 'token com claim modules é verificado pelo NetX');
  assert(
    Array.isArray(v4.claims?.modules) && v4.claims.modules.length === 2,
    'claim modules preservado no round-trip',
  );

  console.log('\n✅ Hub ↔ NetX: formato de token compatível.');
}

main();
