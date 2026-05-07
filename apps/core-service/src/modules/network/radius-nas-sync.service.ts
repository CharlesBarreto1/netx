/**
 * RadiusNasSyncService — sincroniza Equipamentos type=BNG do NetX com a
 * tabela `radius.nas` do FreeRADIUS.
 *
 * Quando admin cadastra/edita/exclui um BNG, refletimos imediatamente em
 * `radius.nas` pra que o FreeRADIUS reconheça o equipamento como NAS
 * client autorizado a enviar Access-Request / Accounting.
 *
 * Pré-requisito (uma vez por instalação): FreeRADIUS configurado com
 * `read_clients = yes` no módulo SQL — ver runbook.
 *
 * Idempotente: usa `INSERT ... ON CONFLICT (nasname) DO UPDATE`.
 */
import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

export interface NasUpsertInput {
  ipAddress: string;
  shortname: string;
  type: string | null;     // mikrotik / cisco / juniper / other
  secret: string;
  description: string;
}

@Injectable()
export class RadiusNasSyncService {
  private readonly logger = new Logger(RadiusNasSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria ou atualiza linha em radius.nas.
   *
   * `nasname` é o IP do BNG — deve casar com o source IP que o equipamento
   * usa pra enviar pacotes RADIUS (não confundir com hostname).
   */
  async upsert(input: NasUpsertInput): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO radius.nas (nasname, shortname, type, secret, description)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (nasname) DO UPDATE SET
         shortname   = EXCLUDED.shortname,
         type        = EXCLUDED.type,
         secret      = EXCLUDED.secret,
         description = EXCLUDED.description`,
      input.ipAddress,
      input.shortname.slice(0, 32),
      (input.type ?? 'other').slice(0, 30),
      input.secret.slice(0, 60),
      input.description.slice(0, 200),
    );
    this.logger.log(`[RADIUS-NAS] upsert ${input.ipAddress} (${input.shortname})`);
  }

  /** Remove linha em radius.nas pelo IP. */
  async remove(ipAddress: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM radius.nas WHERE nasname = $1`,
      ipAddress,
    );
    this.logger.log(`[RADIUS-NAS] delete ${ipAddress}`);
  }

  /** Lê 1 linha pra debug/UI. */
  async findByIp(ipAddress: string): Promise<{
    id: number;
    nasname: string;
    shortname: string | null;
    type: string;
    secret: string;
  } | null> {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: bigint;
        nasname: string;
        shortname: string | null;
        type: string;
        secret: string;
      }>
    >(
      `SELECT id, nasname, shortname, type, secret FROM radius.nas WHERE nasname = $1`,
      ipAddress,
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: Number(r.id),
      nasname: r.nasname,
      shortname: r.shortname,
      type: r.type,
      secret: r.secret,
    };
  }
}
