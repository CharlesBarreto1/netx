import { ForbiddenException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Gate de país: o cadastro-mestre de endereços (cidade/bairro/rua) é exclusivo
 * de operações BR. Tenants PY (ou outros) seguem com endereço em texto livre.
 * Carrega só `country` — query barata e indexada.
 */
export async function assertBrTenant(
  prisma: PrismaService,
  tenantId: string,
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { country: true },
  });
  if (!tenant || tenant.country !== 'BR') {
    throw new ForbiddenException(
      'Cadastro de endereços estruturados disponível apenas para operações BR',
    );
  }
}
