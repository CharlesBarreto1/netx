import { z } from 'zod';

export * from './build-meta';

/**
 * Strongly-typed environment schema shared across services.
 *
 * Usage:
 *   import { loadConfig } from '@netx/config';
 *   const cfg = loadConfig();
 *   cfg.database.url // string
 */
const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

// Trata string vazia como "não definido". O .env renderizado pelo installer
// escreve vars opcionais como `VAR=` (vazio); sem isso, schemas como
// z.string().uuid().optional() recebem "" (≠ undefined) e FALHAM a validação,
// derrubando o boot. Use envolvendo o schema opcional: emptyAsUndefined(z....().optional()).
const emptyAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

/** Lista separada por vírgula em array, descartando entradas vazias. */
const splitList = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Services
  API_GATEWAY_PORT: z.coerce.number().int().positive().default(3000),
  API_GATEWAY_HOST: z.string().default('0.0.0.0'),
  API_GATEWAY_CORS_ORIGINS: z.string().default('*'),
  API_GATEWAY_GLOBAL_PREFIX: z.string().default('api'),

  CORE_SERVICE_PORT: z.coerce.number().int().positive().default(3101),
  CORE_SERVICE_HOST: z.string().default('0.0.0.0'),

  // NMS (módulo do ecossistema, apps/nms). O gateway repassa /api/nms/* pra cá
  // (canal 4). Sub-build pnpm isolado; em dev roda em :3300 (PORT do NMS).
  NMS_SERVICE_HOST: z.string().default('127.0.0.1'),
  NMS_SERVICE_PORT: z.coerce.number().int().positive().default(3300),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // RabbitMQ
  RABBITMQ_URL: z.string().url(),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  // Secret separado pra Portal do Cliente. Confunir com o secret de operador
  // (JWT_ACCESS_SECRET) permite audience-confusion: um token de portal
  // assinado pelo MESMO secret poderia, sob qualquer bug de checagem de
  // audience, ser aceito como token de operador. Separação reduz blast radius.
  PORTAL_JWT_SECRET: z.string().min(32, 'PORTAL_JWT_SECRET must be at least 32 characters'),
  // Access curto + refresh moderado. Token vazado dura no máximo o TTL access;
  // logout invalida via Session.revokedAt (checado pelo JwtStrategy).
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Argon2
  ARGON2_MEMORY_COST: z.coerce.number().int().positive().default(19_456),
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),

  // Multi-tenancy
  TENANT_RESOLUTION_STRATEGY: z.enum(['subdomain', 'header', 'jwt']).default('subdomain'),
  TENANT_HEADER_NAME: z.string().default('x-tenant-id'),
  DEFAULT_TENANT_SLUG: z.string().default('default'),

  // KMS master key (cifra credenciais sensíveis no DB — equipment.apiPassword,
  // sshPassword etc). Hex de 64 chars (256 bits) gerado pelo installer e
  // persistido em /etc/netx/.secrets. NUNCA mude — torna passwords irrecuperáveis.
  // Gerar com: openssl rand -hex 32
  KMS_MASTER_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'KMS_MASTER_KEY deve ser hex 64 chars (32 bytes)'),

  // Observability (optional)
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().default('netx'),

  // Storage (MinIO / S3-compatível) — uploads de RH (documentos, comprovantes,
  // holerites) e, no futuro, fotos do mobile. Bytes não passam pelo core:
  // entregamos presigned URLs pro client subir/baixar direto.
  // OPCIONAL: sem endpoint+keys, o StorageService fica desabilitado e os
  // endpoints de upload retornam 503 (resto do sistema sobe normal).
  STORAGE_ENDPOINT: z.string().url().optional(),       // ex.: http://127.0.0.1:9000
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_BUCKET: z.string().default('netx-files'),
  STORAGE_ACCESS_KEY: z.string().optional(),
  STORAGE_SECRET_KEY: z.string().optional(),
  STORAGE_FORCE_PATH_STYLE: booleanFromString.optional(), // MinIO exige; default true no mapeamento
  STORAGE_PUBLIC_URL: z.string().url().optional(),     // base pública (nginx /minio/*)

  // Licenciamento (valida licença desta instalação com o Hub da NetX).
  // OPCIONAL e FAIL-OPEN: sem NETX_HUB_URL + NETX_LICENSE_KEY o módulo é no-op
  // (libera tudo). Instalações antigas e dev não quebram. Ver docs/licensing.md.
  NETX_HUB_URL: emptyAsUndefined(z.string().url().optional()),       // ex.: https://hub.netx.com.br
  NETX_LICENSE_KEY: emptyAsUndefined(z.string().min(8).optional()),  // segredo da instância (auth no heartbeat)
  NETX_INSTANCE_ID: emptyAsUndefined(z.string().uuid().optional()),  // uuid da instalação (enrollment)

  // Motor de IA (@netx/ai, módulo netx-ai). Default = Ollama self-hosted na
  // própria VPS, SEM fallback (100% local). Híbrido: ligue AI_FALLBACK_ENABLED
  // e configure o provider de nuvem (Anthropic reaproveita ANTHROPIC_API_KEY).
  // A IA é conselheira — nunca aplica config. Ausente = providers caem nos
  // defaults; o módulo decide se há backend disponível em runtime.
  AI_PROVIDER: z.enum(['ollama', 'openai-compat', 'anthropic']).default('ollama'),
  AI_BASE_URL: emptyAsUndefined(z.string().url().optional()),        // ex.: http://127.0.0.1:11434
  AI_MODEL: z.string().default('qwen2.5:3b-instruct'),              // 3B: rápido em CPU, cabe em 8GB
  AI_API_KEY: emptyAsUndefined(z.string().optional()),              // só p/ provider primário de nuvem
  AI_FALLBACK_ENABLED: booleanFromString.optional(),               // default false (mapeado)
  AI_FALLBACK_PROVIDER: z.enum(['ollama', 'openai-compat', 'anthropic']).default('anthropic'),
  AI_FALLBACK_MODEL: z.string().default('claude-haiku-4-5'),
  AI_FALLBACK_BASE_URL: emptyAsUndefined(z.string().url().optional()),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000), // CPU local é lento (minutos)
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(1024),
  AI_REDACT_PII: booleanFromString.optional(),                      // default true (mapeado)
  // Credencial Anthropic (fallback de nuvem default). Reutilizada pelos
  // consumidores legados (alarmes, NMS) até migrarem pro @netx/ai.
  ANTHROPIC_API_KEY: emptyAsUndefined(z.string().optional()),

  // --- OIDC Provider (o Core como emissor de identidade) ---
  // Base pública onde esta instalação é alcançável. O issuer é derivado dela:
  // <base>/api/v1/oidc/<tenant-slug>. Cada instalação tem a sua.
  OIDC_PUBLIC_BASE_URL: z.string().url().optional(),
  OIDC_ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(600),
  OIDC_REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(1209600),
  OIDC_SESSION_TTL: z.coerce.number().int().positive().default(86400),
  // Assina os cookies de sessão do provider. Distinto do JWT_ACCESS_SECRET de
  // propósito: comprometer um não deve comprometer o outro.
  OIDC_COOKIE_SECRET: z.string().min(32).optional(),
  OIDC_NEXTCLOUD_CLIENT_ID: z.string().default('nextcloud'),
  OIDC_NEXTCLOUD_CLIENT_SECRET: z.string().min(32).optional(),
  OIDC_NEXTCLOUD_REDIRECT_URIS: z.string().default(''),
  OIDC_NEXTCLOUD_POST_LOGOUT_REDIRECT_URIS: z.string().default(''),
});

export type RawEnv = z.infer<typeof baseSchema>;

export interface Config {
  env: RawEnv['NODE_ENV'];
  logLevel: RawEnv['LOG_LEVEL'];
  apiGateway: {
    port: number;
    host: string;
    corsOrigins: string[];
    globalPrefix: string;
  };
  coreService: {
    port: number;
    host: string;
  };
  nmsService: {
    port: number;
    host: string;
  };
  database: { url: string };
  redis: { url: string };
  rabbitmq: { url: string };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    portalSecret: string;
    accessExpiresIn: string;
    refreshExpiresIn: string;
  };
  argon2: {
    memoryCost: number;
    timeCost: number;
    parallelism: number;
  };
  tenancy: {
    strategy: 'subdomain' | 'header' | 'jwt';
    headerName: string;
    defaultTenantSlug: string;
  };
  oidc: {
    publicBaseUrl: string;
    accessTokenTtlSeconds: number;
    refreshTokenTtlSeconds: number;
    sessionTtlSeconds: number;
    cookieSecret: string;
    nextcloudClientId: string;
    nextcloudClientSecret: string;
    nextcloudRedirectUris: string[];
    nextcloudPostLogoutRedirectUris: string[];
  };
  kms: {
    masterKey: string;
  };
  observability: {
    otlpEndpoint?: string;
    serviceName: string;
  };
  storage: {
    enabled: boolean;
    endpoint?: string;
    region: string;
    bucket: string;
    accessKey?: string;
    secretKey?: string;
    forcePathStyle: boolean;
    publicUrl?: string;
  };
  licensing: {
    /** Ligado só quando hubUrl + key + instanceId estão presentes. */
    enabled: boolean;
    hubUrl?: string;
    licenseKey?: string;
    instanceId?: string;
  };
  ai: {
    provider: 'ollama' | 'openai-compat' | 'anthropic';
    baseUrl?: string;
    model: string;
    apiKey?: string;
    fallbackEnabled: boolean;
    fallbackProvider: 'ollama' | 'openai-compat' | 'anthropic';
    fallbackModel: string;
    fallbackBaseUrl?: string;
    anthropicApiKey?: string;
    timeoutMs: number;
    maxTokens: number;
    redactPii: boolean;
  };
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = baseSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;

  return {
    env: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    apiGateway: {
      port: e.API_GATEWAY_PORT,
      host: e.API_GATEWAY_HOST,
      corsOrigins: e.API_GATEWAY_CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
      globalPrefix: e.API_GATEWAY_GLOBAL_PREFIX,
    },
    coreService: { port: e.CORE_SERVICE_PORT, host: e.CORE_SERVICE_HOST },
    nmsService: { port: e.NMS_SERVICE_PORT, host: e.NMS_SERVICE_HOST },
    database: { url: e.DATABASE_URL },
    redis: { url: e.REDIS_URL },
    rabbitmq: { url: e.RABBITMQ_URL },
    jwt: {
      accessSecret: e.JWT_ACCESS_SECRET,
      refreshSecret: e.JWT_REFRESH_SECRET,
      portalSecret: e.PORTAL_JWT_SECRET,
      accessExpiresIn: e.JWT_ACCESS_EXPIRES_IN,
      refreshExpiresIn: e.JWT_REFRESH_EXPIRES_IN,
    },
    argon2: {
      memoryCost: e.ARGON2_MEMORY_COST,
      timeCost: e.ARGON2_TIME_COST,
      parallelism: e.ARGON2_PARALLELISM,
    },
    tenancy: {
      strategy: e.TENANT_RESOLUTION_STRATEGY,
      headerName: e.TENANT_HEADER_NAME,
      defaultTenantSlug: e.DEFAULT_TENANT_SLUG,
    },
    oidc: {
      publicBaseUrl: e.OIDC_PUBLIC_BASE_URL ?? '',
      accessTokenTtlSeconds: e.OIDC_ACCESS_TOKEN_TTL,
      refreshTokenTtlSeconds: e.OIDC_REFRESH_TOKEN_TTL,
      sessionTtlSeconds: e.OIDC_SESSION_TTL,
      cookieSecret: e.OIDC_COOKIE_SECRET ?? '',
      nextcloudClientId: e.OIDC_NEXTCLOUD_CLIENT_ID,
      nextcloudClientSecret: e.OIDC_NEXTCLOUD_CLIENT_SECRET ?? '',
      nextcloudRedirectUris: splitList(e.OIDC_NEXTCLOUD_REDIRECT_URIS),
      nextcloudPostLogoutRedirectUris: splitList(e.OIDC_NEXTCLOUD_POST_LOGOUT_REDIRECT_URIS),
    },
    kms: {
      masterKey: e.KMS_MASTER_KEY,
    },
    observability: {
      otlpEndpoint: e.OTEL_EXPORTER_OTLP_ENDPOINT,
      serviceName: e.OTEL_SERVICE_NAME,
    },
    storage: {
      enabled: Boolean(e.STORAGE_ENDPOINT && e.STORAGE_ACCESS_KEY && e.STORAGE_SECRET_KEY),
      endpoint: e.STORAGE_ENDPOINT,
      region: e.STORAGE_REGION,
      bucket: e.STORAGE_BUCKET,
      accessKey: e.STORAGE_ACCESS_KEY,
      secretKey: e.STORAGE_SECRET_KEY,
      forcePathStyle: e.STORAGE_FORCE_PATH_STYLE ?? true,
      publicUrl: e.STORAGE_PUBLIC_URL,
    },
    licensing: {
      enabled: Boolean(e.NETX_HUB_URL && e.NETX_LICENSE_KEY && e.NETX_INSTANCE_ID),
      hubUrl: e.NETX_HUB_URL,
      licenseKey: e.NETX_LICENSE_KEY,
      instanceId: e.NETX_INSTANCE_ID,
    },
    ai: {
      provider: e.AI_PROVIDER,
      baseUrl: e.AI_BASE_URL,
      model: e.AI_MODEL,
      apiKey: e.AI_API_KEY,
      fallbackEnabled: e.AI_FALLBACK_ENABLED ?? false,
      fallbackProvider: e.AI_FALLBACK_PROVIDER,
      fallbackModel: e.AI_FALLBACK_MODEL,
      fallbackBaseUrl: e.AI_FALLBACK_BASE_URL,
      anthropicApiKey: e.ANTHROPIC_API_KEY,
      timeoutMs: e.AI_TIMEOUT_MS,
      maxTokens: e.AI_MAX_TOKENS,
      redactPii: e.AI_REDACT_PII ?? true,
    },
  };
}
