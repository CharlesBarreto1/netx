import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

import type { ProblemDetails } from '@netx/shared';
import { ErrorCodes } from '@netx/shared';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const correlationId = (req.headers['x-correlation-id'] as string) ?? undefined;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const envelope: ProblemDetails =
        typeof body === 'object' && body !== null
          ? { status, instance: req.originalUrl, correlationId, ...(body as Record<string, unknown>) } as ProblemDetails
          : {
              type: ErrorCodes.INTERNAL,
              title: (body as string) ?? 'Error',
              status,
              instance: req.originalUrl,
              correlationId,
            };
      res.status(status).json(envelope);
      return;
    }

    this.logger.error('Unhandled exception', exception as Error);
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
