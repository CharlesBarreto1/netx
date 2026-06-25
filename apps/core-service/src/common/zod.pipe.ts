import { BadRequestException, PipeTransform, Injectable, ArgumentMetadata, createParamDecorator, ExecutionContext, applyDecorators } from '@nestjs/common';
import { Body, Query } from '@nestjs/common';
import { ZodSchema } from 'zod';

/**
 * Pipe that validates a request body against a Zod schema.
 * Usage:  myHandler(@ZodBody(MySchema) dto: MyDto)
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        type: 'urn:netx:error:validation',
        title: 'Validation failed',
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

export const ZodBody = <T>(schema: ZodSchema<T>) => Body(new ZodValidationPipe(schema));

/** Valida a query string contra um schema Zod. Usage: handler(@ZodQuery(S) q: T) */
export const ZodQuery = <T>(schema: ZodSchema<T>) => Query(new ZodValidationPipe(schema));
