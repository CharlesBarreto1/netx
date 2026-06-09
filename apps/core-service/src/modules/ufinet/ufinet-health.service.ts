import { Injectable, Logger } from '@nestjs/common';

/**
 * Circuit breaker da Ufinet (in-memory, por instância).
 *
 * Problema: quando a API da Ufinet fica instável/fora do ar, o poller batia
 * neles a cada ciclo com TODOS os serviços transientes — e, pior, os erros de
 * transporte/5xx contavam pro limite de tentativas, "queimando" as O.S como
 * FAILED durante uma queda que não é culpa do serviço.
 *
 * Este breaker separa "Ufinet indisponível" (infra) de "erro de negócio":
 *   - N falhas de INFRA seguidas → estado DEGRADADO. O poller passa pra "modo
 *     sonda" (1 chamada por ciclo em vez do lote inteiro), parando de martelar.
 *   - O primeiro sucesso (Ufinet respondeu — 2xx, 4xx ou 426) zera tudo e volta
 *     ao normal; os serviços retomam do estado em que pararam (a máquina de
 *     estados é idempotente). Nenhuma O.S vira FAILED por causa da queda.
 */
@Injectable()
export class UfinetHealthService {
  private readonly logger = new Logger(UfinetHealthService.name);

  /** Falhas de infra seguidas pra considerar a Ufinet fora. */
  private static readonly DEGRADE_THRESHOLD = 3;

  private consecutiveInfraFailures = 0;
  private degradedSince: Date | null = null;
  private lastFailureAt: Date | null = null;
  private lastError: string | null = null;

  isDegraded(): boolean {
    return this.consecutiveInfraFailures >= UfinetHealthService.DEGRADE_THRESHOLD;
  }

  /** Ufinet respondeu (qualquer status HTTP, ou 426): está NO AR. */
  recordSuccess(): void {
    if (this.degradedSince) {
      const downMs = Date.now() - this.degradedSince.getTime();
      this.logger.warn(
        `[ufinet] RECUPEROU — Ufinet voltou após ${Math.round(downMs / 60_000)}min ` +
          'indisponível. Retomando processamento normal das O.S.',
      );
    }
    this.consecutiveInfraFailures = 0;
    this.degradedSince = null;
    this.lastError = null;
  }

  /** Erro de infra (transporte/5xx/429): Ufinet inalcançável. */
  recordInfraFailure(error: string): void {
    this.consecutiveInfraFailures += 1;
    this.lastFailureAt = new Date();
    this.lastError = error;
    if (this.consecutiveInfraFailures === UfinetHealthService.DEGRADE_THRESHOLD) {
      this.degradedSince = new Date();
      this.logger.error(
        `[ufinet] DEGRADADO — Ufinet indisponível (${this.consecutiveInfraFailures} falhas ` +
          'de infra seguidas). Poller em modo sonda (1 req/ciclo) até recuperar. ' +
          'As O.S NÃO viram FAILED — retomam sozinhas quando a Ufinet voltar.',
      );
    }
  }

  snapshot(): {
    degraded: boolean;
    consecutiveInfraFailures: number;
    degradedSince: string | null;
    lastFailureAt: string | null;
    lastError: string | null;
  } {
    return {
      degraded: this.isDegraded(),
      consecutiveInfraFailures: this.consecutiveInfraFailures,
      degradedSince: this.degradedSince?.toISOString() ?? null,
      lastFailureAt: this.lastFailureAt?.toISOString() ?? null,
      lastError: this.lastError,
    };
  }
}
