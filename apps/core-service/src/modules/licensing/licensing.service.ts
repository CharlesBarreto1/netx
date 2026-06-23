import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { loadConfig } from '@netx/config';
import {
  entitledModules as resolveEntitledModules,
  licenseDecision,
  verifyLicenseToken,
  type LicenseDecision,
  type LicenseStatusResponse,
  type ModuleCode,
} from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';

const SINGLETON_ID = 'singleton';

/**
 * LicensingService — fonte de verdade do estado da licença DESTA instalação.
 *
 * Mantém em memória a decisão atual (avaliada a partir do token persistido), pra
 * o guard consultar a cada request sem tocar o banco. O HeartbeatService chama
 * `applyToken()` quando renova; aqui só verificamos assinatura + decidimos
 * efeito. Tudo FAIL-OPEN: se o licenciamento está desligado (sem hubUrl/key),
 * `isEnabled()` é false e o guard nem chama a decisão.
 */
@Injectable()
export class LicensingService implements OnModuleInit {
  private readonly logger = new Logger(LicensingService.name);
  private readonly cfg = loadConfig().licensing;

  // Cache em memória: o token cru vigente (verificado uma vez no applyToken/boot)
  // e a última decisão. A expiração depende do relógio, então currentDecision()
  // sempre reavalia contra o "agora" — mas a assinatura não é re-verificada a
  // cada request (caro): guardamos o resultado do verify.
  private cachedToken: string | null = null;
  private decision: LicenseDecision | null = null;
  private lastHeartbeatAt: Date | null = null;
  private lastError: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  isEnabled(): boolean {
    return this.cfg.enabled;
  }

  get instanceId(): string | undefined {
    return this.cfg.instanceId;
  }
  get hubUrl(): string | undefined {
    return this.cfg.hubUrl;
  }
  get licenseKey(): string | undefined {
    return this.cfg.licenseKey;
  }

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled()) {
      this.logger.log('Licenciamento DESLIGADO (sem NETX_HUB_URL/NETX_LICENSE_KEY) — fail-open');
      return;
    }
    // Carrega o último token persistido pra já ter uma decisão antes do
    // primeiro heartbeat (o app pode subir offline e continuar válido se o
    // token ainda não expirou).
    const row = await this.prisma.licenseState.findUnique({ where: { id: SINGLETON_ID } });
    this.lastHeartbeatAt = row?.lastHeartbeatAt ?? null;
    this.lastError = row?.lastError ?? null;
    if (row?.token) {
      this.recompute(row.token);
      this.logger.log(`Licenciamento LIGADO — efeito atual: ${this.decision?.effect}`);
    } else {
      // Ligado mas sem token ainda: bloqueia UI até o primeiro heartbeat válido.
      this.recompute(null);
      this.logger.warn('Licenciamento LIGADO mas sem token — aguardando primeiro heartbeat');
    }
  }

  /** Recalcula a decisão a partir de um token (ou ausência dele). */
  private recompute(token: string | null): void {
    this.cachedToken = token;
    const verify = token ? verifyLicenseToken(token) : null;
    this.decision = licenseDecision(verify, Math.floor(Date.now() / 1000));
  }

  /**
   * Decisão atual da licença. `null` quando o licenciamento está desligado
   * (fail-open) — o guard interpreta null como "libera". Reavalia contra o
   * relógio atual (expiração depende do "agora"), reusando o verify cacheado.
   */
  currentDecision(): LicenseDecision | null {
    if (!this.isEnabled()) return null;
    const verify = this.cachedToken ? verifyLicenseToken(this.cachedToken) : null;
    this.decision = licenseDecision(verify, Math.floor(Date.now() / 1000));
    return this.decision;
  }

  /**
   * Aplica um token novo recebido do Hub: verifica, persiste e recomputa.
   * Chamado pelo HeartbeatService. Retorna a decisão resultante.
   */
  async applyToken(token: string): Promise<LicenseDecision> {
    const verify = verifyLicenseToken(token);
    this.recompute(verify.ok ? token : this.cachedToken);
    this.lastHeartbeatAt = new Date();
    this.lastError = verify.ok ? null : verify.reason;

    await this.persist({
      token: verify.ok ? token : undefined,
      status: verify.ok ? verify.claims.status : undefined,
      expiresAt: verify.ok ? new Date(verify.claims.exp * 1000) : undefined,
    });
    return this.decision!;
  }

  /** Registra falha de heartbeat (rede/Hub fora) sem mexer no token vigente. */
  async recordHeartbeatError(reason: string): Promise<void> {
    this.lastHeartbeatAt = new Date();
    this.lastError = reason;
    await this.persist({});
    // Não muda a decisão: o token vigente continua valendo até expirar (TTL).
  }

  private async persist(data: {
    token?: string;
    status?: string;
    expiresAt?: Date;
  }): Promise<void> {
    const common = {
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastError: this.lastError,
      ...(data.token !== undefined ? { token: data.token } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
    };
    await this.prisma.licenseState.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID, ...common },
      update: common,
    });
  }

  /**
   * Módulos do ecossistema habilitados nesta instalação, derivados do token
   * vigente. FAIL-OPEN: licenciamento desligado ⇒ catálogo inteiro. Token sem o
   * claim `modules` (instância legada) ⇒ catálogo inteiro. Usado pelo
   * ModuleEntitlementGuard.
   */
  entitledModules(): ModuleCode[] {
    if (!this.isEnabled()) return resolveEntitledModules(null);
    const verify = this.cachedToken ? verifyLicenseToken(this.cachedToken) : null;
    return resolveEntitledModules(verify?.ok ? verify.claims : null);
  }

  /** Snapshot pro endpoint GET /v1/license/status e pro front. */
  status(): LicenseStatusResponse {
    if (!this.isEnabled()) {
      return {
        enabled: false,
        effect: 'DISABLED',
        status: 'NONE',
        expiresAt: null,
        lastHeartbeatAt: null,
        lastError: null,
        entitledModules: this.entitledModules(),
      };
    }
    const d = this.currentDecision();
    return {
      enabled: true,
      effect: d?.effect ?? 'BLOCK_UI',
      status: d?.status ?? 'NONE',
      expiresAt: d?.expiresAt ? new Date(d.expiresAt * 1000).toISOString() : null,
      lastHeartbeatAt: this.lastHeartbeatAt?.toISOString() ?? null,
      lastError: this.lastError,
      entitledModules: this.entitledModules(),
    };
  }
}
