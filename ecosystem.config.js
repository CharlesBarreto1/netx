/**
 * PM2 ecosystem config — NetX (VPS de DEV; produção é gerenciada por systemd
 * via installer em /opt/netx). Requer Node 22+ (engines.node do package.json).
 *
 * Uso na VPS (como usuário `netx`):
 *
 *   cd ~/apps/netx
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup systemd -u netx --hp /home/netx   # cole a linha sudo que ele imprime
 *
 * Logs:
 *   pm2 logs --lines 100
 *   pm2 logs netx-core
 *
 * Restart após deploy:
 *   pm2 reload all              # zero-downtime quando possível
 *   pm2 restart ecosystem.config.js --update-env
 *
 * Caminhos absolutos foram usados de propósito — PM2 sob systemd não herda CWD.
 *
 * IMPORTANTE — env vars: o `.env` da raiz é carregado AQUI mesmo via dotenv,
 * pra que TODOS os apps recebam as mesmas vars (DATABASE_URL, JWT_*, REDIS_URL,
 * RABBITMQ_URL, etc). Sem isso, PM2 sob systemd inicia os procs com env mínima
 * (só PATH, HOME, NODE_ENV) e o `loadConfig()` valida zod e falha em produção.
 */
const path = require('path');
const ENV_PATH = path.join(__dirname, '.env');

// Carrega .env e mescla nas vars globais (process.env). Cada app abaixo pega
// via spread; pra não correr risco de "vars vazias" se o .env não existir,
// usamos suppress: silently ignore.
try {
  // dotenv pode não estar instalado no momento em que o ecosystem.config.js
  // é parseado pelo PM2 (ex.: deploy inicial sem node_modules). Tentamos o
  // require dentro do try pra não travar.
  require('dotenv').config({ path: ENV_PATH });
} catch {
  // sem dotenv — confia que NODE_ENV e demais vars já estão no shell parent
}

// Snapshot das vars do `.env` que cada app recebe (não copiamos tudo do
// process.env pra evitar leak de variáveis aleatórias do shell).
function appEnv(extra = {}) {
  const keys = [
    'NODE_ENV', 'LOG_LEVEL',
    'API_GATEWAY_PORT', 'API_GATEWAY_HOST', 'API_GATEWAY_CORS_ORIGINS', 'API_GATEWAY_GLOBAL_PREFIX',
    'CORE_SERVICE_PORT', 'CORE_SERVICE_HOST',
    'WEB_PORT', 'NEXT_PUBLIC_API_URL', 'INTERNAL_API_URL',
    'DATABASE_URL', 'REDIS_URL', 'RABBITMQ_URL',
    'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'JWT_ACCESS_EXPIRES_IN', 'JWT_REFRESH_EXPIRES_IN',
    'ARGON2_MEMORY_COST', 'ARGON2_TIME_COST', 'ARGON2_PARALLELISM',
    'TENANT_RESOLUTION_STRATEGY', 'TENANT_HEADER_NAME', 'DEFAULT_TENANT_SLUG',
    'EVOLUTION_URL', 'EVOLUTION_API_KEY', 'WEBHOOK_BASE_URL', 'WHATSAPP_MEDIA_ROOT',
    'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_SERVICE_NAME',
    // TR-069 ACS (cwmp-server) — porta + tuning de diagnóstico/paths Huawei.
    'CWMP_PORT', 'CWMP_HOST', 'CWMP_AUTH_USER', 'CWMP_AUTH_PASSWORD',
    'HUAWEI_VOLTAGE_DIVISOR', 'TR069_FEC_HEC_DELTA_ALERT', 'TR069_DIAGNOSTIC_RETENTION_DAYS',
    'TR069_PPP_ENABLED', 'TR069_HOSTS_ENABLED', 'TR069_SPEEDTEST_URL',
    'HUAWEI_GPON_IFACE_PATH', 'HUAWEI_OPTICAL_DIVISOR', 'HUAWEI_PPPOE_WAN_INDEX',
    'TR069_DIAGNOSTIC_INTERVAL_MIN', 'TR069_OFFLINE_AFTER_MIN',
    'TR069_DIAGNOSTICS_ENABLED', 'TR069_WIFI_CLIENTS_ENABLED',
  ];
  const env = {};
  for (const k of keys) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  return { ...env, ...extra };
}

module.exports = {
  apps: [
    {
      name: 'netx-core',
      cwd: '/home/netx/apps/netx/apps/core-service',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: appEnv({
        // Aponta pro pg_dump 16, alinhado com o Postgres 16 do projeto.
        // Em VPS Debian 12 o pg_dump default é 15 e dispara
        // "server version mismatch". Se a versão do server mudar, ajusta aqui.
        PG_DUMP_BIN: '/usr/lib/postgresql/16/bin/pg_dump',
        BACKUP_DIR: '/var/backups/netx',
      }),
      max_memory_restart: '1G',
      out_file: '/home/netx/.pm2/logs/netx-core.out.log',
      error_file: '/home/netx/.pm2/logs/netx-core.err.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'netx-gateway',
      cwd: '/home/netx/apps/netx/apps/api-gateway',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: appEnv(),
      max_memory_restart: '512M',
      out_file: '/home/netx/.pm2/logs/netx-gateway.out.log',
      error_file: '/home/netx/.pm2/logs/netx-gateway.err.log',
      merge_logs: true,
      time: true,
    },
    {
      name: 'netx-web',
      cwd: '/home/netx/apps/netx/apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3200',
      instances: 1,
      exec_mode: 'fork',
      env: appEnv({ PORT: '3200' }),
      max_memory_restart: '512M',
      out_file: '/home/netx/.pm2/logs/netx-web.out.log',
      error_file: '/home/netx/.pm2/logs/netx-web.err.log',
      merge_logs: true,
      time: true,
    },
    {
      // ACS TR-069 (CWMP) — escuta CPEs na porta 7547. PRECISA estar aqui pra
      // que o deploy rebuilde/reinicie junto: a lógica de diagnóstico (parse de
      // GetParameterValues, gravação de Tr069Diagnostic, alertas) vive neste
      // processo. Sem isto, o ACS roda código velho e nenhum diagnóstico é gravado.
      name: 'netx-cwmp',
      cwd: '/home/netx/apps/netx/apps/cwmp-server',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: appEnv({ CWMP_PORT: process.env.CWMP_PORT ?? '7547' }),
      max_memory_restart: '512M',
      out_file: '/home/netx/.pm2/logs/netx-cwmp.out.log',
      error_file: '/home/netx/.pm2/logs/netx-cwmp.err.log',
      merge_logs: true,
      time: true,
    },
  ],
};
