#!/usr/bin/env node
/**
 * Guarda de segurança: RECUSA rodar Prisma do NMS se o DATABASE_URL não estiver
 * isolado no schema `nms` (invariante 3 do ecossistema — cada módulo é dono
 * exclusivo do seu schema). Sem isto, um `.env` mal configurado faz as migrations
 * do NMS aplicarem no schema `public` do Core e CORROMPEM o histórico de
 * migrations do NetX (P3009). Já aconteceu uma vez — este guard impede a recidiva.
 *
 * Lê o DATABASE_URL de apps/nms/apps/api/.env (a mesma fonte que o Prisma usa) e,
 * como fallback, do process.env. Roda ANTES de `prisma migrate deploy/dev` e
 * `prisma generate`. Ver docs/ecosystem/INTEGRATION-RUNBOOK.md §A.
 */
const fs = require('node:fs');
const path = require('node:path');

function readEnvDatabaseUrl() {
  // process.env tem precedência (CI/containers que injetam direto).
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.resolve(__dirname, '..', 'apps', 'api', '.env');
  if (!fs.existsSync(envPath)) {
    console.error(`[nms] .env não encontrado em ${envPath} — crie a partir de .env.example.`);
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, 'utf8');
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#') || !line.startsWith('DATABASE_URL')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    return val;
  }
  return undefined;
}

const url = readEnvDatabaseUrl();
if (!url) {
  console.error('[nms] DATABASE_URL ausente — configure apps/nms/apps/api/.env.');
  process.exit(1);
}

const hasNmsSchema = /[?&]schema=nms(&|$)/.test(url);
if (!hasNmsSchema) {
  const masked = url.replace(/:\/\/[^@]*@/, '://***:***@');
  console.error(
    '\n[nms] RECUSADO: o DATABASE_URL do NMS PRECISA terminar com `?schema=nms`.\n' +
      '      O NMS é dono exclusivo do schema `nms` (invariante 3). Sem isso, as\n' +
      '      migrations cairiam no schema `public` do Core e quebrariam o NetX.\n' +
      `      DATABASE_URL atual: ${masked}\n` +
      '      Corrija apps/nms/apps/api/.env (ex.: ...netx?schema=nms) e rode de novo.\n',
  );
  process.exit(1);
}

console.log('[nms] DATABASE_URL ok (schema=nms isolado).');
