import { z } from 'zod';

/**
 * Contrato de JOBS: o que a API (Node) enfileira e o device-gateway (Python) consome.
 *
 * Regra de segurança (AGENTS.md §1–3): jobs são READ-ONLY por padrão. `accessMode: 'write'`
 * exige aprovação humana explícita registrada em `approvedBy` — o device-gateway DEVE recusar
 * um job de escrita sem `approvedBy`. A IA nunca preenche `approvedBy`.
 */

export const AccessMode = z.enum(['read', 'write']);
export type AccessMode = z.infer<typeof AccessMode>;

/** Envelope comum a todo job disparado contra um equipamento. */
export const DeviceJobBaseSchema = z.object({
  jobId: z.string().uuid(),
  deviceId: z.string().uuid(),
  /** Usuário humano que disparou. Auditoria sempre amarra a ele. */
  requestedBy: z.string().min(1),
  requestedAt: z.string().datetime(),
  accessMode: AccessMode.default('read'),
  /** Obrigatório quando accessMode = 'write'. Nunca preenchido por IA. */
  approvedBy: z.string().min(1).optional(),
});

/**
 * Fase 1 — valida os três canais de gerência de um Juniper: SSH, NETCONF (830) e SNMP.
 * A API envia mgmtIp + as credenciais CIFRADAS (lidas do banco); o gateway decifra e testa.
 */
export const ConnectivityTestJobSchema = DeviceJobBaseSchema.extend({
  kind: z.literal('connectivity-test'),
  params: z.object({
    mgmtIp: z.string().min(1),
    username: z.string().min(1),
    passwordEnc: z.string().optional(),
    snmpCommunityEnc: z.string().optional(),
    sshPort: z.number().int().positive().default(22),
    netconfPort: z.number().int().positive().default(830),
  }),
});

/**
 * Fase 1 — cofre: a API manda o segredo em claro UMA vez pela fila; o gateway cifra com a
 * chave-mestra (que só ele tem) e devolve o ciphertext. A API persiste o blob, sem decifrar.
 */
export const StoreCredentialJobSchema = DeviceJobBaseSchema.extend({
  kind: z.literal('store-credential'),
  params: z.object({
    username: z.string().min(1),
    password: z.string().min(1).optional(),
    sshKey: z.string().min(1).optional(),
    snmpCommunity: z.string().min(1).optional(),
  }),
});

/**
 * Fase 2a — materializa a config SNMP do Telegraf para um device. O gateway decifra a
 * community e escreve telegraf.d/snmp-<deviceId>.conf (ADR 0003). Sem community → remove.
 */
export const SyncSnmpConfigJobSchema = DeviceJobBaseSchema.extend({
  kind: z.literal('sync-snmp-config'),
  params: z.object({
    mgmtIp: z.string().min(1),
    snmpCommunityEnc: z.string().optional(),
    snmpVersion: z.number().int().default(2),
  }),
});

/**
 * Fase 2b — executa um playbook (bloco de comando nomeado) read-only via PyEZ. No MVP só
 * comandos `show ...`; o gateway recusa qualquer coisa que não comece com "show " (§1/§2).
 */
export const RunPlaybookJobSchema = DeviceJobBaseSchema.extend({
  kind: z.literal('run-playbook'),
  params: z.object({
    mgmtIp: z.string().min(1),
    username: z.string().min(1),
    passwordEnc: z.string().optional(),
    netconfPort: z.number().int().positive().default(830),
    playbookId: z.string().min(1),
    command: z.string().regex(/^show\s/i, 'somente comandos show (read-only)'),
  }),
});

/** Fase 3 — puxa a config do device (formato `set`) para backup versionado. Read-only. */
export const BackupConfigJobSchema = DeviceJobBaseSchema.extend({
  kind: z.literal('backup-config'),
  params: z.object({
    mgmtIp: z.string().min(1),
    username: z.string().min(1),
    passwordEnc: z.string().optional(),
    netconfPort: z.number().int().positive().default(830),
  }),
});

/**
 * Teste de rede ativo (ping/traceroute) — read-only. Disparado pelo copiloto.
 * `source='host'`: roda no próprio device-gateway (probe padrão) — deviceId é o
 * nil-uuid sentinela. `source='device'`: SSH no equipamento (a API resolve
 * mgmtIp + credencial cifrada).
 */
export const NetworkTestJobSchema = DeviceJobBaseSchema.extend({
  kind: z.literal('network-test'),
  params: z.object({
    testType: z.enum(['ping', 'traceroute']).default('ping'),
    target: z.string().min(1),
    source: z.enum(['host', 'device']).default('host'),
    // Só quando source='device' (preenchidos pela API a partir do device+cofre).
    mgmtIp: z.string().optional(),
    username: z.string().optional(),
    passwordEnc: z.string().optional(),
    sshPort: z.number().int().positive().default(22),
  }),
});

/** União discriminada de todos os tipos de job. Novos pilares adicionam membros aqui. */
export const DeviceJobSchema = z.discriminatedUnion('kind', [
  ConnectivityTestJobSchema,
  StoreCredentialJobSchema,
  SyncSnmpConfigJobSchema,
  RunPlaybookJobSchema,
  BackupConfigJobSchema,
  NetworkTestJobSchema,
]);
/** Job já validado (accessMode resolvido). */
export type DeviceJob = z.infer<typeof DeviceJobSchema>;
/** Job como o chamador o constrói (accessMode/params opcionais — têm default). */
export type DeviceJobInput = z.input<typeof DeviceJobSchema>;
export type DeviceJobKind = DeviceJob['kind'];

/**
 * Resultado estruturado devolvido pelo device-gateway. `ok=false` carrega `error`,
 * nunca lança exceção crua pela fila.
 */
const ChannelCheck = z.object({
  reachable: z.boolean(),
  detail: z.string().optional(),
});

export const ConnectivityTestResultSchema = z.object({
  kind: z.literal('connectivity-test'),
  ssh: ChannelCheck,
  netconf: ChannelCheck,
  snmp: ChannelCheck,
});

/** Ciphertext (formato v1:iv:tag:ct) devolvido pelo gateway. A API só persiste. */
export const StoreCredentialResultSchema = z.object({
  kind: z.literal('store-credential'),
  username: z.string(),
  passwordEnc: z.string().optional(),
  sshKeyEnc: z.string().optional(),
  snmpCommunityEnc: z.string().optional(),
});

export const SyncSnmpConfigResultSchema = z.object({
  kind: z.literal('sync-snmp-config'),
  action: z.enum(['written', 'removed', 'noop']),
  file: z.string().nullable(),
});

export const RunPlaybookResultSchema = z.object({
  kind: z.literal('run-playbook'),
  playbookId: z.string(),
  output: z.string(),
});

export const BackupConfigResultSchema = z.object({
  kind: z.literal('backup-config'),
  /** Config no formato `set` (diffável, legível). */
  config: z.string(),
});

/**
 * Resultado COMPACTO do teste de rede (token-econômico): resumo + campos
 * estruturados pro Nexus renderizar sem mandar stdout verboso pro LLM. `raw`
 * (truncado) é só pro render determinístico, não pro modelo.
 */
export const NetworkTestResultSchema = z.object({
  kind: z.literal('network-test'),
  testType: z.string(),
  target: z.string(),
  source: z.string(),
  reachable: z.boolean(),
  /** Resumo de 1 linha, ex.: "4/4 pacotes, 11.2ms médio, 0% perda". */
  summary: z.string(),
  hops: z.number().int().nonnegative().optional(),
  rttMs: z.number().nonnegative().optional(),
  lossPct: z.number().min(0).max(100).optional(),
  /** stdout truncado (render determinístico no Nexus; não vai pro LLM). */
  raw: z.string().optional(),
});

export const DeviceJobResultSchema = z.object({
  jobId: z.string().uuid(),
  deviceId: z.string().uuid(),
  ok: z.boolean(),
  finishedAt: z.string().datetime(),
  durationMs: z.number().nonnegative(),
  data: z
    .discriminatedUnion('kind', [
      ConnectivityTestResultSchema,
      StoreCredentialResultSchema,
      SyncSnmpConfigResultSchema,
      RunPlaybookResultSchema,
      BackupConfigResultSchema,
      NetworkTestResultSchema,
    ])
    .optional(),
  error: z.string().optional(),
});
export type DeviceJobResult = z.infer<typeof DeviceJobResultSchema>;

/**
 * Trava de segurança em código (não só em texto): valida o envelope e recusa job de
 * escrita sem aprovação humana. Chamado tanto na API antes de enfileirar quanto no
 * gateway antes de executar.
 */
export function assertJobIsSafe(job: DeviceJobInput): DeviceJob {
  const parsed = DeviceJobSchema.parse(job);
  if (parsed.accessMode === 'write' && !parsed.approvedBy) {
    throw new Error(
      `Job ${parsed.jobId} (${parsed.kind}) é de escrita e não tem approvedBy. ` +
        'Escrita em equipamento exige aprovação humana explícita.',
    );
  }
  return parsed;
}
