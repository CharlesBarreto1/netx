import { z } from 'zod';

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
  // TTLs longos pra UX "login permanente". Frontend faz auto-refresh
  // transparente em 401 antes de cair pra /login. Operadores de ISP
  // tipicamente trabalham em estações fixas, baixo risco de roubo de token.
  // Pra ambientes com requisitos rígidos (ex.: tenant cliente bancário),
  // sobrescreva via env: JWT_ACCESS_EXPIRES_IN=15m JWT_REFRESH_EXPIRES_IN=7d.
  JWT_ACCESS_EXPIRES_IN: z.string().default('12h'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('90d'),

  // Argon2
  ARGON2_MEMORY_COST: z.coerce.number().int().positive().default(19_456),
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),

  // Multi-tenancy
  TENANT_RESOLUTION_STRATEGY: z.enum(['subdomain', 'header', 'jwt']).default('subdomain'),
  TENANT_HEADER_NAME: z.string().default('x-tenant-id'),
  DEFAULT_TENANT_SLUG: z.string().default('default'),

  // Observability (optional)
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().default('netx'),
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
  observability: {
    otlpEndpoint?: string;
    serviceName: string;
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
    observability: {
      otlpEndpoint: e.OTEL_EXPORTER_OTLP_ENDPOINT,
      serviceName: e.OTEL_SERVICE_NAME,
    },
  };
}
