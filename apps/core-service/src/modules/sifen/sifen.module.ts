/**
 * SifenModule — fatura eletrônica Paraguay (DNIT / SIFEN / e-Kuatiá).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Estrutura:
 *   - SifenService          → orquestração (cdc + emitter + persist + audit)
 *   - SifenEmitterService   → bridge com libs TIPS-SA (stub no momento)
 *   - SifenController       → endpoints REST /v1/sifen/documents
 *   - cdc.util              → cálculo determinístico do CDC (44 chars)
 *
 * Habilitação: env SIFEN_ENABLED=true + certificado CCFE .p12 configurado.
 * Quando desabilitado, controller responde mas emit retorna SIFEN_DISABLED.
 */
import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { SifenController } from './sifen.controller';
import { SifenEmitterService } from './sifen-emitter.service';
import { SifenService } from './sifen.service';

@Module({
  imports: [AuditModule],
  controllers: [SifenController],
  providers: [SifenService, SifenEmitterService],
  // Exporta SifenService pra que ContractInvoicesService / OneTimeChargesService
  // possam chamar emit() automaticamente quando hook for ligado (Fase 2).
  exports: [SifenService],
})
export class SifenModule {}
