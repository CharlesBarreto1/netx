/**
 * NfcomTransmitterRegistry — resolve o transmissor pelo enum da config.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Cada transmissor se registra no boot (OnModuleInit), no espírito do
 * BrBillingService.register() — mantém o grafo de DI acíclico e o NfcomService
 * agnóstico a qual caminho (SVRS direto / agregador) está ativo.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { NfcomTransmitter as NfcomTransmitterEnum } from '@prisma/client';

import type { NfcomTransmitter } from './nfcom-transmitter.port';

@Injectable()
export class NfcomTransmitterRegistry {
  private readonly logger = new Logger(NfcomTransmitterRegistry.name);
  private readonly transmitters = new Map<NfcomTransmitterEnum, NfcomTransmitter>();

  register(kind: NfcomTransmitterEnum, transmitter: NfcomTransmitter): void {
    this.transmitters.set(kind, transmitter);
    this.logger.log(`Transmissor NFCom registrado: ${kind}`);
  }

  /** Resolve o transmissor; lança claro se não houver adapter pro enum. */
  resolve(kind: NfcomTransmitterEnum): NfcomTransmitter {
    const t = this.transmitters.get(kind);
    if (!t) {
      throw new Error(
        `Transmissor NFCom "${kind}" não disponível. ` +
          (kind === 'SVRS_DIRECT'
            ? 'Emissor direto em construção.'
            : 'Adapter de agregador não implementado.'),
      );
    }
    return t;
  }

  has(kind: NfcomTransmitterEnum): boolean {
    return this.transmitters.has(kind);
  }
}
