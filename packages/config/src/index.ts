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
  };
}
