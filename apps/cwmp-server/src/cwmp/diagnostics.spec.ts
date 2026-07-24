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

// Parks Fiberlink 5xx (gSOAP/X_RTK) — SEM óptico via TR-069, WLAN 1-5=5G e
// 6-10=2.4G (invertido vs Huawei). Valores do dump/walk ao vivo (416-D92205,
// 2026-07-23). O parser tem que: reportar opticalHealth UNKNOWN sem óptico,
// mapear a banda pela WLAN 6 (2.4G), e ler recursos TR-098 padrão.
describe('extractDiagnostics — Parks Fiberlink 5xx (X_RTK, sem óptico)', () => {
  const WLAN_5G = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1'; // 5G
  const WLAN_24 = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.6'; // 2.4G
  const PPP = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';
  const params: Record<string, string> = {
    // sinal do 5xx: extensão Realtek de VLAN + agregação da WLAN 6
    [`${PPP}.X_RTK_VlanMuxID`]: '1010',
    [`${PPP}.ConnectionStatus`]: 'Connected',
    [`${WLAN_24}.TotalAssociations`]: '2',
    [`${WLAN_5G}.TotalAssociations`]: '1',
    [`${WLAN_24}.Channel`]: '6',
    [`${WLAN_5G}.Channel`]: '44',
    // um cliente Wi-Fi na 2.4G (WLAN 6) — por índice explícito, sem RSSI
    [`${WLAN_24}.AssociatedDevice.1.AssociatedDeviceMACAddress`]: 'AA:BB:CC:11:22:33',
    [`${WLAN_24}.AssociatedDevice.1.AssociatedDeviceIPAddress`]: '192.168.1.50',
    // recursos TR-098 padrão
    'InternetGatewayDevice.DeviceInfo.ProcessStatus.CPUUsage': '4',
    'InternetGatewayDevice.DeviceInfo.MemoryStatus.Total': '69052',
    'InternetGatewayDevice.DeviceInfo.MemoryStatus.Free': '19500',
  };

  it('SEM óptico: hasOptical=false e opticalHealth=UNKNOWN (não abre alerta falso)', () => {
    const d = extractDiagnostics(params);
    expect(d.hasOptical).toBe(false);
    expect(d.rxPower).toBeNull();
    expect(d.txPower).toBeNull();
    expect(d.opticalHealth).toBe('UNKNOWN');
  });

  it('Wi-Fi agregado sai da WLAN 6 (2.4G) e WLAN 1 (5G)', () => {
    const d = extractDiagnostics(params);
    expect(d.wifiClients24).toBe(2);
    expect(d.wifiClients5).toBe(1);
    expect(d.wifiChannel24).toBe(6);
    expect(d.wifiChannel5).toBe(44);
  });

  it('cliente Wi-Fi da WLAN 6 é rotulado como 2.4GHz (mapa 5xx: 1=5G, 6=2.4G)', () => {
    const d = extractDiagnostics(params);
    const c = d.wifiClients.find((x) => x.mac === 'AA:BB:CC:11:22:33');
    expect(c?.band).toBe('2.4GHz');
    expect(c?.rssi).toBeNull(); // firmware não expõe RSSI (como VSOL)
  });

  it('recursos TR-098 padrão: CPU direto e memória de Total/Free', () => {
    const d = extractDiagnostics(params);
    expect(d.cpuUsage).toBe(4);
    expect(d.memUsage).toBe(Math.round((1 - 19500 / 69052) * 100));
  });
});

// Nokia G-1426G-A / AX3000 (X_ALU-COM) — TEM óptico (objeto global
// X_ALU_OntOpticalParam), WLAN 1-4=2.4G e 5-8=5G. ✅ Valores REAIS do dump GET
// ao vivo (device B0D1D6-ALCLFE07D95F, SW 3TN00383HJKK99, base ZUX-PR
// 2026-07-24): RX/TX/temp em unidade DIRETA (dBm/°C), SupplyVottage em VOLT
// direto (3.289), BiasCurrent em µA (9000 = 9 mA). ⚠️ Descobertas do ao vivo:
// RSSI/SNR por cliente vêm ZERADOS (só o MAC é útil); CPU/mem TR-098 vêm 0
// (não populados). Se quebrar, ou o parser regrediu ou o firmware mudou.
describe('extractDiagnostics — Nokia G-1426G-A (X_ALU, óptico dBm direto)', () => {
  const OPT = 'InternetGatewayDevice.X_ALU_OntOpticalParam';
  const WLAN_24 = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1'; // 2.4G
  const WLAN_5G = 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5'; // 5G
  const PPP = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';
  const params: Record<string, string> = {
    // óptico do objeto global — valores REAIS do dump ao vivo
    [`${OPT}.RXPower`]: '-19.746941', // dBm direto
    [`${OPT}.TXPower`]: '2.225604', // dBm direto
    [`${OPT}.TransceiverTemperature`]: '40.900002', // °C direto
    [`${OPT}.SupplyVottage`]: '3.289000', // VOLT direto (typo de fábrica; NÃO mV)
    [`${OPT}.BiasCurrent`]: '9000.000000', // µA → 9 mA (÷1000, NÃO ÷500)
    [`${OPT}.Status`]: 'Up',
    // PPPoE na WAN 1 (coberto pelos fallbacks Zyxel)
    [`${PPP}.ConnectionStatus`]: 'Connected',
    [`${PPP}.Uptime`]: '8123',
    [`${PPP}.Stats.EthernetBytesReceived`]: '9912345',
    [`${PPP}.Stats.EthernetBytesSent`]: '2211000',
    // Wi-Fi agregado: WLAN 1 = 2.4G, WLAN 5 = 5G (confirmado por Standard/Freq)
    [`${WLAN_24}.TotalAssociations`]: '2',
    [`${WLAN_5G}.TotalAssociations`]: '0',
    [`${WLAN_24}.Channel`]: '6',
    [`${WLAN_5G}.Channel`]: '36',
    // cliente Wi-Fi na 2.4G: MAC presente, mas SignalStrength ZERADO (realidade)
    [`${WLAN_24}.AssociatedDevice.1.AssociatedDeviceMACAddress`]: '20:f1:b2:04:67:54',
    [`${WLAN_24}.AssociatedDevice.1.SignalStrength`]: '0',
    // temperatura da placa (a única métrica de recurso que a Nokia popula)
    'InternetGatewayDevice.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value': '34',
    // CPU/mem TR-098 vêm ZERADOS neste firmware (não populados)
    'InternetGatewayDevice.DeviceInfo.ProcessStatus.CPUUsage': '0',
    'InternetGatewayDevice.DeviceInfo.MemoryStatus.Total': '0',
    'InternetGatewayDevice.DeviceInfo.MemoryStatus.Free': '0',
  };

  it('lê óptico do objeto global em unidade direta e classifica saúde', () => {
    const d = extractDiagnostics(params);
    expect(d.hasOptical).toBe(true);
    expect(d.rxPower).toBeCloseTo(-19.75, 2);
    expect(d.txPower).toBeCloseTo(2.23, 2);
    expect(d.temperature).toBeCloseTo(40.9, 2);
    expect(d.voltage).toBeCloseTo(3.29, 2); // VOLT direto, não mV
    expect(d.biasCurrent).toBeCloseTo(9.0, 2); // 9000 µA → 9 mA (÷1000)
    expect(d.opticalHealth).toBe('OK'); // -19.75 dBm está na faixa boa
    expect(d.gponStatus).toBe('Up');
  });

  it('descarta RX de piso de sensor (<-30 dBm) — UNKNOWN em vez de alarme falso', () => {
    const d = extractDiagnostics({ ...params, [`${OPT}.RXPower`]: '-33.0' });
    expect(d.rxPower).toBeNull();
    expect(d.opticalHealth).toBe('UNKNOWN');
  });

  it('Wi-Fi agregado sai da WLAN 1 (2.4G) e WLAN 5 (5G)', () => {
    const d = extractDiagnostics(params);
    expect(d.wifiClients24).toBe(2);
    expect(d.wifiClients5).toBe(0);
    expect(d.wifiChannel24).toBe(6);
    expect(d.wifiChannel5).toBe(36);
  });

  it('cliente Wi-Fi da WLAN 1 é 2.4GHz; RSSI fica null (firmware zera SignalStrength)', () => {
    const d = extractDiagnostics(params);
    const c = d.wifiClients.find((x) => x.mac === '20:f1:b2:04:67:54');
    expect(c?.band).toBe('2.4GHz');
    // SignalStrength='0' → 0 dBm é sinal irreal (RSSI é sempre negativo); tratado
    // como null pra não poluir o agregado de cobertura com um valor falso.
    expect(c?.rssi).toBeNull();
    expect(d.wifiWorstRssi).toBeNull();
  });

  it('PPPoE (WAN 1) e temperatura da placa; CPU/mem ficam null (Nokia zera)', () => {
    const d = extractDiagnostics(params);
    expect(d.pppStatus).toBe('Connected');
    expect(d.wanUptime).toBe(8123);
    expect(d.wanRxBytes).toBe(9912345);
    expect(d.deviceTemp).toBe(34);
    // MemoryStatus.Total=0 → memUsageFromStatus guarda contra divisão e dá null.
    expect(d.memUsage).toBeNull();
    // CPUUsage=0 é lido literalmente; não é métrica confiável nesta Nokia mas
    // não quebra (0 é um valor válido de CPU ocioso).
    expect(d.cpuUsage).toBe(0);
  });

  it('não colide com os branches ópticos de outros vendors', () => {
    const d = extractDiagnostics(params);
    expect(d.rxPower).not.toBeNull();
    expect(d.hasOptical).toBe(true);
  });
});

describe('extractDiagnostics — Stavix/Datacom MP-X4410A (X_GponInterafceConfig)', () => {
  // Valores do dump REAL com valores (device 0CF0B4-MKPGB4E18DEB, jul/2026).
  // ⚠️ Óptico no MESMO objeto (e typo) do Huawei, MAS em unidade humana DIRETA
  // (dBm/mV/mA), grafia "SupplyVoltage" correta. WLAN INVERTIDO 1=5G/6=2.4G.
  const GPON = 'InternetGatewayDevice.WANDevice.1.X_GponInterafceConfig';
  const PPP1 = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';
  const params: Record<string, string> = {
    [`${GPON}.RXPower`]: '-21', // dBm DIRETO
    [`${GPON}.TXPower`]: '2', // dBm DIRETO
    [`${GPON}.SupplyVoltage`]: '3298', // mV → 3.298 V (grafia CORRETA)
    [`${GPON}.BiasCurrent`]: '9', // mA DIRETO
    [`${GPON}.Status`]: 'Up',
    // extensão X_CT-COM na WANPPPConnection — marcador que distingue do Huawei.
    [`${PPP1}.X_CT-COM_VLANIDMark`]: '120',
    [`${PPP1}.X_CT-COM_VLANMode`]: '2',
    [`${PPP1}.ConnectionStatus`]: 'Connected',
    [`${PPP1}.Uptime`]: '4664',
    [`${PPP1}.Stats.EthernetBytesReceived`]: '199279313',
    [`${PPP1}.Stats.EthernetBytesSent`]: '3791952179',
    // WLAN INVERTIDO: 1 = 5GHz (primário), 6 = 2.4GHz (primário).
    [`${WLAN}.1.TotalAssociations`]: '1',
    [`${WLAN}.6.TotalAssociations`]: '2',
    [`${WLAN}.1.Channel`]: '44',
    [`${WLAN}.6.Channel`]: '11',
    // clientes: WLAN 1 (5G) e WLAN 6 (2.4G) — SÓ MAC+IP, SEM RSSI.
    [`${WLAN}.1.AssociatedDevice.1.AssociatedDeviceMACAddress`]: 'a4:4b:d5:e7:84:92',
    [`${WLAN}.1.AssociatedDevice.1.AssociatedDeviceIPAddress`]: '192.168.1.3',
    [`${WLAN}.6.AssociatedDevice.1.AssociatedDeviceMACAddress`]: '4e:6a:7f:20:e8:09',
    [`${WLAN}.6.AssociatedDevice.1.AssociatedDeviceIPAddress`]: '192.168.1.6',
    'InternetGatewayDevice.DeviceInfo.ProcessStatus.CPUUsage': '9',
    'InternetGatewayDevice.DeviceInfo.MemoryStatus.Total': '457836',
    'InternetGatewayDevice.DeviceInfo.MemoryStatus.Free': '260708',
    'InternetGatewayDevice.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value': '59',
  };

  it('lê óptico em unidade HUMANA direta pelo branch default (dBm/V/mA)', () => {
    const d = extractDiagnostics(params);
    expect(d.rxPower).toBe(-21);
    expect(d.txPower).toBe(2);
    expect(d.voltage).toBeCloseTo(3.298, 3); // mV → V
    expect(d.biasCurrent).toBe(9);
    expect(d.gponStatus).toBe('Up');
    expect(d.hasOptical).toBe(true);
    expect(d.opticalHealth).toBe('OK'); // -21 dBm está na faixa OK
  });

  it('mapeia as bandas com os índices INVERTIDOS da Stavix (WLAN 1=5G, 6=2.4G)', () => {
    const d = extractDiagnostics(params);
    expect(d.wifiClients5).toBe(1); // WLANConfiguration.1 = 5GHz
    expect(d.wifiClients24).toBe(2); // WLANConfiguration.6 = 2.4GHz
    expect(d.wifiChannel5).toBe(44);
    expect(d.wifiChannel24).toBe(11);
  });

  it('cliente da WLAN 1 é 5GHz e da WLAN 6 é 2.4GHz — sem RSSI (data model não expõe)', () => {
    const d = extractDiagnostics(params);
    const c5 = d.wifiClients.find((x) => x.mac === 'a4:4b:d5:e7:84:92');
    const c24 = d.wifiClients.find((x) => x.mac === '4e:6a:7f:20:e8:09');
    expect(c5?.band).toBe('5GHz');
    expect(c24?.band).toBe('2.4GHz');
    expect(c5?.rssi).toBeNull();
    expect(d.wifiWorstRssi).toBeNull(); // sem RSSI → cobertura por cliente null
  });

  it('PPPoE (WAN 1) e recursos TR-098 via fallbacks padrão', () => {
    const d = extractDiagnostics(params);
    expect(d.pppStatus).toBe('Connected');
    expect(d.wanUptime).toBe(4664);
    expect(d.wanRxBytes).toBe(199279313);
    expect(d.wanTxBytes).toBe(3791952179);
    expect(d.cpuUsage).toBe(9);
    expect(d.memUsage).toBe(Math.round((1 - 260708 / 457836) * 100)); // ~43%
    expect(d.deviceTemp).toBe(59); // sensor TR-098 (SoC), não o campo lixo do óptico
  });

  it('REGRESSÃO: mesmo compartilhando X_GponInterafceConfig com o Huawei, NÃO usa o band-map Huawei', () => {
    const d = extractDiagnostics(params);
    // Se caísse no default Huawei (1=2.4G/5=5G), o cliente da WLAN 1 sairia como
    // 2.4GHz e o agregado 5G/2.4G viria trocado. A detecção Stavix corrige isso.
    const c5 = d.wifiClients.find((x) => x.mac === 'a4:4b:d5:e7:84:92');
    expect(c5?.band).not.toBe('2.4GHz');
    expect(d.wifiClients5).not.toBe(2);
  });
});
