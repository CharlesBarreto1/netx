/**
 * Banco dos testes de integração.
 *
 * Resolve a URL, GUARDA contra apontar para banco de produção, e expõe
 * `truncateAll()` para isolar um teste do outro.
 */
import { PrismaClient } from '@prisma/client';

/**
 * Resolve a URL do banco de teste.
 *
 * Prioridade: DATABASE_URL_TEST > DATABASE_URL com o nome do banco trocado.
 * A derivação existe para o dev rodar `npm run test:e2e` sem configurar nada.
 */
export function resolveTestDatabaseUrl(): string {
  const explicit = process.env.DATABASE_URL_TEST;
  if (explicit) return assertIsTestDatabase(explicit);

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      'Nem DATABASE_URL_TEST nem DATABASE_URL definidos. ' +
        'Rode `npm run db:test:setup` e exporte DATABASE_URL_TEST.',
    );
  }
  // Troca só o nome do banco, preservando credenciais, host, porta e query string.
  const derived = base.replace(/\/([^/?]+)(\?|$)/, '/$1_test$2');
  return assertIsTestDatabase(derived);
}

/**
 * Trava de segurança. Estes testes fazem TRUNCATE em todas as tabelas — apontar
 * isso para o banco errado apaga a operação inteira. O nome do banco TEM que
 * terminar em `_test`. Não relaxe esta checagem.
 */
export function assertIsTestDatabase(url: string): string {
  let dbName: string;
  try {
    dbName = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error('URL de banco inválida para testes.');
  }

  if (!dbName.endsWith('_test')) {
    throw new Error(
      `RECUSANDO RODAR: o banco de teste resolvido é "${dbName}", que não termina em "_test".\n` +
        'Os testes de integração truncam todas as tabelas. Abortando para não destruir dados reais.',
    );
  }
  return url;
}

let client: PrismaClient | undefined;

/** Client Prisma dos testes, fixado no banco de teste. */
export function testPrisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient({
      datasources: { db: { url: resolveTestDatabaseUrl() } },
      log: process.env.TEST_DB_LOG === '1' ? ['query', 'warn', 'error'] : ['warn', 'error'],
    });
  }
  return client;
}

export async function disconnectTestPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}

/** Cache dos nomes de tabela — information_schema não muda durante a suíte. */
let tableCache: string[] | undefined;

async function tablesToTruncate(prisma: PrismaClient): Promise<string[]> {
  if (tableCache) return tableCache;

  const rows = await prisma.$queryRaw<Array<{ schemaname: string; tablename: string }>>`
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname IN ('public', 'radius')
      AND tablename NOT LIKE '\\_prisma\\_%'
      AND tablename NOT IN ('spatial_ref_sys')
  `;

  tableCache = rows.map((r) => `"${r.schemaname}"."${r.tablename}"`);
  return tableCache;
}

/**
 * Zera o banco entre testes. Um único TRUNCATE com CASCADE resolve as FKs sem
 * precisar ordenar as tabelas topologicamente.
 */
export async function truncateAll(): Promise<void> {
  const prisma = testPrisma();
  const tables = await tablesToTruncate(prisma);
  if (tables.length === 0) return;

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`,
  );
}
