import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Pipe para validar e transformar parâmetros de querystring usando Zod.
 * Usa `safeParse` e formata erros no padrão RFC 7807-like do projeto.
 *
 * Usage:
 *   list(@Query(new ZodQueryPipe(ListCustomersQuerySchema)) q: ListCustomersQuery)
 */
@Injectable()
export class ZodQueryPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new BadRequestException({
        type: 'urn:netx:error:validation',
        title: 'Invalid query parameters',
        status: 400,
        errors: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    return result.data;
  }
}
