import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { QueueModule } from '../queue/queue.module.js';

import { DiagnosticsController } from './diagnostics.controller.js';
import { NetworkTestService } from './network-test.service.js';

/**
 * Diagnóstico ativo de rede (ping/traceroute) — enfileira jobs no device-gateway
 * e expõe status por polling. Consumido pelo copiloto (core → NMS).
 */
@Module({
  imports: [PrismaModule, AuditModule, QueueModule],
  controllers: [DiagnosticsController],
  providers: [NetworkTestService],
})
export class DiagnosticsModule {}
