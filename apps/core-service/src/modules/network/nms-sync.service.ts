import { Injectable, Logger } from '@nestjs/common';
import { loadConfig } from '@netx/config';
import jwt from 'jsonwebtoken';

import { PrismaService } from '../prisma/prisma.service';

/**
 * NmsSyncService — propaga equipamento da Planta de rede para o NMS.
 *
 * POR QUE HTTP E NÃO FK: os bancos são separados por decisão de arquitetura —
 * o NMS roda TimescaleDB próprio pras séries temporais (8 hypertables em
 * metrics.*) e o Core é Postgres puro, sem a extensão sequer disponível.
 * Correlação por `device.core_equipment_id`, que é estável (o IP de gerência
 * muda; o id do equipamento não).
 *
 * POR QUE NÃO O EVENT BUS: ele existe (`modules/events`) mas está desligado nas
 * duas pontas, sem outbox transacional, sem retry e sem DLQ. Um
 * `device.registered` perdido significaria equipamento invisível no
 * monitoramento — exatamente a divergência silenciosa que este módulo existe
 * pra eliminar. HTTP síncrono falha na cara do operador; e o que escapar é
 * curado por `reconcile()`.
 *
 * POLÍTICA DE FALHA: sync falho NÃO bloqueia o cadastro (mesma política do
 * RadiusNasSyncService — o equipamento existir no NetX é mais importante que
 * ele estar no NMS). A falha fica registrada em `nmsSyncError`, visível na UI,
 * e o operador pode forçar novo envio.
 */

/** Vendors que o NMS sabe operar (drivers em device-gateway/drivers). */
const VENDOR_MAP: Record<string, 'juniper' | 'mikrotik' | 'cisco_iosxe'> = {
  MIKROTIK: 'mikrotik',
  JUNIPER: 'juniper',
  CISCO: 'cisco_iosxe',
};

/** Tipos que fazem sentido monitorar (CPE e OLT têm caminhos próprios). */
const SYNCABLE_TYPES = new Set(['ROUTER', 'SWITCH', 'BNG']);

export interface NmsSyncOutcome {
  ok: boolean;
  deviceId?: string;
  error?: string;
  skipped?: string;
}

@Injectable()
export class NmsSyncService {
  private readonly logger = new Logger(NmsSyncService.name);
  private readonly baseUrl: string;

  constructor(private readonly prisma: PrismaService) {
    const { nmsService } = loadConfig();
    this.baseUrl = `http://${nmsService.host}:${nmsService.port}`;
  }

  /**
   * Token de SERVIÇO pro NMS. A ponte SSO já existe: o NMS valida tokens
   * assinados com o JWT_ACCESS_SECRET do Core (issuer/audience conferidos) e
   * mapeia `perms` pro RBAC dele — `nms.admin` vira role admin, necessária pra
   * criar device.
   *
   * Não reusamos o token do operador de propósito: quem cadastra equipamento
   * tem `network.write`, que não implica permissão no NMS. Um sync que só
   * funciona pra alguns operadores seria pior que nenhum.
   */
  private serviceToken(): string {
    const cfg = loadConfig();
    // issuer/audience são os mesmos defaults de packages/auth/src/jwt.ts, que
    // é o que o NMS confere (CORE_JWT_ISSUER=netx, CORE_JWT_AUDIENCE=netx-api).
    return jwt.sign(
      { sub: 'netx-core-sync', perms: ['nms.admin'], roles: [] },
      cfg.jwt.accessSecret,
      {
        issuer: 'netx',
        audience: 'netx-api',
        algorithm: 'HS256',
        expiresIn: '2m', // vida curta: só atravessa a chamada
      },
    );
  }

  private async call(
    method: 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${this.serviceToken()}`,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 200);
      throw new Error(
        resp.status === 401
          ? 'NMS recusou o token de serviço (CORE_JWT_SECRET diferente do JWT_ACCESS_SECRET?)'
          : `NMS ${resp.status}: ${text}`,
      );
    }
    return resp.status === 204 ? null : await resp.json();
  }

  /** Motivo pelo qual este equipamento não vai pro NMS, ou null se vai. */
  private skipReason(eq: {
    type: string;
    vendor: string;
    isActive: boolean;
    deletedAt: Date | null;
  }): string | null {
    if (eq.deletedAt) return 'equipamento excluído';
    if (!eq.isActive) return 'equipamento inativo';
    if (!SYNCABLE_TYPES.has(eq.type)) return `tipo ${eq.type} não é monitorável`;
    if (!VENDOR_MAP[eq.vendor]) {
      return `NMS não tem driver para ${eq.vendor}`;
    }
    return null;
  }

  /**
   * Reflete o estado atual do equipamento no NMS. Idempotente — pode ser
   * chamado em toda criação/edição e em reconciliação.
   *
   * Nunca lança: devolve o resultado e grava o erro no próprio equipamento.
   */
  async sync(tenantId: string, equipmentId: string): Promise<NmsSyncOutcome> {
    const eq = await this.prisma.networkEquipment.findFirst({
      where: { id: equipmentId, tenantId },
      include: { pop: { select: { name: true } } },
    });
    if (!eq) return { ok: false, error: 'equipamento não encontrado' };

    // Desligado (ou não elegível) e já espelhado → desvincula lá.
    const reason = eq.nmsMonitored ? this.skipReason(eq) : 'monitoramento desligado';
    if (reason) {
      if (eq.nmsDeviceId) await this.detach(tenantId, eq.id);
      return { ok: true, skipped: reason };
    }

    try {
      const device = (await this.call('PUT', '/devices/from-core', {
        coreEquipmentId: eq.id,
        hostname: eq.hostname?.trim() || eq.name,
        mgmtIp: eq.ipAddress,
        vendor: VENDOR_MAP[eq.vendor],
        // `site` do NMS é texto livre — o nome do POP é o que o operador
        // reconhece na tela dele.
        ...(eq.pop?.name ? { site: eq.pop.name } : {}),
      })) as { id: string };

      await this.prisma.networkEquipment.update({
        where: { id: eq.id },
        data: { nmsDeviceId: device.id, nmsSyncedAt: new Date(), nmsSyncError: null },
      });
      return { ok: true, deviceId: device.id };
    } catch (err) {
      const msg = (err as Error).message.slice(0, 500);
      this.logger.warn(`[nms-sync] equipamento=${eq.id}: ${msg}`);
      await this.prisma.networkEquipment.update({
        where: { id: eq.id },
        data: { nmsSyncError: msg },
      });
      return { ok: false, error: msg };
    }
  }

  /** Solta o vínculo no NMS (o device continua lá, com histórico e séries). */
  async detach(tenantId: string, equipmentId: string): Promise<NmsSyncOutcome> {
    try {
      await this.call('DELETE', `/devices/from-core/${equipmentId}`);
      await this.prisma.networkEquipment.updateMany({
        where: { id: equipmentId, tenantId },
        data: { nmsDeviceId: null, nmsSyncedAt: new Date(), nmsSyncError: null },
      });
      return { ok: true };
    } catch (err) {
      const msg = (err as Error).message.slice(0, 500);
      this.logger.warn(`[nms-sync] detach equipamento=${equipmentId}: ${msg}`);
      await this.prisma.networkEquipment.updateMany({
        where: { id: equipmentId, tenantId },
        data: { nmsSyncError: msg },
      });
      return { ok: false, error: msg };
    }
  }

  /**
   * Reconciliação: reenvia todos os equipamentos marcados. É a rede de
   * segurança do HTTP síncrono — cura o que falhou enquanto o NMS estava fora
   * do ar, sem depender de fila.
   */
  async reconcile(tenantId: string): Promise<{ synced: number; failed: number; total: number }> {
    const rows = await this.prisma.networkEquipment.findMany({
      where: { tenantId, nmsMonitored: true, deletedAt: null },
      select: { id: true },
    });
    let synced = 0;
    let failed = 0;
    for (const r of rows) {
      const out = await this.sync(tenantId, r.id);
      if (out.ok) synced++;
      else failed++;
    }
    return { synced, failed, total: rows.length };
  }

  /** Dispara sem bloquear o request — usado nos hooks de create/update. */
  fireAndForget(tenantId: string, equipmentId: string): void {
    void this.sync(tenantId, equipmentId).catch((e) =>
      this.logger.error(`[nms-sync] falha inesperada: ${(e as Error).message}`),
    );
  }
}
