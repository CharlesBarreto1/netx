/**
 * DisconnectModule — multi-vendor disconnect (CoA + RouterOS API + SSH).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Export: `DisconnectService`. Importado por ContractsModule (kick / suspend
 * automático) e NetworkModule (botão "Test connection" no /network/equipment).
 */
import { Module } from '@nestjs/common';

import { CryptoModule } from '../crypto/crypto.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DisconnectService } from './disconnect.service';
import { CoaStrategy } from './strategies/coa.strategy';
import { MikrotikApiStrategy } from './strategies/mikrotik-api.strategy';
import { SshDisconnectStrategy } from './strategies/ssh.strategy';

@Module({
  imports: [PrismaModule, CryptoModule],
  providers: [
    DisconnectService,
    CoaStrategy,
    MikrotikApiStrategy,
    SshDisconnectStrategy,
  ],
  exports: [DisconnectService],
})
export class DisconnectModule {}
