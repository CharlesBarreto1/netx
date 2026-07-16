import { z } from 'zod';

/**
 * Trata string vazia como ausente (undefined). O docker-compose expande
 * `${VAR:-}` / `${VAR}` para "" quando a var não está no .env — e "" quebra os
 * validadores (`.url()`, `.min()`) mesmo em campos `.optional()`, derrubando a
 * API no boot. Envolver os opcionais com isto os torna resilientes a "".
 */
const emptyAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

/** Config validada no boot (AGENTS.md: env por Zod, falha cedo se faltar). */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  /** WS do servidor de terminal do device-gateway (a API faz proxy até aqui). */
  GATEWAY_TERMINAL_URL: z.string().url().default('ws://127.0.0.1:8766'),
  /** Segredo HS256 dos JWT de sessão (ADR 0007). Obrigatório e ≥32 chars — falha cedo se faltar. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter ≥32 caracteres'),
  /** Validade do token de sessão (formato do jsonwebtoken, ex.: 12h, 7d). */
  JWT_TTL: z.string().default('12h'),

  // ── SSO do ecossistema (canal 1) ──────────────────────────────────────────
  // Quando o NMS roda DENTRO do NetX, ele aceita o JWT de operador emitido pelo
  // Core (mesmo HS256), além do login nativo. OPCIONAL: sem CORE_JWT_SECRET, só
  // o login próprio do NMS funciona (modo standalone). O segredo é o
  // JWT_ACCESS_SECRET do Core; issuer/audience espelham os defaults do Core.
  CORE_JWT_SECRET: emptyAsUndefined(z.string().min(32).optional()),
  CORE_JWT_ISSUER: z.string().default('netx'),
  CORE_JWT_AUDIENCE: z.string().default('netx-api'),

  // ── IA delegada ao motor do NetX (canal 4) ────────────────────────────────
  // O NMS NÃO tem IA própria: o copiloto delega ao motor de IA do tenant no
  // core (`POST /api/v1/ai/complete`), que resolve provider/chave/modelo da
  // config do NetX (Configurações › IA). Base do core via gateway, ex.:
  // http://host.docker.internal:3000. Sem isso, a IA fica indisponível.
  CORE_API_URL: emptyAsUndefined(z.string().url().optional()),

  // ── Bus de eventos do ecossistema (canal 3) ───────────────────────────────
  // Consumidor de `netx.events` (RabbitMQ topic), espelhando o core: OFF por
  // default. Liga só com EVENTBUS_CONSUME=true E RABBITMQ_URL presente.
  RABBITMQ_URL: emptyAsUndefined(z.string().url().optional()),
  EVENTBUS_CONSUME: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  /** Exchange topic do bus (espelha o core). */
  EVENTBUS_EXCHANGE: z.string().default('netx.events'),
  /** Tenant carimbado nos eventos publicados (NMS é single-tenant). */
  EVENTBUS_TENANT_ID: z.string().default('default'),
  /** Seed do 1º admin no boot (só cria se não houver nenhum usuário). */
  ADMIN_USERNAME: z.string().default('admin'),
  /** Senha do seed admin. Se vazia, o boot gera uma aleatória e a imprime UMA vez no log. */
  ADMIN_PASSWORD: z.string().optional(),
  /** Repositório git onde as configs são versionadas (Pilar 4 / backup). */
  BACKUP_REPO_DIR: z.string().default('./config-backups'),
  /** Cron do backup automático (padrão: diário às 03:00). */
  BACKUP_CRON: z.string().default('0 3 * * *'),
  /** Chave da API Anthropic para a IA (4.2 resumo de diff, 4.3 copiloto). Opcional. */
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Modelos Claude: resumo de diff (barato/rápido) e copiloto (capaz). */
  LLM_MODEL_SUMMARY: z.string().default('claude-haiku-4-5'),
  LLM_MODEL_COPILOT: z.string().default('claude-sonnet-4-6'),
  /** Cron da varredura de anomalias estatísticas (padrão: a cada 10 min). */
  ANOMALY_CRON: z.string().default('*/10 * * * *'),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Config inválida (.env):\n${issues}`);
  }
  return parsed.data;
}
