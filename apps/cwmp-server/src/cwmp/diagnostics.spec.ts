/**
 * extractDiagnostics — cobertura multi-vendor do parser de diagnóstico.
 *
 * Os valores VSOL vêm do dump REAL da bancada (V2802DAC HW V1.3, firmware
 * V2.0.10-200611, jul/2026) — se o teste quebrar, ou o parser regrediu ou o
 * firmware mudou de unidade.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { extractDiagnostics } from './diagnostics';

const VSOL_IFACE = 'InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig';
const PPP = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.2.WANPPPConnection.1';
const WLAN = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration';

describe('extractDiagnostics — VSOL/Realtek (CT-COM)', () => {
  const params: Record<string, string> = {
    [`${VSOL_IFACE}.RXPower`]: '8', // piso do sensor (bancada a -26 dBm real na OLT)
    [`${VSOL_IFACE}.TXPower`]: '19078', // DDM 0.1µW → +2.81 dBm
    [`${VSOL_IFACE}.TransceiverTemperature`]: '4880', // 0.01°C → 48.8°C
    [`${VSOL_IFACE}.SupplyVottage`]: '34798', // 100µV → 3.48V (typo do firmware)
    [`${VSOL_IFACE}.BiasCurrent`]: '5925', // 2µA → 11.85mA
    [`${VSOL_IFACE}.Status`]: 'Up',
    [`${VSOL_IFACE}.Stats.FECError`]: '0',
    [`${VSOL_IFACE}.Stats.HECError`]: '1',
    [`${PPP}.ConnectionStatus`]: 'Connected',
    [`${PPP}.Uptime`]: '363',
    [`${PPP}.Stats.EthernetBytesReceived`]: '31529364',
    [`${PPP}.Stats.EthernetBytesSent`]: '1787226',
    // ⚠️ VSOL tem índices de WLAN INVERTIDOS: 5 = rádio 2.4GHz, 1 = rádio 5GHz
    // (bug de bancada real: SSID "-5G" apareceu na rede 2.4 quando se usava a
    // convenção Huawei).
    [`${WLAN}.5.TotalAssociations`]: '4',
    [`${WLAN}.1.TotalAssociations`]: '0',
    [`${WLAN}.5.Channel`]: '6',
    [`${WLAN}.1.Channel`]: '149',
    'InternetGatewayDevice.DeviceInfo.ProcessStatus.CPUUsage': '7',
    'InternetGatewayDevice.DeviceInfo.MemoryStatus.Total': '180628',
    'InternetGatewayDevice.DeviceInfo.MemoryStatus.Free': '142396',
    [`${WLAN}.5.AssociatedDevice.1.AssociatedDeviceMACAddress`]: 'fe:bd:97:5e:0d:24',
    [`${WLAN}.5.AssociatedDevice.1.AssociatedDeviceIPAddress`]: '192.168.1.33',
  };

  it('converte DDM cru pra unidades humanas (dBm/°C/V/mA)', () => {
    const d = extractDiagnostics(params);
    expect(d.txPower).toBeCloseTo(2.81, 2);
    expect(d.temperature).toBeCloseTo(48.8, 2);
    expect(d.voltage).toBeCloseTo(3.48, 2);
    expect(d.biasCurrent).toBeCloseTo(11.85, 2);
    expect(d.hasOptical).toBe(true);
  });

  it('descarta RX de piso de sensor (<-30 dBm) — UNKNOWN em vez de alarme falso', () => {
    const d = extractDiagnostics(params);
    expect(d.rxPower).toBeNull();
    expect(d.opticalHealth).toBe('UNKNOWN');
  });

  it('aceita RX plausível e classifica saúde', () => {
    const d = extractDiagnostics({ ...params, [`${VSOL_IFACE}.RXPower`]: '160' }); // 16µW
    expect(d.rxPower).toBeCloseTo(-17.96, 2);
    expect(d.opticalHealth).toBe('OK');
  });

  it('Inform de notificação passiva com SÓ RXPower ainda entra no branch VSOL', () => {
    // "4 VALUE CHANGE" traz apenas os params armados que mudaram — sem TXPower.
    const d = extractDiagnostics({ [`${VSOL_IFACE}.RXPower`]: '160' });
    expect(d.rxPower).toBeCloseTo(-17.96, 2);
    expect(d.hasOptical).toBe(true);
  });

  it('lê status/FEC/HEC pelos paths CT-COM', () => {
    const d = extractDiagnostics(params);
    expect(d.gponStatus).toBe('Up');
    expect(d.fecErrors).toBe(0);
    expect(d.hecErrors).toBe(1);
  });

  it('PPP e contadores WAN vêm dos paths padrão (mesma WAN 2 do Huawei)', () => {
    const d = extractDiagnostics(params);
    expect(d.pppStatus).toBe('Connected');
    expect(d.wanUptime).toBe(363);
    expect(d.wanRxBytes).toBe(31529364);
    expect(d.wanTxBytes).toBe(1787226);
  });

  it('deriva % de memória de MemoryStatus e enumera clientes Wi-Fi por MAC', () => {
    const d = extractDiagnostics(params);
    expect(d.memUsage).toBe(21);
    expect(d.cpuUsage).toBe(7);
    expect(d.wifiClients).toHaveLength(1);
    expect(d.wifiClients[0].mac).toBe('fe:bd:97:5e:0d:24');
    // Esse data model não expõe RSSI por cliente — fica null, sem quebrar.
    expect(d.wifiClients[0].rssi).toBeNull();
  });

  it('mapeia as bandas com os índices INVERTIDOS da VSOL (WLAN 5=2.4G, 1=5G)', () => {
    const d = extractDiagnostics(params);
    expect(d.wifiClients24).toBe(4); // lido de WLANConfiguration.5
    expect(d.wifiClients5).toBe(0); // lido de WLANConfiguration.1
    expect(d.wifiChannel24).toBe(6);
    expect(d.wifiChannel5).toBe(149);
    // Cliente associado na WLAN 5 é banda 2.4GHz (na Huawei seria 5GHz).
    expect(d.wifiClients[0].band).toBe('2.4GHz');
  });
});

describe('extractDiagnostics — ZTE F670L (X_ZTE-COM)', () => {
  const ZTE_IFACE = 'InternetGatewayDevice.WANDevice.1.X_ZTE-COM_WANPONInterfaceConfig';
  const ZTE_PPP = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';

  // Fixture com valores do WALK REAL do piloto PY (V9.0.10P1N12A, jul/2026):
  // dBm/°C/mA direto e SupplyVoltage em mV. Se quebrar, ou o parser regrediu
  // ou o firmware mudou de unidade.
  const params: Record<string, string> = {
    [`${ZTE_IFACE}.RXPower`]: '-24.2',
    [`${ZTE_IFACE}.TXPower`]: '2.53',
    [`${ZTE_IFACE}.TransceiverTemperature`]: '36.35',
    [`${ZTE_IFACE}.SupplyVoltage`]: '3268', // mV
    [`${ZTE_IFACE}.BiasCurrent`]: '12.9',
    [`${ZTE_IFACE}.Status`]: 'Up',
    [`${ZTE_IFACE}.Stats.FECError`]: '0',
    [`${ZTE_IFACE}.Stats.HECError`]: '0',
    [`${ZTE_PPP}.ConnectionStatus`]: 'Connected',
    [`${ZTE_PPP}.Uptime`]: '4517',
    [`${ZTE_PPP}.Stats.EthernetBytesReceived`]: '260556615',
    [`${ZTE_PPP}.Stats.EthernetBytesSent`]: '161642950',
    // Convenção ZTE (igual Huawei): WLAN 1 = 2.4GHz, WLAN 5 = 5GHz.
    [`${WLAN}.1.TotalAssociations`]: '8',
    [`${WLAN}.5.TotalAssociations`]: '8',
    [`${WLAN}.1.Channel`]: '7',
    [`${WLAN}.5.Channel`]: '44',
    // Campos reais por cliente — o parser casa MAC/RSSI/taxas por substring.
    [`${WLAN}.5.AssociatedDevice.1.AssociatedDeviceMACAddress`]: 'c2:e7:a4:42:55:f2',
    [`${WLAN}.5.AssociatedDevice.1.AssociatedDeviceRssi`]: '-54',
    [`${WLAN}.5.AssociatedDevice.1.X_ZTE-COM_RXRate`]: '65000',
    // Recursos vendor: CPU por core com "%", memória com "%".
    'InternetGatewayDevice.DeviceInfo.X_ZTE-COM_CpuUsed': '4%;1%',
    'InternetGatewayDevice.DeviceInfo.X_ZTE-COM_MemUsed': '17%',
  };

  it('lê óptico do walk real (dBm/°C/mA direto + SupplyVoltage em mV)', () => {
    const d = extractDiagnostics(params);
    expect(d.rxPower).toBeCloseTo(-24.2, 2);
    expect(d.txPower).toBeCloseTo(2.53, 2);
    expect(d.temperature).toBeCloseTo(36.35, 2);
    expect(d.voltage).toBeCloseTo(3.268, 3);
    expect(d.biasCurrent).toBeCloseTo(12.9, 2);
    expect(d.gponStatus).toBe('Up');
    expect(d.fecErrors).toBe(0);
    expect(d.opticalHealth).toBe('OK');
    expect(d.hasOptical).toBe(true);
  });

  it('CPU vem do pior core de "4%;1%" e memória de "17%" (X_ZTE-COM_*)', () => {
    const d = extractDiagnostics(params);
    expect(d.cpuUsage).toBe(4);
    expect(d.memUsage).toBe(17);
  });

  it('normaliza deci-dBm e centi-dBm (firmwares que reportam inteiro)', () => {
    const deci = extractDiagnostics({
      [`${ZTE_IFACE}.RXPower`]: '-198',
      [`${ZTE_IFACE}.TXPower`]: '25',
    });
    expect(deci.rxPower).toBeCloseTo(-19.8, 2);
    expect(deci.txPower).toBeCloseTo(2.5, 2);
    const centi = extractDiagnostics({
      [`${ZTE_IFACE}.RXPower`]: '-1980',
      [`${ZTE_IFACE}.TXPower`]: '250',
      [`${ZTE_IFACE}.TransceiverTemperature`]: '4820',
      [`${ZTE_IFACE}.SupplyVoltage`]: '3300',
      [`${ZTE_IFACE}.BiasCurrent`]: '6050',
    });
    expect(centi.rxPower).toBeCloseTo(-19.8, 2);
    expect(centi.txPower).toBeCloseTo(2.5, 2);
    expect(centi.temperature).toBeCloseTo(48.2, 2);
    expect(centi.voltage).toBeCloseTo(3.3, 3);
    expect(centi.biasCurrent).toBeCloseTo(12.1, 2); // 2µA → mA
  });

  it('RX positivo só pode ser DDM cru (0.1µW) — converte; piso de sensor vira null', () => {
    const ddm = extractDiagnostics({ [`${ZTE_IFACE}.RXPower`]: '105' }); // 10.5µW
    expect(ddm.rxPower).toBeCloseTo(-19.79, 2);
    const floor = extractDiagnostics({ [`${ZTE_IFACE}.RXPower`]: '8' });
    expect(floor.rxPower).toBeNull();
    expect(floor.opticalHealth).toBe('UNKNOWN');
  });

  it('tolera variação de grafia das folhas (walk parcial + regex)', () => {
    const d = extractDiagnostics({
      [`${ZTE_IFACE}.RxPower`]: '-21.5',
      [`${ZTE_IFACE}.SupplyVottage`]: '3.28',
    });
    expect(d.rxPower).toBeCloseTo(-21.5, 2);
    expect(d.voltage).toBeCloseTo(3.28, 3);
  });

  it('PPP e contadores WAN vêm da WAN 1 (mesmos paths padrão da Zyxel)', () => {
    const d = extractDiagnostics(params);
    expect(d.pppStatus).toBe('Connected');
    expect(d.wanUptime).toBe(4517);
    expect(d.wanRxBytes).toBe(260556615);
    expect(d.wanTxBytes).toBe(161642950);
  });

  it('mapeia bandas na convenção 1/5 (não invertida) e lê RSSI/taxa por cliente', () => {
    const d = extractDiagnostics(params);
    expect(d.wifiClients24).toBe(8); // WLANConfiguration.1
    expect(d.wifiClients5).toBe(8); // WLANConfiguration.5
    expect(d.wifiChannel24).toBe(7);
    expect(d.wifiChannel5).toBe(44);
    expect(d.wifiClients).toHaveLength(1);
    expect(d.wifiClients[0].band).toBe('5GHz');
    expect(d.wifiClients[0].rssi).toBe(-54);
    expect(d.wifiClients[0].rxRate).toBe(65000);
  });

  it('keys Huawei presentes têm prioridade sobre o fallback ZTE', () => {
    const d = extractDiagnostics({
      'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig.RXPower': '-1800',
      [`${ZTE_IFACE}.RXPower`]: '-21.5',
    });
    expect(d.rxPower).toBe(-18);
  });
});

describe('extractDiagnostics — Huawei segue intocado', () => {
  const H = 'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig'; // typo de fábrica

  it('normaliza centi-dBm e mV como antes', () => {
    const d = extractDiagnostics({
      [`${H}.RXPower`]: '-2280',
      [`${H}.TXPower`]: '250',
      [`${H}.SupplyVoltage`]: '3338',
      [`${H}.Status`]: 'Up',
    });
    expect(d.rxPower).toBe(-22.8);
    expect(d.txPower).toBe(2.5);
    expect(d.voltage).toBeCloseTo(3.338, 3);
    expect(d.gponStatus).toBe('Up');
    expect(d.opticalHealth).toBe('OK');
  });

  it('keys Huawei presentes têm prioridade sobre fallbacks', () => {
    const d = extractDiagnostics({
      [`${H}.RXPower`]: '-1800',
      [`${VSOL_IFACE}.RXPower`]: '160',
    });
    expect(d.rxPower).toBe(-18);
  });
});
