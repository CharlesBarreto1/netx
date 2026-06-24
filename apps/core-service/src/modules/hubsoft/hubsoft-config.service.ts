import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  HubsoftConfigResponse,
  HubsoftDiagnosticsResponse,
  HubsoftSyncStats,
  UpsertHubsoftConfigRequest,
} from '@netx/shared';
import type { HubsoftConfig } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

import { HubsoftClientService } from './hubsoft-client.service';
import type { HubsoftCredentials, HubsoftResolvedConfig } from './hubsoft.types';

@Injectable()
export class HubsoftConfigService {
  private readonly logger = new Logger(HubsoftConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly client: HubsoftClientService,
  ) {}

  // ---------------------------------------------------------------------------
  // READ
  // ---------------------------------------------------------------------------
  async get(tenantId: string): Promise<HubsoftConfigResponse> {
    const cfg = await this.findRaw(tenantId);
    return this.toResponse(tenantId, cfg);
  }

  private findRaw(tenantId: string): Promise<HubsoftConfig | null> {
    return this.prisma.hubsoftConfig.findUnique({ where: { tenantId } });
  }

  // ---------------------------------------------------------------------------
  // UPSERT (admin) — segredos write-only
  // ---------------------------------------------------------------------------
  async upsert(
    tenantId: string,
    actorUserId: string,
    input: UpsertHubsoftConfigRequest,
  ): Promise<HubsoftConfigResponse> {
    const existing = await this.findRaw(tenantId);

    // Credenciais: só sobrescreve quando algum campo vem preenchido. Os 4
    // valores são guardados juntos num único blob cifrado.
    let credentialsEnc = existing?.credentialsEnc ?? null;
    let credsChanged = false;
    if (
      input.clientId !== undefined ||
      input.clientSecret !== undefined ||
      input.username !== undefined ||
      input.password !== undefined
    ) {
      const current = this.readCreds(existing);
      const merged: HubsoftCredentials = {
        clientId: (input.clientId ?? current?.clientId ?? '').trim(),
        clientSecret: (input.clientSecret ?? current?.clientSecret ?? '').trim(),
        username: (input.username ?? current?.username ?? '').trim(),
        password: input.password ?? current?.password ?? '',
      };
      if (!merged.clientId || !merged.clientSecret || !merged.username || !merged.password) {
        throw new BadRequestException(
          'clientId, clientSecret, username e password são obrigatórios juntos',
        );
      }
      credentialsEnc = this.crypto.encrypt(JSON.stringify(merged));
      credsChanged = true;
    }

    const host =
      input.host !== undefined ? this.normalizeHost(input.host) : (existing?.host ?? null);

    const data = {
      enabled: input.enabled ?? existing?.enabled ?? false,
      host,
      credentialsEnc,
      autoSync: input.autoSync ?? existing?.autoSync ?? false,
      syncCustomers: input.syncCustomers ?? existing?.syncCustomers ?? true,
      syncFinanceiro: input.syncFinanceiro ?? existing?.syncFinanceiro ?? true,
    } as const;

    const saved = await this.prisma.hubsoftConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });

    if (credsChanged) this.client.clearTokenCache();

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'hubsoft.config.updated',
      resource: 'hubsoft_config',
      resourceId: saved.id,
      metadata: { enabled: saved.enabled, host: saved.host, credsChanged, autoSync: saved.autoSync },
    });

    return this.toResponse(tenantId, saved);
  }

  // ---------------------------------------------------------------------------
  // RESOLVE (segredos decifrados, pronto pro client)
  // ---------------------------------------------------------------------------
  async resolve(tenantId: string): Promise<HubsoftResolvedConfig> {
    const cfg = await this.findRaw(tenantId);
    if (!cfg || !cfg.enabled) {
      throw new BadRequestException('Integração Hubsoft não está habilitada para este provedor');
    }
    if (!cfg.host) throw new BadRequestException('Host do Hubsoft não configurado');
    const creds = this.readCreds(cfg);
    if (!creds) throw new BadRequestException('Credenciais do Hubsoft não configuradas');
    return { host: this.normalizeHost(cfg.host), credentials: creds };
  }

  // ---------------------------------------------------------------------------
  // DIAGNÓSTICO — "Testar conexão" (não exige enabled)
  // ---------------------------------------------------------------------------
  async diagnose(tenantId: string): Promise<HubsoftDiagnosticsResponse> {
    const cfg = await this.findRaw(tenantId);
    if (!cfg) throw new BadRequestException('Configure o Hubsoft antes de diagnosticar');
    if (!cfg.host) throw new BadRequestException('Host do Hubsoft não configurado');
    const creds = this.readCreds(cfg);
    if (!creds) throw new BadRequestException('Credenciais do Hubsoft não configuradas');

    const resolved: HubsoftResolvedConfig = {
      host: this.normalizeHost(cfg.host),
      credentials: creds,
    };
    const probe = await this.client.probeAuth(resolved);

    let hint: string;
    if (probe.ok) hint = 'OAuth password grant VÁLIDO ✅';
    else if (probe.status === 401) hint = 'client_id/secret ou usuário/senha inválidos (401) ❌';
    else if (probe.status === 0) hint = 'host inacessível / falha de conexão ❌';
    else hint = `falhou (${probe.status}) ❌`;

    this.logger.log(`[hubsoft-diagnose] tenant=${tenantId} host=${cfg.host} status=${probe.status}`);

    return { host: cfg.host, ok: probe.ok, status: probe.status, hint, sample: null };
  }

  // ---------------------------------------------------------------------------
  // Telemetria do sync (chamado pelo import/sync service)
  // ---------------------------------------------------------------------------
  async recordSync(
    tenantId: string,
    status: 'OK' | 'PARTIAL' | 'ERROR',
    stats: HubsoftSyncStats | null,
    error: string | null,
  ): Promise<void> {
    await this.prisma.hubsoftConfig.update({
      where: { tenantId },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: status,
        lastSyncStats: stats as unknown as object,
        lastSyncError: error,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  private readCreds(cfg: HubsoftConfig | null): HubsoftCredentials | null {
    if (!cfg?.credentialsEnc) return null;
    try {
      const obj = JSON.parse(this.crypto.decrypt(cfg.credentialsEnc)) as HubsoftCredentials;
      if (obj?.clientId && obj?.clientSecret && obj?.username && obj?.password) return obj;
    } catch (e) {
      this.logger.error(`Falha ao decifrar credenciais Hubsoft do tenant ${cfg.tenantId}: ${String(e)}`);
    }
    return null;
  }

  /** Remove barra(s) final(is) do host. */
  private normalizeHost(host: string): string {
    return host.trim().replace(/\/+$/, '');
  }

  private toResponse(tenantId: string, cfg: HubsoftConfig | null): HubsoftConfigResponse {
    return {
      tenantId,
      enabled: cfg?.enabled ?? false,
      host: cfg?.host ?? null,
      hasCredentials: !!cfg?.credentialsEnc,
      autoSync: cfg?.autoSync ?? false,
      syncCustomers: cfg?.syncCustomers ?? true,
      syncFinanceiro: cfg?.syncFinanceiro ?? true,
      lastSyncAt: cfg?.lastSyncAt?.toISOString() ?? null,
      lastSyncStatus: cfg?.lastSyncStatus ?? null,
      lastSyncError: cfg?.lastSyncError ?? null,
      lastSyncStats: (cfg?.lastSyncStats as unknown as HubsoftConfigResponse['lastSyncStats']) ?? null,
      createdAt: cfg?.createdAt?.toISOString() ?? null,
      updatedAt: cfg?.updatedAt?.toISOString() ?? null,
    };
  }
}
