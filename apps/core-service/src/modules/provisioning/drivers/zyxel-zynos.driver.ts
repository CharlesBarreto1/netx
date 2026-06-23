/**
 * ZyxelZynosDriver — driver DIRECT pra OLTs Zyxel rodando ZyNOS (OLT2406 e
 * família, firmware V4.02(AAVA.x)). Selecionado pelo OltDriverFactory quando
 * Olt.vendor=ZYXEL + Olt.providerMode=DIRECT.
 *
 * FASE 1 (esta): métodos READ-ONLY completos e validados contra hardware real
 *   - testConnection → `show system-information`
 *   - getOntStatus   → `show remote ont sn <sn>` + `show remote ont <aid> ddmi current`
 *
 * FASE 2 (pendente): provisionamento (escrita). authorizeOnt/deauthorizeOnt
 *   vão renderizar o bloco CLI a partir de um OltProvisioningProfile
 *   estruturado (perfis de banda + lista de VLANs com papel + protocolo) e
 *   terminar com `write memory`. Mantidos como stub que retorna erro
 *   operacional pra NÃO tocar em OLT de produção antes de validar em lab.
 *
 * Toda a mecânica de conexão (algoritmos legados, DSR ESC[6n, paginação) está
 * no ZynosSshClient. Aqui só montamos comando + parseamos saída.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Injectable, Logger } from '@nestjs/common';

import {
  type AuthorizeOntInput,
  type AuthorizedOntResult,
  type OltConnectionContext,
  type ManagementBaselineInput,
  type ManagementBaselineResult,
  type OltDriver,
  type OltDriverResult,
  type OntStatusResult,
  type ResolvedProvisioningProfile,
  runDriverCall,
} from './olt-driver.interface';
import { ZynosSshClient } from './zynos-ssh.client';

/** Status reportado na coluna "Actual" do ZyNOS → OntStatus do NetX. */
function mapZynosStatus(raw: string): OntStatusResult['status'] {
  const s = raw.toUpperCase();
  if (s === 'IS') return 'ONLINE';
  if (s === 'UNREG') return 'PENDING_AUTH';
  // OOS-LO (loss of optical) / OOS-LS (loss of signal) → sinal óptico ausente.
  if (s === 'OOS-LO' || s === 'OOS-LS') return 'LOS';
  // OOS-DG (dying gasp) / OOS-PF (power fail) / OOS-CD (config down) → falha.
  if (s === 'OOS-DG' || s === 'OOS-PF' || s === 'OOS-CD') return 'FAULT';
  // Demais OOS-* (SB standby, NR not-reported, TM timing, NP not-present).
  if (s.startsWith('OOS')) return 'OFFLINE';
  return 'OFFLINE';
}

@Injectable()
export class ZyxelZynosDriver implements OltDriver {
  readonly name = 'zyxel-zynos';
  private readonly logger = new Logger(ZyxelZynosDriver.name);

  async testConnection(
    ctx: OltConnectionContext,
  ): Promise<OltDriverResult<{ message: string }>> {
    return runDriverCall(async () => {
      const client = await this.open(ctx);
      try {
        const out = await client.exec('show system-information');
        const model = matchValue(out, /Product Model\s*:\s*(\S+)/);
        const fw = matchValue(out, /Current ZyNOS F\/W Ver\.\s*:\s*(.+)/);
        if (!model) {
          throw new Error(
            'Conectou mas não reconheceu a saída de `show system-information`',
          );
        }
        return {
          message: `ZyNOS OK — modelo ${model}${fw ? `, firmware ${fw.trim()}` : ''}`,
        };
      } finally {
        await client.close();
      }
    });
  }

  async getOntStatus(
    ctx: OltConnectionContext,
    snGpon: string,
  ): Promise<OltDriverResult<OntStatusResult>> {
    return runDriverCall(async () => {
      const client = await this.open(ctx);
      try {
        const sn = sanitizeSn(snGpon);
        const row = await client.exec(`show remote ont sn ${sn}`);

        // ONT não registrada na OLT → ainda pendente de autorização.
        if (/Total:\s*0/.test(row) || !/ont-\d+-\d+-\d+/.test(row)) {
          return { status: 'PENDING_AUTH', lastRxPower: null, lastTxPower: null, raw: row };
        }

        const aid = matchValue(row, /\b(ont-\d+-\d+-\d+)\b/);
        // Status vem da linha "Actual ... <STATUS> |".
        const statusRaw =
          matchValue(row, /Actual\s+\S+\s+\S+\s+(\S+)\s*\|/) ?? 'OOS';
        const status = mapZynosStatus(statusRaw);

        let lastRxPower: number | null = null;
        let lastTxPower: number | null = null;
        if (aid) {
          // DDMI é assíncrono: o prompt volta antes do bloco — espera o "Tx power".
          const ddmi = await client.exec(`show remote ont ${aid} ddmi current`, {
            waitFor: /Tx power\s*\(dbm\)/i,
            settleMs: 300,
            timeoutMs: 15_000,
          });
          lastRxPower = matchNumber(ddmi, /Rx power\s*\(dbm\)\s*:\s*(-?[\d.]+)/i);
          lastTxPower = matchNumber(ddmi, /Tx power\s*\(dbm\)\s*:\s*(-?[\d.]+)/i);
        }

        return { status, lastRxPower, lastTxPower, raw: row };
      } finally {
        await client.close();
      }
    });
  }

  /**
   * Autoriza/provisiona uma ONT. Fluxo (espelha o script manual do operador):
   *   1. idempotência: se o SN já está registrado, retorna a posição atual
   *   2. descobre slot/pon onde a ONT apareceu (`show remote ont unreg`)
   *   3. aloca o próximo ONT-ID livre nessa PON (`show remote ont`)
   *   4. renderiza e envia o bloco `configure → remote ont → remote uniport →
   *      write memory` a partir do template resolvido
   *   5. confirma que a ONT registrou (`show remote ont sn`)
   */
  async authorizeOnt(
    ctx: OltConnectionContext,
    input: AuthorizeOntInput,
  ): Promise<OltDriverResult<AuthorizedOntResult>> {
    return runDriverCall(async () => {
      const profile = input.provisioningProfile;
      if (!profile) {
        throw new Error(
          'Template de provisionamento não resolvido — cadastre um OltProvisioningProfile ' +
            'e vincule à OLT (default) ou ao plano do contrato.',
        );
      }
      validateProfile(profile);
      const sn = sanitizeSn(input.snGpon);

      const client = await this.open(ctx);
      try {
        // 1. Já registrada? (re-execução idempotente)
        const existing = await client.exec(`show remote ont sn ${sn}`);
        const existingAid = matchValue(existing, /\b(ont-\d+-\d+-\d+)\b/);
        if (existingAid && !/Total:\s*0/.test(existing)) {
          const p = parseAid(existingAid);
          this.logger.log(`[zyxel] SN ${sn} já registrado em ${existingAid} — idempotente`);
          return {
            snGpon: sn,
            macAddress: input.macAddress,
            ponFrame: p.pon,
            ponSlot: p.slot,
            ponOnuIndex: p.id,
            providerOntRef: existingAid,
          };
        }

        // 2. Descobre slot/pon via lista de não-registradas
        const unreg = await client.exec('show remote ont unreg');
        const loc = findUnregPon(unreg, sn);
        if (!loc) {
          throw new Error(
            `SN ${sn} não aparece em "show remote ont unreg" — verifique se a ONT ` +
              'está conectada/energizada na PON (ou se já foi provisionada em outra OLT).',
          );
        }

        // 3. Aloca o próximo ONT-ID livre na PON
        const all = await client.exec('show remote ont');
        const ontId = nextFreeOntId(all, loc.slot, loc.pon);
        if (ontId == null) {
          throw new Error(`PON ${loc.slot}/${loc.pon} sem índice de ONT livre (1..128 cheios).`);
        }
        const aid = `ont-${loc.slot}-${loc.pon}-${ontId}`;

        // 4. Renderiza + envia o bloco de provisionamento
        const block = renderAuthorizeBlock(aid, sn, profile);
        this.logger.log(`[zyxel] provisionando ${aid} SN=${sn} (${block.length} linhas)`);
        await client.execSequence(block, { timeoutMs: 30_000 });

        // 5. Confirma registro
        const verify = await client.exec(`show remote ont sn ${sn}`);
        if (/Total:\s*0/.test(verify) || !verify.includes(aid)) {
          throw new Error('Bloco enviado mas a ONT não apareceu registrada na verificação.');
        }

        return {
          snGpon: sn,
          macAddress: input.macAddress,
          ponFrame: loc.pon,
          ponSlot: loc.slot,
          ponOnuIndex: ontId,
          providerOntRef: aid,
        };
      } finally {
        await client.close();
      }
    });
  }

  async deauthorizeOnt(
    ctx: OltConnectionContext,
    snGpon: string,
  ): Promise<OltDriverResult<{ message: string }>> {
    return runDriverCall(async () => {
      const sn = sanitizeSn(snGpon);
      const client = await this.open(ctx);
      try {
        // `no remote ont sn <sn>` remove a ONT (e o uniport filho) por serial.
        await client.execSequence(
          ['configure', `no remote ont sn ${sn}`, 'exit', 'write memory'],
          { timeoutMs: 30_000 },
        );
        return { message: `ONT SN ${sn} desautorizada` };
      } finally {
        await client.close();
      }
    });
  }

  /**
   * Aponta syslog + NTP da OLT pros endpoints do NetX (Fase 3). Idempotente:
   * lê `show timesync` e só reconfigura o NTP se divergir; o syslog é
   * (re)aplicado quando há host configurado. Só dá `write memory` se mudou algo.
   */
  async applyManagementBaseline(
    ctx: OltConnectionContext,
    input: ManagementBaselineInput,
  ): Promise<OltDriverResult<ManagementBaselineResult>> {
    return runDriverCall(async () => {
      const applied: string[] = [];
      const skipped: string[] = [];
      const cmds: string[] = ['configure'];

      // ── Syslog → coletor do NetX ──────────────────────────────────────────
      if (input.syslogHost) {
        const host = sanitizeHost(input.syslogHost);
        const level = clampLevel(input.syslogLevel);
        cmds.push('syslog'); // habilita o syslog remoto
        cmds.push(`syslog server ${host} level ${level}`);
        applied.push(`syslog→${host} (level ${level})`);
      } else {
        skipped.push('syslog (NETX_OLT_SYSLOG_HOST não configurado)');
      }

      // ── NTP / timezone ────────────────────────────────────────────────────
      const client = await this.open(ctx);
      try {
        let current = '';
        if (input.ntpServer || input.timezone) {
          current = await client.exec('show timesync');
        }
        if (input.ntpServer) {
          const ntp = sanitizeHost(input.ntpServer);
          const already =
            new RegExp(`Time Server IP Address\\s*:\\s*${ntp.replace(/\./g, '\\.')}`).test(current) &&
            /Time Sync Mode\s*:\s*NTP/i.test(current);
          if (already) {
            skipped.push(`ntp (já aponta ${ntp})`);
          } else {
            cmds.push(`timesync server ${ntp}`, 'timesync ntp');
            applied.push(`ntp→${ntp}`);
          }
        } else {
          skipped.push('ntp (NETX_OLT_NTP_SERVER não configurado)');
        }
        if (input.timezone) {
          const tz = sanitizeTz(input.timezone);
          if (new RegExp(`Time Zone\\s*:\\s*${tz}`).test(current)) {
            skipped.push(`timezone (já ${tz})`);
          } else {
            cmds.push(`time timezone ${tz}`);
            applied.push(`timezone→${tz}`);
          }
        }

        if (applied.length === 0) {
          return { applied, skipped };
        }
        cmds.push('exit', 'write memory');
        await client.execSequence(cmds, { timeoutMs: 30_000 });
        return { applied, skipped };
      } finally {
        await client.close();
      }
    });
  }

  // ───────────────────────────────────────────────────────────────────────

  private async open(ctx: OltConnectionContext): Promise<ZynosSshClient> {
    if (!ctx.managementIp || !ctx.sshUser || !ctx.sshPassword) {
      throw new Error(
        'OLT Zyxel em DIRECT mode exige managementIp, sshUser e sshPassword',
      );
    }
    const client = new ZynosSshClient();
    await client.connect({
      host: ctx.managementIp,
      port: ctx.sshPort,
      username: ctx.sshUser,
      password: ctx.sshPassword,
    });
    return client;
  }
}

// ── Helpers de provisionamento (Fase 2) ────────────────────────────────────

/** Valida o template antes de gerar comandos (defesa + anti-injeção). */
function validateProfile(p: ResolvedProvisioningProfile): void {
  const name = /^[A-Za-z0-9_.-]{1,64}$/;
  if (!name.test(p.bwUpProfileName) || !name.test(p.bwDownProfileName)) {
    throw new Error('Perfis de banda (US/DS) do template têm nome inválido.');
  }
  if (!name.test(p.ingressProfile)) {
    throw new Error('ingressProfile do template inválido.');
  }
  if (!/^[0-9]+-[0-9]+$/.test(p.uniPort)) {
    throw new Error(`uniPort do template inválido: ${JSON.stringify(p.uniPort)} (esperado "porta-serviço", ex "2-1").`);
  }
  if (!p.vlans.length) throw new Error('Template sem VLANs.');
  for (const v of p.vlans) {
    if (!Number.isInteger(v.vid) || v.vid < 1 || v.vid > 4094) {
      throw new Error(`VLAN inválida no template: ${v.vid}`);
    }
  }
}

/**
 * Renderiza o bloco CLI de autorização a partir do template. Espelha
 * exatamente o script validado do operador (remote ont + remote uniport,
 * 1+ VLANs com txtag, pvid, protocol-based) e fecha com `write memory`.
 */
function renderAuthorizeBlock(
  aid: string,
  sn: string,
  p: ResolvedProvisioningProfile,
): string[] {
  const sp = aid.replace(/^ont-/, ''); // "3-1-1"
  const lines: string[] = [
    'configure',
    `remote ont ${aid}`,
    `sn ${sn}`,
    `password ${p.ontPassword}`,
    `full-bridge ${p.fullBridge ? 'enable' : 'disable'}`,
    'no inactive',
    `bwgroup ${p.bwGroupId} usbwprofname ${p.bwUpProfileName} dsbwprofname ${p.bwDownProfileName}`,
    'exit',
    `remote uniport uniport-${sp}-${p.uniPort}`,
    'no inactive',
    `queue tc ${p.queueTc} priority ${p.queuePriority} weight ${p.queueWeight} ` +
      `usbwprofname ${p.bwUpProfileName} dsbwprofname ${p.bwDownProfileName} ` +
      `dsoption olt bwsharegroupid ${p.bwGroupId}`,
  ];
  for (const v of p.vlans) {
    lines.push(
      `vlan ${v.vid} network ${v.vid} txtag ${v.tagged ? 'tag' : 'untag'} ingprof ${p.ingressProfile}`,
    );
  }
  const pvid = p.vlans.find((v) => v.isPvid);
  if (pvid) lines.push(`pvid ${pvid.vid}`);
  const proto = p.vlans.find((v) => v.isProtocolBased);
  if (proto) lines.push(`protocol-based ${p.serviceProtocol.toLowerCase()} vlan ${proto.vid}`);
  lines.push('exit', 'exit', 'write memory');
  return lines;
}

/** ont-<slot>-<pon>-<id> → números. */
function parseAid(aid: string): { slot: number; pon: number; id: number } {
  const m = aid.match(/ont-(\d+)-(\d+)-(\d+)/);
  if (!m) throw new Error(`AID inesperado: ${aid}`);
  return { slot: Number(m[1]), pon: Number(m[2]), id: Number(m[3]) };
}

/**
 * Acha a PON (slot/port) onde o SN aparece em `show remote ont unreg`.
 * O Pon_AID das não-registradas é `pon-<slot>-<port>`.
 */
function findUnregPon(unreg: string, sn: string): { slot: number; pon: number } | null {
  for (const line of unreg.split('\n')) {
    if (!line.toUpperCase().includes(sn.toUpperCase())) continue;
    const m = line.match(/pon-(\d+)-(\d+)/i);
    if (m) return { slot: Number(m[1]), pon: Number(m[2]) };
  }
  return null;
}

/** Menor índice de ONT livre (1..128) na PON slot/pon, lendo `show remote ont`. */
function nextFreeOntId(allOnts: string, slot: number, pon: number): number | null {
  const used = new Set<number>();
  const re = new RegExp(`ont-${slot}-${pon}-(\\d+)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(allOnts)) !== null) used.add(Number(m[1]));
  for (let i = 1; i <= 128; i++) if (!used.has(i)) return i;
  return null;
}

/** Host/IP pra comando ZyNOS — só dígitos, ponto, hex e ':' (IPv4/IPv6/hostname). */
function sanitizeHost(h: string): string {
  const clean = h.trim();
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(clean)) {
    throw new Error(`Host inválido pra comando ZyNOS: ${JSON.stringify(h)}`);
  }
  return clean;
}

/** Nível de syslog do ZyNOS: 0..7 (default 6 = informational). */
function clampLevel(level: number | undefined): number {
  const n = Number.isFinite(level) ? Math.trunc(level as number) : 6;
  return Math.min(7, Math.max(0, n));
}

/** Timezone offset ZyNOS: [+-]HHMM, ex "-0300". */
function sanitizeTz(tz: string): string {
  const clean = tz.trim();
  if (!/^[+-]?\d{3,4}$/.test(clean)) {
    throw new Error(`Timezone inválida pra ZyNOS (esperado [+-]HHMM): ${JSON.stringify(tz)}`);
  }
  return clean;
}

/** SN GPON: só hex/alfanumérico (o schema já valida; aqui é defesa anti-injeção). */
function sanitizeSn(sn: string): string {
  const clean = sn.trim();
  if (!/^[A-Za-z0-9]{8,32}$/.test(clean)) {
    throw new Error(`SN GPON inválido pra comando ZyNOS: ${JSON.stringify(sn)}`);
  }
  return clean;
}

function matchValue(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[1] : null;
}

function matchNumber(text: string, re: RegExp): number | null {
  const v = matchValue(text, re);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
