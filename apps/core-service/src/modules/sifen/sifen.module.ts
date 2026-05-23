/**
 * SifenModule — fatura eletrônica Paraguay (DNIT / SIFEN / e-Kuatiá).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Estrutura:
 *   - SifenService          → orquestração DTE (cdc + emitter + persist + audit)
 *   - SifenConfigService    → config por tenant (TenantSetting) + upload cert .p12
 *   - SifenEmitterService   → bridge com libs TIPS-SA (xmlgen, xmlsign, qrgen, setapi)
 *   - SifenController       → endpoints REST /v1/sifen/documents (emit, list, cancel)
 *   - SifenConfigController → endpoints REST /v1/sifen/config (config + cert upload)
 *   - cdc.util              → cálculo determinístico do CDC (44 chars)
 *
 * Habilitação: por tenant via /settings/sifen (UI) OU env SIFEN_ENABLED=true
 * + envs SIFEN_* (compat single-tenant). Multi-tenant: TenantSetting prevalece.
 *
 * CryptoModule é @Global — não precisa importar aqui.
 */
import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { SifenConfigController } from './sifen-config.controller';
import { SifenConfigService } from './sifen-config.service';
import { SifenController } from './sifen.controller';
import { SifenEmitterService } from './sifen-emitter.service';
import { SifenService } from './sifen.service';

@Module({
  imports: [AuditModule],
  controllers: [SifenController, SifenConfigController],
  providers: [SifenService, SifenConfigService, SifenEmitterService],
  // Exporta SifenService pra que ContractInvoicesService / OneTimeChargesService
  // possam chamar emit() automaticamente quando hook for ligado (Fase 2).
  exports: [SifenService, SifenConfigService],
})
export class SifenModule {}
