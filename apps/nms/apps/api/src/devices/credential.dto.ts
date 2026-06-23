import { z } from 'zod';

/**
 * Credenciais que o operador envia para um device. Os segredos vão em claro UMA vez até o
 * gateway (que cifra). A API nunca os persiste em claro nem os devolve (ADR 0002).
 */
export const SetCredentialSchema = z
  .object({
    username: z.string().min(1).max(255),
    password: z.string().min(1).optional(),
    sshKey: z.string().min(1).optional(),
    snmpCommunity: z.string().min(1).optional(),
  })
  .refine((v) => v.password || v.sshKey || v.snmpCommunity, {
    message: 'informe ao menos um segredo: password, sshKey ou snmpCommunity',
  });
export type SetCredentialDto = z.infer<typeof SetCredentialSchema>;
