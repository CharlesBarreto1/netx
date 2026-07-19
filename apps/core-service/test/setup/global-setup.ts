/**
 * Roda UMA vez antes de toda a suíte de integração.
 *
 * Garante que o schema do banco de teste está na versão do código. Não cria o
 * banco nem as extensões — isso exige superuser e é feito por
 * `npm run db:test:setup` (ver scripts/db/setup-test-db.sh).
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { resolveTestDatabaseUrl } from './db';

export default async function globalSetup(): Promise<void> {
  const url = resolveTestDatabaseUrl();

  // Deixa explícito no output contra qual banco a suíte está rodando. Sem isso,
  // um DATABASE_URL errado só aparece quando os dados somem.
  const redacted = url.replace(/:\/\/[^@]*@/, '://***@');
  console.log(`\n[e2e] banco de teste: ${redacted}`);

  const schema = join(__dirname, '..', '..', 'prisma', 'schema.prisma');

  try {
    execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', schema], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    const out = `${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? ''}`;
    throw new Error(
      'Falha ao aplicar migrations no banco de teste.\n' +
        'Se o banco ainda não existe, rode: npm run db:test:setup\n\n' +
        out,
    );
  }

  console.log('[e2e] schema em dia\n');
}
