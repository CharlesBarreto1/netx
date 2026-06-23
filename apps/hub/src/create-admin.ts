/**
 * create-admin.ts — cria o PRIMEIRO usuário admin (equipe NetX), pra bootstrap
 * do painel quando não há token mais. Idempotente: se o e-mail já existe, só
 * atualiza a senha.
 *
 * Uso:
 *   ADMIN_EMAIL=voce@netx.com ADMIN_PASSWORD='SenhaForte123' npm run create-admin
 */
import { PrismaClient } from '@prisma/client';

import { hashPassword } from './common/password';

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? '').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD ?? '';
  const name = process.env.ADMIN_NAME ?? null;
  if (!email || password.length < 8) {
    console.error('Defina ADMIN_EMAIL e ADMIN_PASSWORD (mín. 8 chars).');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const passwordHash = hashPassword(password);
    const admin = await prisma.hubAdmin.upsert({
      where: { email },
      create: { email, name, passwordHash },
      update: { passwordHash, isActive: true },
    });
    // eslint-disable-next-line no-console
    console.log(`✅ Admin pronto: ${admin.email} (id=${admin.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
