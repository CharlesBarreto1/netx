import { z } from 'zod';

// =============================================================================
// TR-069 — config de políticas por instância (por tenant).
// Define como cada ISP trata a "penetração" do template homologado:
// adoção de CPE desconhecida, Wi-Fi/PPPoE/VLAN/IPv6, senha de acesso padrão,
// acesso remoto, firmware e janela de conformidade.
// A senha de acesso é WRITE-ONLY (enviada aqui, nunca retornada).
// =============================================================================

export const Tr069PppoeSourceSchema = z.enum(['CONTRACT', 'STATIC', 'OLT']);
export type Tr069PppoeSource = z.infer<typeof Tr069PppoeSourceSchema>;

export const Tr069Ipv6ModeSchema = z.enum(['AUTOCONFIGURED', 'DHCPV6']);
export type Tr069Ipv6Mode = z.infer<typeof Tr069Ipv6ModeSchema>;

export const Tr069RemoteModeSchema = z.enum(['LAN_ONLY', 'LAN_WAN']);
export type Tr069RemoteMode = z.infer<typeof Tr069RemoteModeSchema>;

// -----------------------------------------------------------------------------
// UPSERT (admin) — campos ausentes mantêm o valor atual.
// -----------------------------------------------------------------------------
export const UpsertTr069ConfigRequestSchema = z
  .object({
    // Adoção de ONTs não cadastradas (caixa de adoção, server-level).
    acceptUnknownInforms: z.boolean().optional(),

    // Wi-Fi puxa do contrato (gate nas regras CONTRACT_WIFI_*).
    wifiFromContract: z.boolean().optional(),

    // PPPoE: origem + VLAN padrão + puxar do provisionamento de OLT.
    pppoeSource: Tr069PppoeSourceSchema.optional(),
    defaultVlan: z.coerce.number().int().min(1).max(4094).nullish(),
    pullFromOltProvisioning: z.boolean().optional(),

    // IPv6.
    ipv6Enabled: z.boolean().optional(),
    ipv6Mode: Tr069Ipv6ModeSchema.optional(),

    // Senha de acesso padrão (WRITE-ONLY) + aplicar.
    accessPassword: z.string().min(1).max(128).optional(),
    applyAccessPassword: z.boolean().optional(),

    // Acesso remoto HTTP.
    remoteHttpEnabled: z.boolean().optional(),
    remoteHttpPort: z.coerce.number().int().min(1).max(65535).nullish(),
    remoteMode: Tr069RemoteModeSchema.optional(),

    // Firmware (campanha).
    firmwareAutoUpdate: z.boolean().optional(),
    firmwareUrl: z.string().url().max(512).nullish(),
    firmwareTargetVersion: z.string().max(64).nullish(),

    // Conformidade.
    reconcileIntervalMin: z.coerce.number().int().min(1).max(1440).nullish(),
    reconcileWindowStart: z.coerce.number().int().min(0).max(23).nullish(),
    reconcileWindowEnd: z.coerce.number().int().min(0).max(23).nullish(),

    // WiFi-Opt: pacote de otimização Wi-Fi Huawei (duplo opt-in — só age com a
    // env global E a flag do tenant ligadas; entra 100% desligado).
    wifiOptEnabled: z.boolean().optional(),
    // Domínio regulatório aplicado nas WLANs (ISO 3166-1 alpha-2, ex.: "PY").
    wifiOptRegDomain: z.string().min(2).max(8).optional(),
    wifiOptRolloutEnabled: z.boolean().optional(),
  })
  .strict();
export type UpsertTr069ConfigRequest = z.infer<typeof UpsertTr069ConfigRequestSchema>;

// -----------------------------------------------------------------------------
// Resposta (sem segredo).
// -----------------------------------------------------------------------------
export interface Tr069ConfigResponse {
  tenantId: string;
  acceptUnknownInforms: boolean;
  wifiFromContract: boolean;
  pppoeSource: Tr069PppoeSource;
  defaultVlan: number | null;
  pullFromOltProvisioning: boolean;
  ipv6Enabled: boolean;
  ipv6Mode: Tr069Ipv6Mode;
  // Presença da senha (nunca o valor).
  hasAccessPassword: boolean;
  applyAccessPassword: boolean;
  remoteHttpEnabled: boolean;
  remoteHttpPort: number | null;
  remoteMode: Tr069RemoteMode;
  firmwareAutoUpdate: boolean;
  firmwareUrl: string | null;
  firmwareTargetVersion: string | null;
  reconcileIntervalMin: number | null;
  reconcileWindowStart: number | null;
  reconcileWindowEnd: number | null;
  // WiFi-Opt (pacote de otimização Wi-Fi Huawei).
  wifiOptEnabled: boolean;
  wifiOptRegDomain: string;
  wifiOptRolloutEnabled: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

// -----------------------------------------------------------------------------
// Caixa de adoção — pendentes + ação de adotar.
// -----------------------------------------------------------------------------
export interface Tr069PendingDeviceDto {
  id: string;
  deviceId: string;
  manufacturer: string | null;
  productClass: string | null;
  serialNumber: string | null;
  softwareVersion: string | null;
  informCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export const AdoptPendingDeviceRequestSchema = z
  .object({
    // ONT já cadastrada pra vincular (opcional); senão cria device solto.
    ontId: z.string().uuid().nullish(),
  })
  .strict();
export type AdoptPendingDeviceRequest = z.infer<typeof AdoptPendingDeviceRequestSchema>;

// -----------------------------------------------------------------------------
// Campanha de firmware — dispara DOWNLOAD na frota (usa firmwareUrl da config).
// -----------------------------------------------------------------------------
export const Tr069FirmwareCampaignRequestSchema = z
  .object({
    // Restringe ao modelo (recomendado — firmware é por modelo).
    productClass: z.string().max(64).nullish(),
  })
  .strict();
export type Tr069FirmwareCampaignRequest = z.infer<typeof Tr069FirmwareCampaignRequestSchema>;
