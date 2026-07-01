/**
 * IdempotencyInterceptor — replay-safety pro NetX Field (offline-first).
 *
 * A outbox do app reenvia mutações quando a conexão volta. Se a resposta de um
 * envio anterior se perdeu (o servidor COMMITOU mas o app não recebeu o 2xx), o
 * reenvio reaplicaria a operação — inaceitável pra material consumido/financeiro.
 *
 * Contrato: o cliente manda um header `Idempotency-Key` (UUID gerado no device,
 * estável por operação). Este interceptor:
 *   - só atua em métodos mutantes (POST/PUT/PATCH/DELETE) COM o header e COM
 *     tenant autenticado; caso contrário é passthrough puro (blast radius mínimo);
 *   - se a chave já COMPLETOU, devolve a resposta guardada (não reaplica);
 *   - se está `pending` (outra requisição igual em andamento), 409 (cliente re-tenta);
 *   - senão reserva a chave, roda o handler, guarda a resposta no sucesso e
 *     libera a chave (delete) no erro — pra permitir novo retry.
 *
 * É genérico e opt-in pelo header: NÃO exige decorar nenhum controller. Só o
 * app manda o header, então a produção web/atual não muda de comportamento.
 */
import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { from, Observable, of } from 'rxjs';
import { catchError, concatMap } from 'rxjs/operators';

import { PrismaService } from '../../modules/prisma/prisma.service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function inFlight(): never {
  throw new ConflictException({
    type: 'urn:netx:error:idempotency-in-flight',
    title: 'Operação em andamento',
    detail: 'Uma requisição com a mesma Idempotency-Key já está sendo processada.',
    status: 409,
  });
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest();
    const method: string = req.method;
    const raw = req.headers?.['idempotency-key'];
    const key = Array.isArray(raw) ? raw[0] : raw;
    const tenantId: string | undefined = req.user?.tenantId;

    // Passthrough seguro: sem chave, método não-mutante, ou rota sem tenant.
    if (!key || !MUTATING.has(method) || !tenantId) return next.handle();

    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { tenantId_key: { tenantId, key } },
      select: { status: true, responseBody: true },
    });
    if (existing) {
      if (existing.status === 'completed') return of(existing.responseBody as unknown);
      inFlight();
    }

    // Reserva a chave. Corrida (unique violation) → trata como in-flight.
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          tenantId,
          userId: req.user?.sub ?? null,
          key: String(key).slice(0, 200),
          method,
          path: String(req.originalUrl ?? req.url ?? '').slice(0, 500),
          status: 'pending',
        },
      });
    } catch {
      inFlight();
    }

    return next.handle().pipe(
      concatMap((body) =>
        from(
          this.prisma.idempotencyKey
            .update({
              where: { tenantId_key: { tenantId, key } },
              data: {
                status: 'completed',
                statusCode: (req.res?.statusCode as number | undefined) ?? 200,
                responseBody: (body ?? null) as Prisma.InputJsonValue,
              },
            })
            .then(() => body)
            .catch(() => body),
        ),
      ),
      catchError((err) =>
        from(
          this.prisma.idempotencyKey
            .delete({ where: { tenantId_key: { tenantId, key } } })
            .catch(() => undefined)
            .then(() => {
              throw err;
            }),
        ),
      ),
    );
  }
}
