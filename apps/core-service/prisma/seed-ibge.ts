/**
 * Seed da referência nacional de municípios do IBGE (tabela ibge_municipalities).
 *
 * Fonte oficial: API de localidades do IBGE (servicodados.ibge.gov.br).
 * Global (sem tenant) e read-only — alimenta o autocomplete de cidade e o
 * codMunicipio (7 dígitos) do módulo fiscal (NFCom). Idempotente: re-rodar só
 * insere os que faltam.
 *
 * Run:  npm run -w apps/core-service db:seed:ibge
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const IBGE_URL =
  'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome';

interface IbgeApiMunicipio {
  id: number;
  nome: string;
  microrregiao?: { mesorregiao?: { UF?: { sigla?: string } } };
  // alguns municípios (ex. distritos estaduais) vêm pela regiao-imediata:
  'regiao-imediata'?: { 'regiao-intermediaria'?: { UF?: { sigla?: string } } };
}

function ufOf(m: IbgeApiMunicipio): string | null {
  return (
    m.microrregiao?.mesorregiao?.UF?.sigla ??
    m['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla ??
    null
  );
}

async function main() {
  console.log('🌐 Baixando municípios do IBGE…');
  const res = await fetch(IBGE_URL);
  if (!res.ok) throw new Error(`IBGE API HTTP ${res.status}`);
  const data = (await res.json()) as IbgeApiMunicipio[];
  console.log(`   recebidos ${data.length} municípios`);

  const rows = data
    .map((m) => {
      const uf = ufOf(m);
      return uf ? { codigo: String(m.id), nome: m.nome, uf } : null;
    })
    .filter((r): r is { codigo: string; nome: string; uf: string } => r !== null);

  const skipped = data.length - rows.length;
  if (skipped > 0) console.warn(`   ⚠️  ${skipped} sem UF resolvida — ignorados`);

  const result = await prisma.ibgeMunicipality.createMany({
    data: rows,
    skipDuplicates: true,
  });

  const total = await prisma.ibgeMunicipality.count();
  console.log(`✅ IBGE seed: +${result.count} novos · ${total} no total.`);
}

main()
  .catch((e) => {
    console.error('❌ IBGE seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
