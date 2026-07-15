import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { DevicesService } from '../devices/devices.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { EventsService } from '../metrics/events.service.js';
import { BackupService } from '../backup/backup.service.js';
import { LlmService } from './llm.service.js';
import { bps } from './format.js';

@Injectable()
export class CopilotService {
  constructor(
    private readonly devices: DevicesService,
    private readonly metrics: MetricsService,
    private readonly events: EventsService,
    private readonly backup: BackupService,
    private readonly audit: AuditService,
    private readonly llm: LlmService,
  ) {}

  /** Responde uma pergunta ancorada nas métricas/eventos/config já coletados do device. */
  async ask(deviceId: string, question: string, actor: string, authToken?: string) {
    const device = await this.devices.findOne(deviceId);
    const evidence = await this.gatherEvidence(deviceId, device.hostname, device.model);
    const answer = await this.llm.copilot(evidence, question, authToken);
    await this.audit.record({
      actor,
      deviceId,
      action: 'device.copilot',
      command: question.slice(0, 500),
      result: 'ok',
    });
    return { deviceId, question, answer };
  }

  /** Monta um dossiê compacto e factual do device para ancorar a resposta. */
  private async gatherEvidence(
    deviceId: string,
    hostname: string,
    model: string | null,
  ): Promise<string> {
    const [system, optical, rates, events, snaps] = await Promise.all([
      this.metrics.system(deviceId).catch(() => []),
      this.metrics.optical(deviceId).catch(() => []),
      this.metrics.interfaceRates(deviceId).catch(() => []),
      this.events.listForDevice(deviceId).catch(() => []),
      this.backup.listSnapshots(deviceId).catch(() => []),
    ]);

    const lines: string[] = [`Device: ${hostname}${model ? ` (${model})` : ''}`];

    if (system.length) {
      lines.push('\n[Saúde do sistema]');
      for (const s of system.filter((x) => (x.tempC ?? 0) > 0).slice(0, 12)) {
        lines.push(`- ${s.component}: ${s.tempC}°C, CPU ${s.cpuPct ?? '?'}%`);
      }
    }
    if (optical.length) {
      lines.push('\n[Óptica]');
      for (const o of optical) {
        lines.push(`- ${o.ifName}: RX ${o.rxDbm}dBm, TX ${o.txDbm}dBm, ${o.moduleTempC}°C`);
      }
    }
    const active = rates
      .filter((r) => (r.inBps ?? 0) > 0 || (r.outBps ?? 0) > 0 || (r.inErrors ?? 0) > 0)
      .sort((a, b) => Number(b.inErrors ?? 0) - Number(a.inErrors ?? 0))
      .slice(0, 15);
    if (active.length) {
      lines.push('\n[Interfaces ativas]');
      for (const r of active) {
        lines.push(
          `- ${r.ifName}: ↓${bps(r.inBps)} ↑${bps(r.outBps)}, erros in=${r.inErrors ?? 0} out=${r.outErrors ?? 0}, oper=${r.operStatus === 1 ? 'up' : r.operStatus === 2 ? 'down' : '?'}`,
        );
      }
    }
    if (events.length) {
      lines.push('\n[Eventos recentes]');
      for (const e of events.slice(0, 15)) {
        lines.push(
          `- ${e.ts.toISOString?.() ?? e.ts} [${e.severity}] ${e.type}: ${e.message ?? ''}`,
        );
      }
    }
    if (snaps.length) {
      const s = snaps[0]!;
      lines.push(
        `\n[Config] último backup ${s.capturedAt.toISOString?.() ?? s.capturedAt} (${s.gitHash.slice(0, 8)}), mudança: ${s.diffSummary ?? '—'}`,
      );
    }
    return lines.join('\n');
  }
}
