#!/usr/bin/env node
/**
 * Mostra a resposta de `GET ServiceOrder/order/{id}` de um serviço Ufinet, pra
 * verificar se a ORDEM já traz os 4 ids do bundle (Datos/Fiber/HSD/Res Pon
 * Access) — o que permite descobrir os ids SEM baixar o inventário inteiro.
 *
 * Uso (na VPS, com o env carregado):
 *   sudo -u netx -H bash -lc 'set -a; . /etc/netx/.env; . /etc/netx/.secrets; set +a; \
 *     cd /opt/netx && node scripts/ufinet-dump-order.mjs ZUX-18'
 */
import { createDecipheriv } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const externalId = process.argv[2] || 'ZUX-18';

function decrypt(ct, hex) {
  const [v, iv, tag, c] = String(ct).split(':');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(hex, 'hex'), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(c, 'base64url')), d.final()]).toString('utf8');
}

const prisma = new PrismaClient();
const SPEC = { '3': 'Fiber Access', '4': 'Res Pon Access', '5': 'HSD', '10': 'Datos' };

async function main() {
  const kms = process.env.KMS_MASTER_KEY;
  if (!kms) throw new Error('KMS_MASTER_KEY ausente');
  const svc = await prisma.ufinetService.findFirst({
    where: { externalId },
    select: { oltId: true, serviceOrderId: true },
  });
  if (!svc?.serviceOrderId) throw new Error(`ufinet_services sem serviceOrderId pra ${externalId}`);
  const olt = await prisma.olt.findFirst({
    where: { id: svc.oltId },
    select: { apiEndpoint: true, apiCredentialsEnc: true, apiConfig: true },
  });
  const creds = JSON.parse(decrypt(olt.apiCredentialsEnc, kms));
  const cfg = olt.apiConfig ?? {};
  const base = olt.apiEndpoint.replace(/\/+$/, '');

  const tk = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: creds.clientId, client_secret: creds.clientSecret, scope: cfg.scope }),
  }).then((r) => r.json());
  if (!tk.access_token) throw new Error('OAuth falhou');

  const r = await fetch(`${base}/ServiceOrder/order/${svc.serviceOrderId}`, {
    headers: { Authorization: `Bearer ${tk.access_token}`, Access: creds.accessKey, Accept: 'application/json' },
  });
  const body = await r.json();
  const order = body?.data ?? body;

  console.log(`Ordem ${svc.serviceOrderId}  (${externalId})  state=${order?.state}\n`);
  const items = order?.serviceOrderItem ?? [];
  console.log(`serviceOrderItem: ${items.length}`);

  // Coleta todos os "service" (e aninhados) com id + spec
  const found = [];
  const walk = (s, d = 0) => {
    if (!s || typeof s !== 'object') return;
    if (s.id && s.serviceSpecification) {
      const sp = String(s.serviceSpecification.id ?? '');
      found.push({ id: s.id, spec: sp, name: SPEC[sp] ?? s.serviceSpecification.name, ext: s.externalServiceId, parent: s.parentServiceId });
    }
    for (const k of ['service', 'serviceRelationship', 'childService', 'serviceOrderItem']) {
      const v = s[k];
      if (Array.isArray(v)) v.forEach((x) => walk(x.service ?? x, d + 1));
      else if (v) walk(v.service ?? v, d + 1);
    }
  };
  items.forEach((it) => walk(it.service ?? it));

  console.log(`\nServiços encontrados na ORDEM: ${found.length}`);
  for (const f of found) console.log(`  spec=${f.spec} (${f.name})  id=${f.id}  ext=${f.ext ?? '-'}  parent=${f.parent ?? '-'}`);

  const specs = new Set(found.map((f) => f.spec));
  const has4 = ['3', '4', '5', '10'].every((s) => specs.has(s));
  console.log('\n=== VEREDITO ===');
  if (has4) console.log('✅ A ORDEM traz os 4 ids do bundle → dá pra descobrir SEM o inventário inteiro.');
  else console.log(`⚠️  A ordem traz só ${found.length} serviço(s) (specs: ${[...specs].join(',') || '-'}). Os ids do bundle podem precisar de outro caminho — me manda essa saída.`);
}

main().catch((e) => { console.error('ERRO:', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
