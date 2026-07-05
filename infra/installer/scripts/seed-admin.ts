/**
 * seed-admin.ts — bootstrapa tenant inicial + admin user.
 *
 * Roda DEPOIS do seed canônico (que cria permissões/roles/tenant default).
 * Se o tenant pelo nome já existe, reaproveita; mesma coisa pro user.
 *
 * Lê do env (passado pelo install.sh):
 *   NETX_ADMIN_EMAIL
 *   NETX_ADMIN_PASSWORD
 *   NETX_TENANT_NAME
 *   NETX_TENANT_COUNTRY  (PY/BR/AR)
 *   NETX_TENANT_LOCALE   (es-PY/pt-BR/...)
 *   NETX_TENANT_CURRENCY (PYG/BRL/...)
 *
 * Uso:
 *   cd /opt/netx/apps/core-service
 *   npx ts-node /opt/netx/infra/installer/scripts/seed-admin.ts
 */

import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const env = (k: string, fallback?: string): string => {
  const v = process.env[k];
  if (!v && fallback === undefined) {
    throw new Error(`${k} não definido no ambiente`);
  }
  return v ?? (fallback as string);
};

const slugify = (s: string): string => {
  const out = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove diacríticos combinantes
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return out || 'tenant';
};

async function main() {
  const prisma = new PrismaClient();

  const adminEmail = env('NETX_ADMIN_EMAIL').toLowerCase().trim();
  const adminPassword = env('NETX_ADMIN_PASSWORD');
  const tenantName = env('NETX_TENANT_NAME');
  const tenantCountry = env('NETX_TENANT_COUNTRY', 'PY');
  const tenantLocale = env('NETX_TENANT_LOCALE', 'es-PY');
  const tenantCurrency = env('NETX_TENANT_CURRENCY', 'PYG');
  const tenantSlug = slugify(tenantName);

  console.log(`[seed-admin] tenant=${tenantSlug} admin=${adminEmail}`);

  try {
    // 1) Tenant — schema atual usa enum `TenantStatus`. Estratégia:
    //
    //   a) Se já existe tenant com slug=`${tenantSlug}` → atualiza (re-run).
    //   b) Se NÃO existe e existe um tenant slug='default' (criado pelo
    //      `db:seed` canônico) → renomeia ele pra `${tenantSlug}` em vez de
    //      criar novo. Isso evita ter 2 tenants conflitantes ('default' do
    //      seed + '${tenantSlug}' do operador) e mantém o `.env` consistente.
    //   c) Senão → cria do zero.
    //
    // Sem essa lógica, fresh install fica com DEFAULT_TENANT_SLUG no `.env`
    // apontando pra um tenant que não existe (ou existe com slug 'default'),
    // causando "Invalid credentials" no /auth/login.
    let tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (tenant) {
      tenant = await prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          name: tenantName,
          country: tenantCountry,
          locale: tenantLocale,
          currency: tenantCurrency,
          status: 'ACTIVE',
        },
      });
    } else {
      const seededDefault = await prisma.tenant.findUnique({ where: { slug: 'default' } });
      if (seededDefault) {
        console.log(`[seed-admin] renomeando tenant 'default' → '${tenantSlug}'`);
        tenant = await prisma.tenant.update({
          where: { id: seededDefault.id },
          data: {
            slug: tenantSlug,
            name: tenantName,
            country: tenantCountry,
            locale: tenantLocale,
            currency: tenantCurrency,
            status: 'ACTIVE',
          },
        });
      } else {
        tenant = await prisma.tenant.create({
          data: {
            slug: tenantSlug,
            name: tenantName,
            country: tenantCountry,
            locale: tenantLocale,
            currency: tenantCurrency,
            status: 'ACTIVE',
          },
        });
      }
    }

    // 2) Sincroniza roles system → tenant.
    //
    // O seed canônico (db:seed) cria roles system (tenantId=null) e copia
    // pros tenants existentes naquele momento. Como o tenant que acabamos
    // de criar é novo, precisamos replicar o passo de sincronização aqui —
    // mesma lógica que existe em prisma/seed.ts.
    // MANTER EM SINCRONIA com SYSTEM_ROLE_NAMES de prisma/seed.ts — role que
    // faltar aqui não é copiada pra tenant criado do zero (só o 'default'
    // renomeado herda todas).
    const SYSTEM_ROLE_NAMES = ['admin', 'operator', 'viewer', 'tecnico', 'atendente'] as const;
    for (const roleName of SYSTEM_ROLE_NAMES) {
      const tpl = await prisma.role.findFirst({
        where: { name: roleName, tenantId: null },
        include: { rolePermissions: true },
      });
      if (!tpl) {
        console.error(
          `[seed-admin] template system role "${roleName}" não encontrado — rode db:seed primeiro`,
        );
        process.exit(1);
      }
      const tenantRole = await prisma.role.upsert({
        where: { tenantId_name: { tenantId: tenant.id, name: roleName } },
        update: { description: tpl.description, priority: tpl.priority },
        create: {
          tenantId: tenant.id,
          name: roleName,
          description: tpl.description,
          priority: tpl.priority,
          isSystem: false,
        },
      });
      // Sincroniza permissões da role tenant com o template — remove tudo
      // e re-cria. Garante que customer novo recebe as últimas perms.
      await prisma.rolePermission.deleteMany({ where: { roleId: tenantRole.id } });
      if (tpl.rolePermissions.length > 0) {
        await prisma.rolePermission.createMany({
          data: tpl.rolePermissions.map((rp) => ({
            roleId: tenantRole.id,
            permissionId: rp.permissionId,
          })),
          skipDuplicates: true,
        });
      }
    }

    const adminRole = await prisma.role.findFirstOrThrow({
      where: { tenantId: tenant.id, name: 'admin' },
    });

    // 3) Hash senha
    const passwordHash = await argon2.hash(adminPassword, {
      type: argon2.argon2id,
      memoryCost: parseInt(process.env.ARGON2_MEMORY_COST ?? '19456', 10),
      timeCost: parseInt(process.env.ARGON2_TIME_COST ?? '2', 10),
      parallelism: parseInt(process.env.ARGON2_PARALLELISM ?? '1', 10),
    });

    // 4) User (upsert por email + tenantId composto único)
    //    Admin recém-criado é forçado a trocar senha no primeiro login.
    //    Em re-runs (update), também religamos a flag pra garantir que o ISP
    //    receba a credencial inicial gerada pelo installer e troque depois.
    const user = await prisma.user.upsert({
      where: {
        tenantId_email: { tenantId: tenant.id, email: adminEmail },
      },
      create: {
        tenantId: tenant.id,
        email: adminEmail,
        passwordHash,
        firstName: 'Admin',
        lastName: 'NetX',
        status: 'ACTIVE',
        locale: tenantLocale,
        mustChangePassword: true,
      },
      update: {
        passwordHash,
        status: 'ACTIVE',
        mustChangePassword: true,
      },
    });

    // 5) Vincula role admin
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
      create: { userId: user.id, roleId: adminRole.id },
      update: {},
    });

    // 5.1) Suspende `admin@netx.local` (criado pelo seed canônico) quando o
    // operador definiu um email diferente. Evita confusão de "qual admin
    // logo" e bloqueia uma credencial conhecida (senha hardcoded
    // 'ChangeMe!2026' no seed canônico) num install de produção.
    if (adminEmail !== 'admin@netx.local') {
      const dev = await prisma.user.findUnique({
        where: {
          tenantId_email: { tenantId: tenant.id, email: 'admin@netx.local' },
        },
      });
      if (dev && dev.status === 'ACTIVE') {
        await prisma.user.update({
          where: { id: dev.id },
          data: { status: 'SUSPENDED' },
        });
        console.log(`[seed-admin] admin@netx.local suspenso (não é o admin desta instância)`);
      }
    }

    // 6) Pipeline default de CRM (vendas) — espelho do que o seed canônico
    // cria pro tenant default. Sem isso, /crm/pipelines mostra "Nenhum
    // pipeline configurado". Idempotente: skip se já existe.
    const existingPipeline = await prisma.pipeline.findFirst({
      where: { tenantId: tenant.id, slug: 'vendas' },
    });
    if (!existingPipeline) {
      await prisma.pipeline.create({
        data: {
          tenantId: tenant.id,
          name: 'Vendas',
          slug: 'vendas',
          description:
            'Funil padrão — lead → qualificação → proposta → negociação → fechamento',
          color: '#0ea5e9',
          isDefault: true,
          stages: {
            create: [
              { tenantId: tenant.id, name: 'Novo lead',        order: 0, probability: 10,  color: '#64748b' },
              { tenantId: tenant.id, name: 'Qualificado',      order: 1, probability: 25,  color: '#0ea5e9' },
              { tenantId: tenant.id, name: 'Proposta enviada', order: 2, probability: 50,  color: '#a855f7' },
              { tenantId: tenant.id, name: 'Negociação',       order: 3, probability: 75,  color: '#f59e0b' },
              { tenantId: tenant.id, name: 'Ganho',            order: 4, probability: 100, color: '#22c55e', isWon: true },
              { tenantId: tenant.id, name: 'Perdido',          order: 5, probability: 0,   color: '#ef4444', isLost: true },
            ],
          },
        },
      });
      console.log(`[seed-admin] pipeline 'vendas' criado com 6 stages`);
    }

    console.log(
      `[seed-admin] OK — tenant=${tenant.slug} (${tenant.id}) user=${user.email} (${user.id})`,
    );
  } catch (e) {
    console.error('[seed-admin] FALHOU:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
