import { randomUUID } from 'node:crypto';
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DeviceJobsService } from '../queue/device-jobs.service.js';
import { DevicesService } from './devices.service.js';
import { SnmpConfigService } from './snmp-config.service.js';
import type { SetCredentialDto } from './credential.dto.js';

export interface CredentialStatus {
  deviceId: string;
  username: string;
  hasPassword: boolean;
  hasSshKey: boolean;
  hasSnmpCommunity: boolean;
}

@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly audit: AuditService,
    private readonly jobs: DeviceJobsService,
    private readonly snmpConfig: SnmpConfigService,
  ) {}

  /**
   * Grava credenciais: manda os segredos ao gateway, que devolve o ciphertext; persiste só
   * o blob cifrado. A chave-mestra nunca passa pela API (ADR 0002 / §4).
   */
  async set(deviceId: string, dto: SetCredentialDto, actor: string): Promise<CredentialStatus> {
    await this.devices.findOne(deviceId); // 404 se não existir

    const result = await this.jobs.enqueueAndWait(
      {
        jobId: randomUUID(),
        deviceId,
        requestedBy: actor,
        requestedAt: new Date().toISOString(),
        kind: 'store-credential',
        params: {
          username: dto.username,
          password: dto.password,
          sshKey: dto.sshKey,
          snmpCommunity: dto.snmpCommunity,
        },
      },
      { removeOnComplete: true }, // não deixar segredo em claro parado no Redis
    );

    if (!result.ok || result.data?.kind !== 'store-credential') {
      throw new InternalServerErrorException(
        `Gateway não cifrou as credenciais: ${result.error ?? 'resposta inesperada'}`,
      );
    }
    const enc = result.data;

    // O DTO aceita segredos PARCIAIS ("informe ao menos um"), então no update só
    // sobrescrevemos o que veio. Antes era `?? null` nos três, e re-salvar apenas
    // usuário+senha apagava a community — o sync seguinte removia o perfil do Telegraf
    // e o device simplesmente parava de ser coletado, sem erro em lugar nenhum.
    // Como o DTO exige string não-vazia, "omitido" nunca significa "limpar".
    const saved = await this.prisma.deviceCredential.upsert({
      where: { deviceId },
      create: {
        deviceId,
        username: enc.username,
        passwordEnc: enc.passwordEnc ?? null,
        sshKeyEnc: enc.sshKeyEnc ?? null,
        snmpCommunityEnc: enc.snmpCommunityEnc ?? null,
      },
      update: {
        username: enc.username,
        ...(enc.passwordEnc ? { passwordEnc: enc.passwordEnc } : {}),
        ...(enc.sshKeyEnc ? { sshKeyEnc: enc.sshKeyEnc } : {}),
        ...(enc.snmpCommunityEnc ? { snmpCommunityEnc: enc.snmpCommunityEnc } : {}),
      },
    });

    await this.audit.record({
      actor,
      deviceId,
      action: 'device.credential.set',
      result: 'ok',
    });

    // Sincroniza a config SNMP do Telegraf (community pode ter mudado). Não bloqueia a resposta.
    await this.snmpConfig.syncDeviceQuietly(deviceId, actor);

    // Reflete o que ficou PERSISTIDO, não só o que veio no request — senão um update
    // parcial reportaria hasSnmpCommunity=false com a community intacta no banco.
    return {
      deviceId,
      username: saved.username,
      hasPassword: Boolean(saved.passwordEnc),
      hasSshKey: Boolean(saved.sshKeyEnc),
      hasSnmpCommunity: Boolean(saved.snmpCommunityEnc),
    };
  }
}
