/**
 * FieldModule — front consumidor (NetX Field). NÃO é dono de schema: compõe
 * leituras dos módulos donos (BFF Assinante 360, cobertura) e orquestra ações
 * privilegiadas (desbloqueio) chamando a API do módulo dono (ContractsService),
 * sempre auditando. PrismaService é global.
 */
import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ContractsModule } from '../contracts/contracts.module';

import { CoverageService } from './coverage.service';
import { FieldActionsService } from './field-actions.service';
import { FieldController } from './field.controller';
import { Subscriber360Service } from './subscriber360.service';

@Module({
  imports: [AuditModule, ContractsModule],
  controllers: [FieldController],
  providers: [Subscriber360Service, CoverageService, FieldActionsService],
  exports: [Subscriber360Service, CoverageService],
})
export class FieldModule {}
