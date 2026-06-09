#!/usr/bin/env node
/**
 * Testa se a API da Ufinet filtra o ServiceInventory por externalServiceId no
 * SERVIDOR — comparando o GET COM filtro vs SEM filtro, contra a API real.
 *
 * Reusa as credenciais já cadastradas na OLT (decifra apiCredentialsEnc com o
 * KMS_MASTER_KEY, faz OAuth + Access key). NÃO cria/altera nada na Ufinet — só GETs.
 *
 * Uso (na VPS, com o env do NetX carregado):
 *   sudo -u netx -H bash -lc 'set -a; . /etc/netx/.env; . /etc/netx/.secrets; set +a; \
 *     cd /opt/netx && node scripts/ufinet-test-filter.mjs ZUX-18'
 *
 * Opcional: 2º arg = nome do query param (default "externalServiceId").
 */
import { createDecipheriv } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const externalId = process.argv[2] || 'ZUX-18';
const PARAM = process.argv[3] || 'externalServiceId';

function decrypt(ciphertext, masterKeyHex) {
  const [v, ivB64, tagB64, ctB64] = String(ciphertext).split(':');
  if (v !== 'v1') throw new Error(`formato de cripto inesperado: ${v}`);
  const key = Buffer.from(masterKeyHex, 'hex');
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const ct = Buffer.from(ctB64, 'base64url');
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

const prisma = new PrismaClient();

async function main() {
  const kms = process.env.KMS_MASTER_KEY;
  if (!kms) throw new Error('KMS_MASTER_KEY ausente no env (carregue /etc/netx/.secrets)');

  // Acha a OLT do serviço (pelo ufinet_services) ou a 1ª OLT UFINET.
  const svc = await prisma.ufinetService.findFirst({
    where: { externalId },
    select: { oltId: true },
  });
  const olt = await prisma.olt.findFirst({
    where: svc
      ? { id: svc.oltId }
      : { vendor: 'UFINET', providerMode: 'ORCHESTRATOR', deletedAt: null },
    select: { name: true, apiEndpoint: true, apiCredentialsEnc: true, apiConfig: true },
  });
  if (!olt) throw new Error('Nenhuma OLT UFINET encontrada');
  if (!olt.apiEndpoint || !olt.apiCredentialsEnc) throw new Error('OLT sem apiEndpoint/credenciais');

  const creds = JSON.parse(decrypt(olt.apiCredentialsEnc, kms));
  const cfg = olt.apiConfig ?? {};
  const base = olt.apiEndpoint.replace(/\/+$/, '');

  console.log(`OLT: ${olt.name}`);
  console.log(`base: ${base}`);
  console.log(`externalId de teste: ${externalId}  |  param: ${PARAM}\n`);

  // OAuth2 client_credentials
  const tokenRes = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      scope: cfg.scope,
    }),
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenJson.access_token) {
    throw new Error(`OAuth falhou (${tokenRes.status}): ${tokenJson.error_description ?? JSON.stringify(tokenJson)}`);
  }
  const token = tokenJson.access_token;
  console.log('OAuth OK\n');

  async function get(path) {
    const t0 = Date.now();
    const r = await fetch(`${base}/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Access: creds.accessKey, Accept: 'application/json' },
    });
    const text = await r.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: r.status, ms: Date.now() - t0, body, bytes: text.length };
  }

  function asArray(body) {
    if (Array.isArray(body)) return body;
    for (const k of ['service', 'data', 'result']) if (Array.isArray(body?.[k])) return body[k];
    return null;
  }
  const distinctExt = (arr) =>
    [...new Set((arr ?? []).map((s) => s?.externalServiceId).filter(Boolean))];

  // 1) COM filtro
  const filtered = await get(`ServiceInventory/service?${encodeURIComponent(PARAM)}=${encodeURIComponent(externalId)}`);
  const fArr = asArray(filtered.body);
  console.log(`[COM filtro]  status=${filtered.status}  ${filtered.ms}ms  ${(filtered.bytes / 1024).toFixed(1)}KB  itens=${fArr?.length ?? 'n/a'}`);
  if (fArr) console.log(`              externalServiceIds: ${distinctExt(fArr).join(', ') || '(vazio)'}`);
  else console.log(`              corpo: ${JSON.stringify(filtered.body).slice(0, 300)}`);

  // 2) SEM filtro (inventário inteiro)
  const full = await get('ServiceInventory/service');
  const uArr = asArray(full.body);
  console.log(`\n[SEM filtro]  status=${full.status}  ${full.ms}ms  ${(full.bytes / 1024).toFixed(1)}KB  itens=${uArr?.length ?? 'n/a'}  externalIds distintos=${distinctExt(uArr).length}`);

  // Veredito
  console.log('\n=== VEREDITO ===');
  if (filtered.status >= 400) {
    console.log(`❌ A Ufinet REJEITOU o filtro "${PARAM}" (HTTP ${filtered.status}). Tente outro nome de param.`);
  } else if (fArr && uArr && fArr.length < uArr.length && distinctExt(fArr).every((e) => e === externalId)) {
    console.log(`✅ FILTRA NO SERVIDOR! Com filtro veio ${fArr.length} itens (só ${externalId}); sem filtro, ${uArr.length}.`);
    console.log(`   → Habilite: api_config.inventoryFilterParam = "${PARAM}" na OLT.`);
  } else if (fArr && uArr && fArr.length === uArr.length) {
    console.log(`⚠️  A Ufinet IGNOROU o filtro (mesma quantidade com e sem). Confirme o nome do param com eles.`);
  } else {
    console.log('⚠️  Resultado ambíguo — confira os números acima.');
  }
}

main()
  .catch((e) => { console.error('ERRO:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
