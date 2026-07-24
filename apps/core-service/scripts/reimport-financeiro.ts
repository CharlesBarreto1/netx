/**
 * reimport-financeiro.ts — re-importa o financeiro de TODOS os clientes
 * materializados do Hubsoft (ou de um subconjunto por código), agora com o fix
 * do limit=600 (a API do Hubsoft cortava em 20 faturas). Reusa o DI real.
 *
 * Uso (a partir de apps/core-service):
 *   reimport-financeiro.ts <tenantSlug> <actorUserId> [codigo1 codigo2 ...]
 *   (sem códigos = TODOS os clientes HS-)
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { HubsoftImportService } from '../src/modules/hubsoft/hubsoft-import.service';

async function main() {
  const [tenantSlug, actorUserId, ...codigos] = process.argv.slice(2);
  if (!tenantSlug || !actorUserId) {
    console.error('Uso: reimport-financeiro.ts <tenantSlug> <actorUserId> [codigos...]');
    process.exit(1);
  }
  const log = new Logger('reimport-financeiro');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const prisma = app.get(PrismaService);
    const importer = app.get(HubsoftImportService);
    const tenant = await prisma.tenant.findFirst({ where: { slug: tenantSlug }, select: { id: true, name: true } });
    if (!tenant) throw new Error(`tenant '${tenantSlug}' não encontrado`);

    log.log(
      `Re-import financeiro — tenant=${tenant.name}` +
        (codigos.length ? ` codigos=[${codigos.join(',')}]` : ' (TODOS os clientes HS-)'),
    );
    const result = await importer.run(tenant.id, actorUserId, {
      entities: ['financeiro'],
      dryRun: false,
      ...(codigos.length ? { codigos } : {}),
    });
    log.log(`Resultado: ${JSON.stringify(result.entities ?? result)}`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
