import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';

import { loadConfig } from '@netx/config';

interface ModuleStatus {
  code: string;
  entitled: boolean;
}

/**
 * Gate de entitlement por módulo no edge (canal 2 do ecossistema). Antes de
 * repassar /api/v1/<modulo>/* o gateway pergunta ao Core quais módulos a licença
 * desta instância habilita (`GET /v1/license/modules`) e cacheia por TTL curto.
 *
 * FAIL-OPEN por design (espelha o ModuleEntitlementGuard do Core): se o Core
 * estiver indisponível ou a resposta for inesperada, NÃO bloqueia — preferimos
 * deixar passar a derrubar um cliente pagante por causa de um hiccup do edge.
 * A trava real continua sendo o guard do Core; este é só uma porta antecipada.
 */
@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);
  private readonly config = loadConfig();
  private readonly ttlMs = 60_000;
  private cache?: { at: number; modules: Set<string> };

  constructor(private readonly http: HttpService) {}

  /** true se o módulo está habilitado OU se não deu pra determinar (fail-open). */
  async isEntitled(code: string, authHeader?: string): Promise<boolean> {
    const modules = await this.entitledModules(authHeader);
    if (modules === null) return true; // fail-open
    return modules.has(code);
  }

  private async entitledModules(authHeader?: string): Promise<Set<string> | null> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < this.ttlMs) return this.cache.modules;
    try {
      const base = `http://${this.config.coreService.host}:${this.config.coreService.port}`;
      const res = await firstValueFrom(
        this.http.get<ModuleStatus[]>(`${base}/v1/license/modules`, {
          headers: authHeader ? { authorization: authHeader } : {},
          validateStatus: () => true,
          timeout: 5_000,
        }),
      );
      if (res.status !== 200 || !Array.isArray(res.data)) return null;
      const set = new Set(res.data.filter((m) => m.entitled).map((m) => m.code));
      this.cache = { at: now, modules: set };
      return set;
    } catch (err) {
      this.logger.warn(
        `não consegui ler entitlement do Core (fail-open): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
