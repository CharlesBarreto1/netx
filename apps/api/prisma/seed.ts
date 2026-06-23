/**
 * Seed básico (Fase 0). Idempotente: pode rodar várias vezes.
 * NÃO insere credenciais — apenas um device de exemplo apontando pro cofre.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const device = await prisma.device.upsert({
    where: { mgmtIp: '192.0.2.1' },
    update: {},
    create: {
      hostname: 'lab-mx-01',
      mgmtIp: '192.0.2.1',
      vendor: 'juniper',
      model: 'vMX',
      site: 'lab',
    },
  });
  console.log(`seed: device ${device.hostname} (${device.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
