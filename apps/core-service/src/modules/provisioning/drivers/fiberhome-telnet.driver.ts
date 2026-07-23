/**
 * FiberhomeTelnetDriver — driver DIRECT para OLTs Fiberhome AN5516/AN5116 via
 * TELNET (a família não expõe SSH utilizável).
 *
 * Foco atual: DESCOBERTA de inventário (`listOnts`) + `testConnection`, que é o
 * que habilita o NetX a ser integrador técnico (varrer a planta GPON e casar
 * com o ERP por MAC). Provisionamento (authorize/deauthorize) ainda não é
 * suportado por este driver — retorna erro explícito, não finge sucesso.
 *
 * Comando de listagem (validado na OLT-CPM1 da Zux):
 *   cd onu → show authorization slot all pon all
 * Formato da linha (colunas separadas por espaço):
 *   <slot> <pon> <onu> <model> <auth> <?> <state> <phy_id/serial>
 *   ex.: "2    16  1   HG260          A  1   up  HWTC24680caa"
 * O phy_id é o SN GPON; o prefixo denota o vendor da ONU (HWTC=Huawei,
 * PRKS/MKPG=Parks, DACM=Datacom).
 *
 * Casamento com o ERP: a serial (phy_id) é a CHAVE. O Hubsoft expõe a serial da
 * ONU no serviço (campo `phy_addr`), então casa-se serial↔serial em memória —
 * não dependemos do MAC. (O `show mac-address port 1/s/p` desta OLT retorna a
 * coluna ONU vazia, logo não atribui MAC↔ONU de forma confiável; o MAC fica
 * como enriquecimento best-effort opcional, desligado por padrão.)
 */
import { Injectable, Logger } from '@nestjs/common';

import {
  runDriverCall,
  type AuthorizeOntInput,
  type AuthorizedOntResult,
  type DiscoveredOntRaw,
  type OltConnectionContext,
  type OltDriver,
  type OltDriverResult,
  type OntStatusResult,
} from './olt-driver.interface';
import { FiberhomeTelnetClient } from './fiberhome-telnet.client';

@Injectable()
export class FiberhomeTelnetDriver implements OltDriver {
  readonly name = 'fiberhome-telnet';
  private readonly logger = new Logger(FiberhomeTelnetDriver.name);

  private makeClient(ctx: OltConnectionContext): FiberhomeTelnetClient {
    if (!ctx.managementIp) throw new Error('OLT sem management IP');
    if (!ctx.sshUser || !ctx.sshPassword) throw new Error('OLT sem credenciais');
    return new FiberhomeTelnetClient({
      host: ctx.managementIp,
      // A OLT usa telnet/23; sshPort do cadastro é ignorado aqui (é uma OLT
      // telnet-only). Mantemos 23 fixo.
      port: 23,
      username: ctx.sshUser,
      password: ctx.sshPassword,
      // Na AN5516 a senha de enable costuma ser a mesma do login; se houver
      // enableSecret cadastrado, usa-o.
      enableSecret: ctx.enableSecret ?? ctx.sshPassword,
    });
  }

  async testConnection(ctx: OltConnectionContext): Promise<OltDriverResult<{ message: string }>> {
    return runDriverCall(async () => {
      const cli = this.makeClient(ctx);
      try {
        await cli.connect();
        // `showcard` é leitura barata e confirma que estamos em modo Admin#.
        const out = await cli.exec('showcard', 15_000);
        const gpon = (out.match(/HU1A/g) || []).length;
        return { message: `Conectado (telnet). Placas GPON (HU1A) detectadas: ${gpon}.` };
      } finally {
        await cli.close();
      }
    });
  }

  async listOnts(
    ctx: OltConnectionContext,
    opts?: {
      onProgress?: (batch: DiscoveredOntRaw[], meta: { slot: number; pon: number }) => Promise<void>;
      collectMac?: boolean;
    },
  ): Promise<OltDriverResult<{ onts: DiscoveredOntRaw[] }>> {
    // MAC desligado por padrão: nesta OLT o `show mac-address` não atribui
    // MAC↔ONU (coluna ONU vazia). O casamento com o ERP é por SERIAL (phy_id).
    const collectMac = opts?.collectMac ?? false;
    return runDriverCall(async () => {
      const cli = this.makeClient(ctx);
      try {
        await cli.connect();
        await cli.exec('cd onu', 8_000);

        // Varredura em uma tacada: `slot all pon all`. A saída já traz todas as
        // ONUs autorizadas de todas as placas GPON. Parseamos linha a linha.
        const raw = await cli.exec('show authorization slot all pon all', 120_000);
        const onts = this.parseAuthorizationTable(raw);

        // Enriquecimento de MAC: um comando por (slot,pon) distinto — GENTIL,
        // com pausa entre PONs. Casa MAC↔ONU pela coordenada quando a OLT
        // reporta a coluna ONU; senão deixa o MAC no nível da PON (a camada de
        // matching decide). Aqui, por segurança, só anexamos MAC quando a tabela
        // MAC identifica a ONU sem ambiguidade.
        if (collectMac) {
          const pons = [...new Set(onts.map((o) => `${o.slot}/${o.pon}`))];
          for (const key of pons) {
            const [slot, pon] = key.split('/').map(Number);
            try {
              const macOut = await cli.exec(`show mac-address port 1/${slot}/${pon}`, 20_000);
              this.attachMacs(onts, slot, pon, macOut);
            } catch (e) {
              this.logger.warn(`MAC scan falhou em ${key}: ${(e as Error).message}`);
            }
            if (opts?.onProgress) {
              const batch = onts.filter((o) => o.slot === slot && o.pon === pon);
              await opts.onProgress(batch, { slot, pon });
            }
            await this.sleep(600); // gentileza com a OLT de produção
          }
        } else if (opts?.onProgress) {
          // Sem MAC: reporta por PON mesmo assim.
          const pons = [...new Set(onts.map((o) => `${o.slot}/${o.pon}`))];
          for (const key of pons) {
            const [slot, pon] = key.split('/').map(Number);
            await opts.onProgress(onts.filter((o) => o.slot === slot && o.pon === pon), { slot, pon });
          }
        }

        return { onts };
      } finally {
        await cli.close();
      }
    });
  }

  /**
   * Parseia a tabela do `show authorization`. Cada linha de dado tem a forma:
   *   <slot> <pon> <onu> <model> <auth> <num> <state> <serial>
   * Ignora cabeçalhos, banner, "Command execute…" e linhas que não casam.
   */
  private parseAuthorizationTable(raw: string): DiscoveredOntRaw[] {
    const onts: DiscoveredOntRaw[] = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      // slot pon onu model auth ? state serial
      const m = t.match(
        /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+([A-Za-z0-9._-]{6,})\s*$/,
      );
      if (!m) continue;
      const [, slot, pon, onu, model, , , state, serial] = m;
      onts.push({
        serial: serial.trim(),
        slot: Number(slot),
        pon: Number(pon),
        onuIndex: Number(onu),
        model: model || null,
        onuState: state || null,
        macAddress: null,
        vlan: null,
      });
    }
    return onts;
  }

  /**
   * Anexa MACs às ONUs de uma PON a partir da MAC forwarding table.
   * A tabela: `INDEX MAC PORT ONU SVLAN CVLAN UVLAN`. Só usamos entradas em que
   * a coluna ONU é numérica (identifica a ONU sem ambiguidade); as demais (ONU
   * vazio "-" / MACs de infra) são ignoradas para não casar cliente errado.
   */
  private attachMacs(onts: DiscoveredOntRaw[], slot: number, pon: number, macOut: string): void {
    for (const line of macOut.split('\n')) {
      const t = line.trim();
      // INDEX  MAC(xx-xx-..)  PORT(1/ss/pp)  ONU  SVLAN CVLAN UVLAN
      const m = t.match(
        /^\d+\s+([0-9A-Fa-f]{2}(?:[-:][0-9A-Fa-f]{2}){5})\s+\S+\s+(\d+)\s+(\d+)?/,
      );
      if (!m) continue;
      const mac = this.canonicalMac(m[1]);
      const onuIndex = Number(m[2]);
      const vlan = m[3] ? Number(m[3]) : null;
      const target = onts.find((o) => o.slot === slot && o.pon === pon && o.onuIndex === onuIndex);
      if (target && mac) {
        target.macAddress = mac;
        if (vlan && !target.vlan) target.vlan = vlan;
      }
    }
  }

  private canonicalMac(v: string): string | null {
    const hex = v.replace(/[^0-9a-fA-F]/g, '');
    if (hex.length !== 12) return null;
    return (hex.match(/.{2}/g) as string[]).join(':').toUpperCase();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  // --- Provisionamento: não suportado neste driver (só descoberta por ora) ---
  async authorizeOnt(
    _ctx: OltConnectionContext,
    _input: AuthorizeOntInput,
  ): Promise<OltDriverResult<AuthorizedOntResult>> {
    return { success: false, error: 'FiberhomeTelnetDriver ainda não provisiona (só descobre).', durationMs: 0 };
  }

  async deauthorizeOnt(
    _ctx: OltConnectionContext,
    _snGpon: string,
  ): Promise<OltDriverResult<{ message: string }>> {
    return { success: false, error: 'FiberhomeTelnetDriver ainda não desprovisiona.', durationMs: 0 };
  }

  async getOntStatus(
    _ctx: OltConnectionContext,
    _snGpon: string,
  ): Promise<OltDriverResult<OntStatusResult>> {
    return { success: false, error: 'FiberhomeTelnetDriver ainda não consulta status por ONU.', durationMs: 0 };
  }
}
