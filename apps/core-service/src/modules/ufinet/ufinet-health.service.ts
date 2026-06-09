import { Injectable, Logger } from '@nestjs/common';

/**
 * Circuit breaker da Ufinet (in-memory, por instância).
 *
 * Distingue DOIS cenários que antes eram tratados igual:
 *
 *  1. Ufinet GERAL fora/instável → ≥2 serviços DIFERENTES tomam erro de infra
 *     na mesma janela. Aí o breaker fica DEGRADADO: o poller entra em "modo
 *     sonda" (1 req/ciclo) e NENHUMA O.S vira FAILED — todas retomam sozinhas
 *     quando a Ufinet voltar.
 *
 *  2. UM pedido envenenado (ex.: ZUX-28 com 500 "Error no controlado" persistente
 *     numa ordem travada) enquanto a Ufinet está NO AR → só ELE falha, o resto
 *     responde. NÃO degrada o breaker; esse serviço segue pro caminho de FAILED
 *     (com teto próprio) pra não martelar pra sempre e surgir pro operador.
 *
 * O sinal de "Ufinet no ar" é qualquer resposta dela (2xx/4xx/426): zera tudo.
 */
@Injectable()
export class UfinetHealthService {
  private readonly logger = new Logger(UfinetHealthService.name);

  /** Serviços DISTINTOS falhando por infra na janela pra considerar degradado. */
  private static readonly MIN_DISTINCT = 2;
  /** Janela de correlação das falhas de infra. */
  private static readonly WINDOW_MS = 3 * 60_000;

  /** externalId → epoch da última falha de infra. */
  private readonly recentFailures = new Map<string, number>();
  private degradedSince: Date | null = null;
  private lastFailureAt: Date | null = null;
  private lastError: string | null = null;

  private expire(now = Date.now()): void {
    for (const [k, t] of this.recentFailures) {
      if (now - t > UfinetHealthService.WINDOW_MS) this.recentFailures.delete(k);
    }
  }

  isDegraded(): boolean {
    this.expire();
    return this.recentFailures.size >= UfinetHealthService.MIN_DISTINCT;
  }

  /** Ufinet respondeu (2xx/4xx/426 = NO AR): zera o breaker. */
  recordSuccess(): void {
    if (this.degradedSince) {
      const downMs = Date.now() - this.degradedSince.getTime();
      this.logger.warn(
        `[ufinet] RECUPEROU — Ufinet voltou após ~${Math.round(downMs / 60_000)}min ` +
          'indisponível. Retomando processamento normal das O.S.',
      );
    }
    this.recentFailures.clear();
    this.degradedSince = null;
    this.lastError = null;
  }

  /** Erro de infra (transporte/5xx/429) em UM serviço. */
  recordInfraFailure(externalId: string, error: string): void {
    const now = Date.now();
    this.recentFailures.set(externalId, now);
    this.lastFailureAt = new Date();
    this.lastError = error;
    this.expire(now);
    if (
      this.recentFailures.size >= UfinetHealthService.MIN_DISTINCT &&
      !this.degradedSince
    ) {
      this.degradedSince = new Date();
      this.logger.error(
        `[ufinet] DEGRADADO — Ufinet indisponível (${this.recentFailures.size} serviços ` +
          'falhando por infra). Poller em modo sonda (1 req/ciclo). As O.S NÃO viram ' +
          'FAILED — retomam sozinhas quando a Ufinet voltar.',
      );
    }
  }

  snapshot(): {
    degraded: boolean;
    distinctFailing: number;
    degradedSince: string | null;
    lastFailureAt: string | null;
    lastError: string | null;
  } {
    return {
      degraded: this.isDegraded(),
      distinctFailing: this.recentFailures.size,
      degradedSince: this.degradedSince?.toISOString() ?? null,
      lastFailureAt: this.lastFailureAt?.toISOString() ?? null,
      lastError: this.lastError,
    };
  }
}
