/**
 * CryptoModule — cifra/decifra credenciais sensíveis no DB com AES-256-GCM.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Usado por NetworkEquipment pra cifrar `apiPassword` e `sshPassword`.
 * KMS_MASTER_KEY é hex 64 chars (256 bits) gerado pelo installer e nunca
 * deve ser rotacionado sem migração (torna ciphertexts antigos irrecuperáveis).
 */
import { Global, Module } from '@nestjs/common';

import { CryptoService } from './crypto.service';

@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
