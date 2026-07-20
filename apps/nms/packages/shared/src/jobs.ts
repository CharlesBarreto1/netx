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
 * Fase 1 — valida os canais de gerência: SSH, 2º canal (NETCONF/830 no Junos; N/A no
 * RouterOS) e SNMP. A API envia mgmtIp + vendor + as credenciais CIFRADAS (lidas do banco);
 * o gateway decifra, resolve o driver do vendor e testa.
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
    /** Define o driver (junos vs routeros). Ausente → juniper (compat MVP). */
    vendor: z.string().optional(),
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
    /** Define os OIDs de saúde/óptica (Junos jnx* vs RouterOS mtxr*). */
    vendor: z.string().optional(),
  }),
});

/**
 * Fase 2b — executa um playbook (bloco de comando nomeado) read-only. O comando vem do
 * CATÁLOGO curado da API (não é texto livre do usuário) e é vendor-aware: `show ...` no
 * Junos, `/... print` no RouterOS. O driver do vendor ainda aplica sua própria defesa
 * read-only (o Junos recusa o que não começa com `show`).
 */
export const RunPlaybookJobSchema = DeviceJobBaseSchema.extend({
  kind: z.literal('run-playbook'),
  params: z.object({
    mgmtIp: z.string().min(1),
    username: z.string().min(1),
    passwordEnc: z.string().optional(),
    sshPort: z.number().int().positive().default(22),
    netconfPort: z.number().int().positive().default(830),
    vendor: z.string().optional(),
    playbookId: z.string().min(1),
    command: z.string().min(1),
  }),
});

/** Fase 3 — puxa a config do device (Junos `set` / RouterOS `/export`) para backup. Read-only. */
export const BackupConfigJobSchema = DeviceJobBaseSchema.extend({
  kind: z.literal('backup-config'),
  params: z.object({
    mgmtIp: z.string().min(1),
    username: z.string().min(1),
    passwordEnc: z.string().optional(),
    sshPort: z.number().int().positive().default(22),
    netconfPort: z.number().int().positive().default(830),
    vendor: z.string().optional(),
  }),
});

/**
 * Fase 2 (multi-vendor) — ESCRITA: aplica config no device com rede de segurança. SEMPRE
 * exige `approvedBy` (trava em assertJobIsSafe/safety.py, independente de accessMode). A IA
 * nunca preenche `approvedBy`. Junos: `commit confirmed`. RouterOS: backup + auto-revert
 * agendado. `dryRun=true` apenas valida/plana (diff) sem efetivar.
 */
export const ApplyConfigJobSchema = DeviceJobBaseSchema.extend({
  kind: z.literal('apply-config'),
  params: z.object({
    mgmtIp: z.string().min(1),
    username: z.string().min(1),
    passwordEnc: z.string().optional(),
    sshPort: z.number().int().positive().default(22),
    netconfPort: z.number().int().positive().default(830),
    vendor: z.string().optional(),
    /** Config a aplicar (Junos: linhas `set ...`; RouterOS: comandos `/...`). */
    config: z.string().min(1),
    /** Janela do rollback automático (commit confirmed / auto-revert). */
    confirmMinutes: z.number().int().positive().default(5),
    /** Só valida/plana o diff, não efetiva. */
    dryRun: z.boolean().default(false),
  }),
});

/**
 * Fase 2 (multi-vendor) — ESCRITA: confirma um apply pendente (trava o rollback automático).
 * SEMPRE exige `approvedBy`. Junos: 2º commit. RouterOS: cancela o scheduler de auto-revert.
 */
export const ConfirmCommitJobSchema = DeviceJobBaseSchema.extend({
  kind: z.literal('confirm-commit'),
  params: z.object({
    mgmtIp: z.string().min(1),
    username: z.string().min(1),
    passwordEnc: z.string().optional(),
    sshPort: z.number().int().positive().default(22),
    netconfPort: z.number().int().positive().default(830),
    vendor: z.string().optional(),
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
    // Vendor do equipamento — define a sintaxe do comando (Junos vs RouterOS).
    vendor: z.string().optional(),
  }),
});

/**
 * Manutenção do coletor — varre o `telegraf.d` e apaga os perfis SNMP cujo device não
 * existe mais no banco. Cobre o que já vazou: device removido enquanto o gateway estava
 * fora, ou instalado antes de o delete passar a limpar o perfil. Não é amarrado a um
 * device — `deviceId` é o nil-uuid sentinela, como no `network-test` com source='host'.
 */
export const ReconcileSnmpConfigsJobSchema = DeviceJobBaseSchema.extend({
  kind: z.literal('reconcile-snmp-configs'),
  params: z.object({
    /** Devices que EXISTEM no banco. Todo perfil fora desta lista é órfão e some. */
    knownDeviceIds: z.array(z.string().uuid()),
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
  ApplyConfigJobSchema,
  ConfirmCommitJobSchema,
  ReconcileSnmpConfigsJobSchema,
]);

/** Kinds inerentemente de ESCRITA — exigem approvedBy mesmo se accessMode vier 'read'. */
export const WRITE_KINDS = new Set<DeviceJobKind>(['apply-config', 'confirm-commit']);
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
  /** Falso quando o canal não existe no vendor (ex.: NETCONF no RouterOS) — UI mostra "N/A". */
  applicable: z.boolean().optional(),
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

/** Resultado da varredura: quais perfis órfãos sumiram e quantos ficaram de pé. */
export const ReconcileSnmpConfigsResultSchema = z.object({
  kind: z.literal('reconcile-snmp-configs'),
  removed: z.array(z.string()),
  kept: z.number().int().nonnegative(),
});

export const RunPlaybookResultSchema = z.object({
  kind: z.literal('run-playbook'),
  playbookId: z.string(),
  output: z.string(),
});

export const BackupConfigResultSchema = z.object({
  kind: z.literal('backup-config'),
  /** Config em texto diffável (Junos `set` / RouterOS `/export`). */
  config: z.string(),
});

/** Resultado do apply (escrita): diff aplicado/planado + estado do rollback automático. */
export const ApplyConfigResultSchema = z.object({
  kind: z.literal('apply-config'),
  dryRun: z.boolean(),
  ok: z.boolean(),
  detail: z.string(),
  diff: z.string().optional(),
  /** True quando efetivou (não dry-run) e há rollback automático armado/pendente. */
  committed: z.boolean().optional(),
  rolledBack: z.boolean().optional(),
});

/** Resultado do confirm (escrita): trava do rollback automático. */
export const ConfirmCommitResultSchema = z.object({
  kind: z.literal('confirm-commit'),
  ok: z.boolean(),
  detail: z.string(),
  committed: z.boolean().optional(),
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
      ApplyConfigResultSchema,
      ConfirmCommitResultSchema,
      ReconcileSnmpConfigsResultSchema,
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
  // Kinds de escrita exigem aprovação MESMO se accessMode vier 'read' (defesa: ninguém
  // burla a aprovação rotulando um apply como leitura).
  const isWrite = parsed.accessMode === 'write' || WRITE_KINDS.has(parsed.kind);
  if (isWrite && !parsed.approvedBy) {
    throw new Error(
      `Job ${parsed.jobId} (${parsed.kind}) é de escrita e não tem approvedBy. ` +
        'Escrita em equipamento exige aprovação humana explícita.',
    );
  }
  return parsed;
}
