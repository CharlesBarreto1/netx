import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DevicesService } from '../devices/devices.service.js';

export interface InterfaceRate {
  ifName: string;
  inBps: number | null;
  outBps: number | null;
  inErrors: number | null;
  outErrors: number | null;
  operStatus: number | null;
}
export interface OpticalReading {
  ifName: string;
  rxDbm: number | null;
  txDbm: number | null;
  moduleTempC: number | null;
}
export interface SystemReading {
  component: string;
  tempC: number | null;
  cpuPct: number | null;
}

// Sensores ópticos da CISCO-ENTITY-SENSOR-MIB: o IOS-XE escreve o papel do sensor de
// duas formas conforme a plataforma — "Rx/Tx Power" (ASR1001-X) e "Receive/Transmit
// Power" (Catalyst/Nexus). Casar só uma delas deixa a aba de óptica VAZIA sem erro nenhum.
const RX_POWER_RE = /\b(?:rx|receive)\s+power/i;
const TX_POWER_RE = /\b(?:tx|transmit)\s+power/i;
/** Sufixo que identifica o PAPEL do sensor — removido para sobrar o nome da porta. */
const SENSOR_ROLE_SUFFIX_RE =
  /\s*(?:(?:rx|tx|receive|transmit)\s+power|temperature)\s+sensor\s*$/i;

@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
  ) {}

  /**
   * As tabelas de `metrics.*` são criadas pelo TELEGRAF na primeira escrita — não por
   * migration. Logo, device recém-cadastrado (ou vendor cujo perfil nunca coletou) não tem
   * tabela nenhuma, e a query estoura `42P01 relation does not exist` → 500 na tela.
   * "Ainda não coletou" é estado normal, não erro: quem não existe devolve vazio.
   */
  private async metricsTableExists(table: string): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<{ existe: boolean }[]>(
      `SELECT to_regclass($1) IS NOT NULL AS existe`,
      `metrics.${table}`,
    );
    return rows[0]?.existe ?? false;
  }

  /** Taxa atual por interface (bps), calculada a partir das duas últimas amostras de contadores. */
  async interfaceRates(deviceId: string): Promise<InterfaceRate[]> {
    await this.devices.findOne(deviceId);
    if (!(await this.metricsTableExists('snmp_interface'))) return [];
    return this.prisma.$queryRawUnsafe<InterfaceRate[]>(
      `WITH recent AS (
         SELECT "ifName", time, "ifHCInOctets", "ifHCOutOctets", "ifInErrors", "ifOutErrors",
                "ifOperStatus",
                lag("ifHCInOctets") OVER w AS prev_in,
                lag("ifHCOutOctets") OVER w AS prev_out,
                lag(time) OVER w AS prev_time
         FROM metrics.snmp_interface
         WHERE device_id = $1 AND time > now() - interval '60 minutes'
         WINDOW w AS (PARTITION BY "ifName" ORDER BY time)
       )
       SELECT DISTINCT ON ("ifName")
         "ifName",
         (CASE WHEN prev_time IS NOT NULL AND "ifHCInOctets" >= prev_in
              THEN ("ifHCInOctets" - prev_in) * 8.0 / NULLIF(extract(epoch FROM (time - prev_time)),0)
         END)::float8 AS "inBps",
         (CASE WHEN prev_time IS NOT NULL AND "ifHCOutOctets" >= prev_out
              THEN ("ifHCOutOctets" - prev_out) * 8.0 / NULLIF(extract(epoch FROM (time - prev_time)),0)
         END)::float8 AS "outBps",
         "ifInErrors"::float AS "inErrors",
         "ifOutErrors"::float AS "outErrors",
         "ifOperStatus"::int AS "operStatus"
       FROM recent
       ORDER BY "ifName", time DESC`,
      deviceId,
    );
  }

  /**
   * Última leitura óptica por interface (RX/TX em dBm). A measurement difere por vendor
   * (Juniper jnxDom → snmp_optical; Mikrotik mtxrOptical → snmp_mikrotik_optical), mas as
   * colunas e a escala (centésimos de dBm) são as mesmas → mesma query, tabela parametrizada.
   */
  async optical(deviceId: string): Promise<OpticalReading[]> {
    const device = await this.devices.findOne(deviceId);
    // Cisco não cabe na query parametrizada: os valores não vêm por ifIndex nem em
    // centésimos de dBm (ver opticalCisco).
    if (device.vendor === 'cisco_iosxe') return this.opticalCisco(deviceId);
    if (device.vendor === 'parks') return this.opticalParks(deviceId);
    const table = device.vendor === 'mikrotik' ? 'snmp_mikrotik_optical' : 'snmp_optical';
    if (!(await this.metricsTableExists(table))) return [];
    return this.prisma.$queryRawUnsafe<OpticalReading[]>(
      `SELECT DISTINCT ON ("ifName")
         "ifName",
         round("rxLaserPower"/100.0, 2)::float8 AS "rxDbm",
         round("txLaserOutputPower"/100.0, 2)::float8 AS "txDbm",
         "moduleTemperature"::int AS "moduleTempC"
       FROM metrics.${table}
       WHERE device_id = $1 AND time > now() - interval '60 minutes' AND "rxLaserPower" <> 0
       ORDER BY "ifName", time DESC`,
      deviceId,
    );
  }

  /**
   * Óptica Cisco IOS-XE: o DOM não é indexado por ifIndex — vem da CISCO-ENTITY-SENSOR-MIB,
   * um sensor por entidade física. Agrupamos os sensores da MESMA porta (Rx, Tx e temperatura
   * do módulo) tirando o sufixo do papel do rótulo, e pivotamos numa linha só.
   *
   * Escala: o valor real é entSensorValue / 10^entSensorPrecision. A precisão varia por
   * SENSOR, não só por plataforma — num mesmo ASR1001-X medimos 0 (temp do chassi),
   * 1 (dBm óptico) e 3 (temp do módulo). Por isso ela é coletada junto e aplicada aqui, em
   * vez do divisor fixo que os outros vendors usam.
   *
   * Limitação conhecida: o rótulo é o da entidade física ("subslot 0/0 transceiver 0"), não o
   * nome da interface — casar com ifName exigiria o entAliasMappingIdentifier da ENTITY-MIB.
   */
  private async opticalCisco(deviceId: string): Promise<OpticalReading[]> {
    if (!(await this.metricsTableExists('snmp_cisco_sensor'))) return [];
    const rows = await this.prisma.$queryRawUnsafe<
      { name: string; value: number | null; precision: number | null; type: number | null }[]
    >(
      `SELECT DISTINCT ON ("entPhysicalName")
         "entPhysicalName" AS name,
         "entSensorValue"::float8 AS value,
         "entSensorPrecision"::int AS precision,
         "entSensorType"::int AS type
       FROM metrics.snmp_cisco_sensor
       WHERE device_id = $1 AND time > now() - interval '60 minutes'
         AND "entSensorStatus"::int = 1
         AND ("entSensorType"::int = 14
              OR ("entSensorType"::int = 8 AND "entPhysicalName" ILIKE '%transceiver%'))
       ORDER BY "entPhysicalName", time DESC`,
      deviceId,
    );

    const scale = (v: number | null, precision: number | null): number | null =>
      v == null ? null : v / 10 ** (precision ?? 0);

    const byIf = new Map<string, OpticalReading>();
    for (const r of rows) {
      // O rótulo do sensor muda por plataforma: o ASR1001-X escreve
      // "subslot 0/0 transceiver 0 Rx Power Sensor"; Catalyst/Nexus escrevem
      // "Te0/0/2 Transceiver Receive Power Sensor". Tirando o sufixo do papel (e um
      // "Transceiver" solto no fim) sobra a mesma chave para Rx, Tx e temperatura do módulo.
      const ifName = r.name
        .replace(SENSOR_ROLE_SUFFIX_RE, '')
        .replace(/\s*transceiver\s*$/i, '')
        .trim();
      if (!ifName) continue;
      const value = scale(r.value, r.precision);
      const entry = byIf.get(ifName) ?? { ifName, rxDbm: null, txDbm: null, moduleTempC: null };
      const dbm = value == null ? null : Math.round(value * 100) / 100;
      if (RX_POWER_RE.test(r.name)) entry.rxDbm = dbm;
      else if (TX_POWER_RE.test(r.name)) entry.txDbm = dbm;
      else if (r.type === 8) entry.moduleTempC = value == null ? null : Math.round(value);
      byIf.set(ifName, entry);
    }
    // Porta sem módulo aparece com sensores zerados/ausentes — não polui a tela.
    return [...byIf.values()].filter((o) => o.rxDbm != null || o.txDbm != null);
  }

  /**
   * Óptica Parks: a MIB entrega UMA coluna com índice composto `<ifIndex>.<param>`
   * (1=temperatura, 2=bias, 3=Tx, 4=Rx, 5=Vcc) e todos os valores ×1000. Como o `param` é o
   * último componente do índice, o Telegraf não consegue separar as grandezas em campos —
   * ele coleta a coluna inteira com `index_as_tag` e o pivô é feito aqui.
   *
   * O ifIndex é o mesmo da IF-MIB (verificado no equipamento), então `snmp_parks_ifname`
   * resolve o nome da porta.
   */
  private async opticalParks(deviceId: string): Promise<OpticalReading[]> {
    const [temOptica, temNomes] = await Promise.all([
      this.metricsTableExists('snmp_parks_optical'),
      this.metricsTableExists('snmp_parks_ifname'),
    ]);
    if (!temOptica) return [];

    const rows = await this.prisma.$queryRawUnsafe<{ index: string; ddm: number | null }[]>(
      `SELECT DISTINCT ON (index) index, "ddm"::float8 AS ddm
         FROM metrics.snmp_parks_optical
        WHERE device_id = $1 AND time > now() - interval '60 minutes'
        ORDER BY index, time DESC`,
      deviceId,
    );
    const nomes = !temNomes
      ? []
      : await this.prisma.$queryRawUnsafe<{ index: string; ifName: string }[]>(
          `SELECT DISTINCT ON (index) index, "ifName"
             FROM metrics.snmp_parks_ifname
            WHERE device_id = $1 AND time > now() - interval '60 minutes'
            ORDER BY index, time DESC`,
          deviceId,
        );
    const nomePorIfIndex = new Map(nomes.map((n) => [n.index, n.ifName]));

    const byIf = new Map<string, OpticalReading>();
    for (const r of rows) {
      // index = "<ifIndex>.<param>"; sem o param não dá para saber que grandeza é.
      const corte = r.index.lastIndexOf('.');
      if (corte < 0) continue;
      const ifIndex = r.index.slice(0, corte);
      const param = Number(r.index.slice(corte + 1));
      const ifName = nomePorIfIndex.get(ifIndex) ?? ifIndex;
      const valor = r.ddm == null ? null : r.ddm / 1000;
      const entry = byIf.get(ifName) ?? { ifName, rxDbm: null, txDbm: null, moduleTempC: null };
      if (param === 3) entry.txDbm = valor == null ? null : Math.round(valor * 100) / 100;
      else if (param === 4) entry.rxDbm = valor == null ? null : Math.round(valor * 100) / 100;
      else if (param === 1) entry.moduleTempC = valor == null ? null : Math.round(valor);
      byIf.set(ifName, entry);
    }
    // Porta sem módulo não reporta potência — não polui a tela.
    return [...byIf.values()].filter((o) => o.rxDbm != null || o.txDbm != null);
  }

  /**
   * Saúde Parks: temperatura do switch chip + CPU. A MIB só expõe a CPU como SÉRIES de
   * histórico; o perfil do Telegraf pega a amostra mais recente de cada uma das 4 séries
   * (o equipamento tem 4 núcleos) e aqui tiramos a média. Memória vira um componente
   * próprio, calculada de total/livre — a MIB traz o percentual como texto, inútil p/ série.
   */
  private async systemParks(deviceId: string): Promise<SystemReading[]> {
    if (!(await this.metricsTableExists('snmp_parks_health'))) return [];
    const rows = await this.prisma.$queryRawUnsafe<
      {
        chipTempC: number | null;
        memTotalKb: number | null;
        memFreeKb: number | null;
        cpuPct: number | null;
      }[]
    >(
      `SELECT DISTINCT ON (device_id)
         "chipTempC"::float8 AS "chipTempC",
         "memTotalKb"::float8 AS "memTotalKb",
         "memFreeKb"::float8 AS "memFreeKb",
         ((COALESCE("cpu1Pct",0) + COALESCE("cpu2Pct",0)
           + COALESCE("cpu3Pct",0) + COALESCE("cpu4Pct",0)) / 4.0)::float8 AS "cpuPct"
       FROM metrics.snmp_parks_health
       WHERE device_id = $1 AND time > now() - interval '60 minutes'
       ORDER BY device_id, time DESC`,
      deviceId,
    );
    const r = rows[0];
    if (!r) return [];
    const cpuPct = r.cpuPct == null ? null : Math.round(r.cpuPct);
    const out: SystemReading[] = [];
    if (r.chipTempC != null) {
      out.push({ component: 'Switch chip', tempC: Math.round(r.chipTempC), cpuPct });
    }
    if (r.memTotalKb != null && r.memFreeKb != null && r.memTotalKb > 0) {
      const usadaPct = Math.round(((r.memTotalKb - r.memFreeKb) / r.memTotalKb) * 100);
      out.push({ component: `Memória (${usadaPct}% em uso)`, tempC: null, cpuPct });
    }
    if (out.length === 0 && cpuPct != null) out.push({ component: 'CPU', tempC: null, cpuPct });
    return out;
  }

  /** Última leitura de temperatura/CPU por componente, conforme o vendor. */
  async system(deviceId: string): Promise<SystemReading[]> {
    const device = await this.devices.findOne(deviceId);
    if (device.vendor === 'mikrotik') return this.systemMikrotik(deviceId);
    if (device.vendor === 'cisco_iosxe') return this.systemCisco(deviceId);
    if (device.vendor === 'parks') return this.systemParks(deviceId);
    if (!(await this.metricsTableExists('snmp_juniper_operating'))) return [];
    return this.prisma.$queryRawUnsafe<SystemReading[]>(
      `SELECT DISTINCT ON ("jnxOperatingDescr")
         "jnxOperatingDescr" AS component,
         "jnxOperatingTemp"::int AS "tempC",
         "jnxOperatingCPU"::int AS "cpuPct"
       FROM metrics.snmp_juniper_operating
       WHERE device_id = $1 AND time > now() - interval '60 minutes'
       ORDER BY "jnxOperatingDescr", time DESC`,
      deviceId,
    );
  }

  /**
   * Saúde Mikrotik: temp da placa/CPU (mtxrHealth, escalares) + carga média de CPU
   * (HOST-RESOURCES hrProcessorLoad, média dos núcleos). Monta as linhas no TS.
   */
  private async systemMikrotik(deviceId: string): Promise<SystemReading[]> {
    // As duas tabelas entram na MESMA query (subselects), então basta uma faltar para
    // derrubar tudo — checa as duas antes.
    const [temHealth, temCpu] = await Promise.all([
      this.metricsTableExists('snmp_mikrotik_health'),
      this.metricsTableExists('snmp_host_resources'),
    ]);
    if (!temHealth || !temCpu) return [];
    const rows = await this.prisma.$queryRawUnsafe<
      { boardTempC: number | null; cpuTempC: number | null; cpuPct: number | null }[]
    >(
      `SELECT
         (SELECT "boardTempC"::float8 FROM metrics.snmp_mikrotik_health
            WHERE device_id = $1 AND time > now() - interval '60 minutes'
            ORDER BY time DESC LIMIT 1) AS "boardTempC",
         (SELECT "cpuTempC"::float8 FROM metrics.snmp_mikrotik_health
            WHERE device_id = $1 AND time > now() - interval '60 minutes'
            ORDER BY time DESC LIMIT 1) AS "cpuTempC",
         (SELECT round(avg("hrProcessorLoad"))::float8 FROM metrics.snmp_host_resources
            WHERE device_id = $1 AND time > now() - interval '15 minutes') AS "cpuPct"`,
      deviceId,
    );
    const r = rows[0];
    if (!r) return [];
    const out: SystemReading[] = [];
    if (r.boardTempC != null)
      out.push({ component: 'Placa', tempC: r.boardTempC, cpuPct: r.cpuPct });
    if (r.cpuTempC != null) out.push({ component: 'CPU', tempC: r.cpuTempC, cpuPct: r.cpuPct });
    // Sem sensor de temp (alguns RB): ainda mostra a CPU.
    if (out.length === 0 && r.cpuPct != null)
      out.push({ component: 'CPU', tempC: null, cpuPct: r.cpuPct });
    return out;
  }

  /**
   * Saúde Cisco IOS-XE: temperatura dos sensores da CISCO-ENTITY-SENSOR-MIB (tipo 8 =
   * celsius), fora os de transceiver — esses saem em `optical` e encheriam a tela de
   * saúde com uma linha por SFP. CPU vem da CISCO-PROCESS-MIB (média de 5 min).
   */
  private async systemCisco(deviceId: string): Promise<SystemReading[]> {
    // Sensores e CPU são tabelas separadas: cada uma pode existir sem a outra
    // (ex.: SNMP coletando a CPU mas o chassi sem sensor exposto).
    const [temSensor, temCpu] = await Promise.all([
      this.metricsTableExists('snmp_cisco_sensor'),
      this.metricsTableExists('snmp_cisco_cpu'),
    ]);
    if (!temSensor && !temCpu) return [];
    const temps = !temSensor
      ? []
      : await this.prisma.$queryRawUnsafe<
          { component: string; value: number | null; precision: number | null }[]
        >(
      `SELECT DISTINCT ON ("entPhysicalName")
         "entPhysicalName" AS component,
         "entSensorValue"::float8 AS value,
         "entSensorPrecision"::int AS precision
       FROM metrics.snmp_cisco_sensor
       WHERE device_id = $1 AND time > now() - interval '60 minutes'
         AND "entSensorType"::int = 8 AND "entSensorStatus"::int = 1
         AND "entPhysicalName" NOT ILIKE '%Transceiver%'
       ORDER BY "entPhysicalName", time DESC`,
          deviceId,
        );
    const cpuRows = !temCpu
      ? []
      : await this.prisma.$queryRawUnsafe<{ cpuPct: number | null }[]>(
          `SELECT round(avg("cpmCPUTotal5minRev"))::float8 AS "cpuPct"
         FROM metrics.snmp_cisco_cpu
        WHERE device_id = $1 AND time > now() - interval '15 minutes'`,
          deviceId,
        );
    const cpuPct = cpuRows[0]?.cpuPct ?? null;
    const out: SystemReading[] = temps.map((t) => ({
      component: t.component,
      tempC: t.value == null ? null : Math.round(t.value / 10 ** (t.precision ?? 0)),
      cpuPct,
    }));
    // Sem sensor de temperatura legível: ainda mostra a CPU.
    if (out.length === 0 && cpuPct != null) out.push({ component: 'CPU', tempC: null, cpuPct });
    return out;
  }
}
