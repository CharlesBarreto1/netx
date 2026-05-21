/**
 * Helper que monta `OltConnectionContext` a partir de uma Olt row, fazendo
 * decrypt das credenciais sensíveis via CryptoService.
 *
 * Mantido fora do service pra reuso entre OltsService (testConnection) e
 * ProvisioningService (authorize/deauthorize). Decrypt acontece in-memory e
 * é descartado ao fim da call — nunca persiste plaintext.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import type { Olt } from '@prisma/client';

import type { CryptoService } from '../crypto/crypto.service';

import type { OltConnectionContext } from './drivers/olt-driver.interface';

export function buildConnectionContext(olt: Olt, crypto: CryptoService): OltConnectionContext {
  let apiCreds: Record<string, unknown> | null = null;
  if (olt.apiCredentialsEnc) {
    const raw = crypto.decrypt(olt.apiCredentialsEnc);
    try {
      apiCreds = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    } catch {
      apiCreds = null;
    }
  }
  return {
    oltId: olt.id,
    managementIp: olt.managementIp,
    sshPort: olt.sshPort,
    sshUser: olt.sshUser,
    sshPassword: crypto.decryptOptional(olt.sshPasswordEnc),
    enableSecret: crypto.decryptOptional(olt.enableSecretEnc),
    apiEndpoint: olt.apiEndpoint,
    apiAuthType: olt.apiAuthType,
    apiCredentials: apiCreds,
    defaults: {
      serviceVlanId: olt.serviceVlanId,
      upProfile: olt.defaultUpProfile,
      downProfile: olt.defaultDownProfile,
    },
  };
}
