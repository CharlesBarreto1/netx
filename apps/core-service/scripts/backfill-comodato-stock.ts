/**
 * backfill-comodato-stock.ts — materializa como PATRIMÔNIO (serial_items) o
 * equipamento em comodato dos contratos JÁ materializados pela descoberta
 * OLT↔Hubsoft, que ficaram só com serial_physical no Ont (sem item de estoque).
 *
 * REUSA a lógica de produção (OltDiscoveryService.applyComodatoToMaterialized)
 * resolvendo o serviço do CONTÊINER DI real (NestFactory.createApplicationContext)
 * — sem forjar credenciais nem reinstanciar dependências à mão. Idempotente.
 *
 * Uso (a partir de apps/core-service):
 *   dotenv -e /etc/netx/.env -- ts-node scripts/backfill-comodato-stock.ts <tenantSlug> <actorUserId>
 * Ex.: ... backfill-comodato-stock.ts zux 5de4bb95-d52a-4d53-a9b7-83aacd4357a2
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { OltDiscoveryService } from '../src/modules/provisioning/olt-discovery.service';

async function main() {
  const [tenantSlug, actorUserId] = process.argv.slice(2);
  if (!tenantSlug || !actorUserId) {
    console.error('Uso: backfill-comodato-stock.ts <tenantSlug> <actorUserId>');
    process.exit(1);
  }

  const logger = new Logger('backfill-comodato-stock');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const prisma = app.get(PrismaService);
    const discovery = app.get(OltDiscoveryService);

    const tenant = await prisma.tenant.findFirst({
      where: { slug: tenantSlug },
      select: { id: true, name: true },
    });
    if (!tenant) throw new Error(`Tenant '${tenantSlug}' não encontrado`);

    const actor = await prisma.user.findFirst({
      where: { id: actorUserId, tenantId: tenant.id },
      select: { id: true, email: true },
    });
    if (!actor) throw new Error(`Usuário ${actorUserId} não existe no tenant ${tenantSlug}`);

    logger.log(`Backfill de estoque de comodato — tenant=${tenant.name} actor=${actor.email}`);
    const res = await discovery.applyComodatoToMaterialized(tenant.id, actor.id);
    logger.log(
      `Resultado: processed=${res.processed} enriched=${res.enriched} ` +
        `stockCreated=${res.stockCreated} noComodato=${res.noComodato} failed=${res.failed}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
