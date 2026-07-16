import { Controller, Get } from '@nestjs/common';
import { SummaryService } from './summary.service.js';

/**
 * `/summary` — telemetria agregada da frota (dados reais do Timescale) para o
 * cockpit do NetX. Leitura: qualquer autenticado (o guard global já exige JWT).
 */
@Controller('summary')
export class SummaryController {
  constructor(private readonly summary: SummaryService) {}

  @Get()
  fleet() {
    return this.summary.fleet();
  }
}
