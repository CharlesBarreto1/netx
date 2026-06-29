/**
 * Seed básico (Fase 0). Idempotente: pode rodar várias vezes.
 * NÃO insere credenciais — apenas um device de exemplo apontando pro cofre.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Dois devices de exemplo (multi-vendor), em IPs da faixa de documentação (TEST-NET-1).
  const samples = [
    { hostname: 'lab-mx-01', mgmtIp: '192.0.2.1', vendor: 'juniper' as const, model: 'vMX', site: 'lab' },
    {
      hostname: 'lab-ccr-01',
      mgmtIp: '192.0.2.2',
      vendor: 'mikrotik' as const,
      model: 'CCR2004',
      site: 'lab',
    },
  ];
  for (const s of samples) {
    const device = await prisma.device.upsert({
      where: { mgmtIp: s.mgmtIp },
      update: {},
      create: s,
    });
    console.log(`seed: device ${device.hostname} (${device.vendor}) ${device.id}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
