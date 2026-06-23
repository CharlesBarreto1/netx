import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditEntry {
  /** Humano que disparou. Ações nunca são atribuídas à IA (AGENTS.md §5). */
  actor: string;
  deviceId?: string;
  action: string;
  command?: string;
  diff?: string;
  result: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Grava um registro imutável de auditoria. */
  async record(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actor: entry.actor,
        deviceId: entry.deviceId ?? null,
        action: entry.action,
        command: entry.command ?? null,
        diff: entry.diff ?? null,
        result: entry.result,
      },
    });
  }
}
