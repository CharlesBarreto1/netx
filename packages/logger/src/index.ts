import pino, { type Logger, type LoggerOptions } from 'pino';

export type { Logger } from 'pino';

export interface CreateLoggerOptions {
  service: string;
  env?: string;
  level?: string;
}

/**
 * Creates a Pino logger configured for structured logging in production
 * (JSON stdout, ready for Loki/CloudWatch/Datadog) and pretty output in dev.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const isDev = (options.env ?? process.env.NODE_ENV) === 'development';

  const config: LoggerOptions = {
    level: options.level ?? process.env.LOG_LEVEL ?? 'info',
    base: {
      service: options.service,
      env: options.env ?? process.env.NODE_ENV ?? 'development',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        '*.password',
        '*.passwordHash',
        '*.refreshToken',
        '*.accessToken',
      ],
      censor: '[REDACTED]',
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname,service,env',
              messageFormat: '[{service}] {msg}',
            },
          },
        }
      : {}),
  };

  return pino(config);
}
