/**
 * seed.ts — cria um licenciado + uma instância de teste e imprime a license
 * key (em claro, mostrada só aqui) + o instanceId pra configurar no NetX.
 *
 * Uso:
 *   INSTANCE_ID=<uuid do enrollment> npm run seed
 * (se INSTANCE_ID não vier, gera um aleatório — útil pra teste local)
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

import { generateLicenseKey, sha256Hex } from './common/hash';
import { hashPassword } from './common/password';

async function main() {
  const prisma = new PrismaClient();
  try {
    const licensee = await prisma.licensee.create({
      data: {
        name: process.env.LICENSEE_NAME ?? 'Cliente de Teste',
        plan: 'per-contract',
        maxContracts: 0,
        pricePerContractCents: Number(process.env.PRICE_PER_CONTRACT_CENTS ?? 0),
        billingDay: 10,
      },
    });

    // Usuário da central (login e-mail+senha) pra testar o portal.
    const portalEmail = process.env.PORTAL_EMAIL ?? 'cliente@teste.local';
    const portalPassword = process.env.PORTAL_PASSWORD ?? 'troque-esta-senha';
    await prisma.hubUser.create({
      data: {
        licenseeId: licensee.id,
        email: portalEmail.toLowerCase(),
        name: 'Admin do Cliente',
        passwordHash: hashPassword(portalPassword),
      },
    });

    const instanceId = process.env.INSTANCE_ID ?? randomUUID();
    const licenseKey = generateLicenseKey();
    await prisma.instance.create({
      data: {
        id: instanceId,
        licenseeId: licensee.id,
        label: process.env.INSTANCE_LABEL ?? 'Instância de teste',
        keyHash: sha256Hex(licenseKey),
        status: 'ACTIVE',
      },
    });

    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        '✅ Seed criado. Configure no .env do NetX cliente:',
        '',
        `  NETX_INSTANCE_ID=${instanceId}`,
        `  NETX_LICENSE_KEY=${licenseKey}`,
        '  NETX_HUB_URL=http://localhost:4000',
        '',
        `  (licenseeId=${licensee.id})`,
        '',
        'Central do cliente (POST /v1/portal/login):',
        `  e-mail: ${portalEmail}`,
        `  senha:  ${portalPassword}`,
        '',
        '⚠️  A license key acima NÃO é recuperável depois — anote agora.',
        '',
      ].join('\n'),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
