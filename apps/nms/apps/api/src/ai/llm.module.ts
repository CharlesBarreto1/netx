import { Global, Module } from '@nestjs/common';
import { LlmService } from './llm.service.js';

/** Global para o LlmService ser injetável tanto na IA quanto no backup (resumo de diff). */
@Global()
@Module({
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
