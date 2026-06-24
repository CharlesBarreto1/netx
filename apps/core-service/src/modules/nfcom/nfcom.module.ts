/**
 * NfcomModule — NFCom (Nota Fiscal Fatura de Serviço de Comunicação BR, mod 62).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * NetX como EMISSOR DIRETO: gera/assina/transmite o XML direto ao SVRS, atrás
 * de uma porta plugável (NfcomTransmitter). Transmissor principal = SvrsDirect.
 *
 * Estrutura:
 *   - NfcomConfigService    → config por tenant + upload cert .pfx + diagnose
 *   - NfcomConfigController → /v1/nfcom/config (config + certificado + diagnose)
 *   - NfcomTransmitterRegistry + SvrsDirectTransmitter → transmissão ao SVRS
 *   - (próximo) NfcomService + NfcomController + gerador de XML + assinatura
 *
 * Habilitação por tenant via /settings/nfcom. Só BR. CryptoModule é @Global.
 */
import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { NfcomConfigController } from './nfcom-config.controller';
import { NfcomConfigService } from './nfcom-config.service';
import { NfcomController } from './nfcom.controller';
import { NfcomService } from './nfcom.service';
import { NfcomTransmitterRegistry } from './transmitter/nfcom-transmitter.registry';
import { SvrsDirectTransmitter } from './transmitter/svrs/svrs-direct.transmitter';

@Module({
  imports: [AuditModule],
  controllers: [NfcomConfigController, NfcomController],
  providers: [
    NfcomConfigService,
    NfcomService,
    NfcomTransmitterRegistry,
    SvrsDirectTransmitter,
  ],
  exports: [NfcomConfigService, NfcomService, NfcomTransmitterRegistry],
})
export class NfcomModule {}
