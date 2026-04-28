import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { ErrorCodes, type ProblemDetails } from '@netx/shared';

/**
 * GlobalExceptionFilter — normaliza qualquer erro do core-service em
 * ProblemDetails (RFC 7807), no mesmo formato emitido pelo api-gateway.
 *
 * Por que existe:
 *   O Nest serializa exceptions como `{ statusCode, message, error }` por
 *   padrão. O frontend (`ApiError.friendlyMessage`) lia só `detail`/`title`
 *   /`errors[]` (RFC 7807) — sem esse filtro, mensagens de
 *   ConflictException/NotFoundException apareciam como "HTTP 409"/"HTTP 404"
 *   no toast em vez de algo útil.
 *
 *   Este filtro:
 *     - mantém `errors[]` se a exception já tinha um (ZodValidationPipe).
 *     - converte `message` (string | array) do Nest em `detail`.
 *     - mapeia status conhecidos pra `type` URN.
 *     - registra em log no nível adequado (warn p/ 4xx, error p/ 5xx).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const correlationId =
      (req.headers['x-correlation-id'] as string | undefined) ?? undefined;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      // Caso 1: já é um ProblemDetails (ZodValidationPipe, MFA, etc.).
      if (
        typeof body === 'object' &&
        body !== null &&
        ('type' in body || 'errors' in body || 'detail' in body)
      ) {
        const envelope: ProblemDetails = {
          type: ErrorCodes.INTERNAL,
          title: 'Error',
          status,
          ...(body as Record<string, unknown>),
          instance: req.originalUrl,
          correlationId,
        } as ProblemDetails;
        // type não setado pelo handler? Inferir a partir do status.
        if (!('type' in body)) envelope.type = inferType(status);
        const ctx = `${req.method} ${req.originalUrl}${
          correlationId ? ` cid=${correlationId}` : ''
        }`;
        if (status >= 500) {
          this.logger.error(
            `[${status}] ${(exception as Error).message}`,
            ctx,
          );
        } else {
          this.logger.warn(`[${status}] ${(exception as Error).message}`, ctx);
        }
        res.status(status).json(envelope);
        return;
      }

      // Caso 2: body do Nest default — `{ statusCode, message, error }`.
      // Convertemos `message` em `detail` (string ou junta o array).
      const nestBody = (body ?? {}) as { message?: string | string[]; error?: string };
      const detail =
        typeof nestBody.message === 'string'
          ? nestBody.message
          : Array.isArray(nestBody.message)
            ? nestBody.message.join(' · ')
            : exception.message;
      const envelope: ProblemDetails = {
        type: inferType(status),
        title: nestBody.error ?? defaultTitle(status),
        status,
        detail,
        instance: req.originalUrl,
        correlationId,
      };
      const ctx = `${req.method} ${req.originalUrl}${
        correlationId ? ` cid=${correlationId}` : ''
      }`;
      if (status >= 500) {
        this.logger.error(`[${status}] ${detail}`, ctx);
      } else {
        this.logger.warn(`[${status}] ${detail}`, ctx);
      }
      res.status(status).json(envelope);
      return;
    }

    // Erro não-HTTP: log completo, devolve 500 sem vazar detalhes.
    const unhandledCtx = `${req.method} ${req.originalUrl}${
      correlationId ? ` cid=${correlationId}` : ''
    }`;
    this.logger.error(
      (exception as Error).stack ?? String(exception),
      unhandledCtx,
    );
    const envelope: ProblemDetails = {
      type: ErrorCodes.INTERNAL,
      title: 'Internal Server Error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      instance: req.originalUrl,
      correlationId,
    };
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json(envelope);
  }
}

function inferType(status: number): string {
  switch (status) {
    case 400:
      return ErrorCodes.VALIDATION;
    case 401:
      return ErrorCodes.UNAUTHORIZED;
    case 403:
      return ErrorCodes.FORBIDDEN;
    case 404:
      return ErrorCodes.NOT_FOUND;
    case 409:
      return ErrorCodes.CONFLICT;
    case 429:
      return ErrorCodes.RATE_LIMITED;
    default:
      return ErrorCodes.INTERNAL;
  }
}

function defaultTitle(status: number): string {
  switch (status) {
    case 400:
      return 'Bad Request';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not Found';
    case 409:
      return 'Conflict';
    case 422:
      return 'Unprocessable Entity';
    case 429:
      return 'Too Many Requests';
    default:
      return status >= 500 ? 'Internal Server Error' : 'Error';
  }
}
