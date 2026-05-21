/**
 * Data model paths Huawei EG8145V5/X10 (Customized HGW DataModel).
 *
 * Extraído pra arquivo standalone — pode ser importado pelo
 * Tr069TasksService (provisioning) e pelo ContractsService (mudança de
 * Wi-Fi pós-instalação) sem criar dep circular entre módulos.
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
export const HUAWEI_EG8145_PATHS = {
  // SSID 2.4GHz e 5GHz (X10 tem ambos; V5 tem ambos em algumas firmwares)
  ssid24: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID',
  ssid50: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID',
  pwd24:
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey',
  pwd50:
    'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.PreSharedKey',
  // Security mode (WPA2-PSK)
  sec24: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_HW_SecurityMode',
  sec50: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.X_HW_SecurityMode',
  // Inform interval — reduzir após primeira config pra próxima sessão ser rápida
  informInterval: 'InternetGatewayDevice.ManagementServer.PeriodicInformInterval',
} as const;

/** Range de PeriodicInformInterval recomendado. */
export const HUAWEI_INFORM_INTERVAL_DEFAULT = 60;
