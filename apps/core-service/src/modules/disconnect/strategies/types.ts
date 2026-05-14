/**
 * Tipos compartilhados pelas estratégias de Disconnect.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Strategy Pattern: cada vendor/protocolo expõe `disconnect(target, equipment)`
 * com a mesma assinatura. O `DisconnectService` orquestra qual usar baseado
 * em `equipment.vendor` + `equipment.disconnectStrategy` + `contract.authType`.
 */

import type { ContractAuthMethod, NetworkEquipment } from '@prisma/client';

/**
 * Tudo que sabemos sobre o cliente pra desconectar. Cada strategy usa o que
 * faz sentido pro seu protocolo:
 *   - CoA: User-Name / Acct-Session-Id / Framed-IP-Address
 *   - Mikrotik API: macAddress / framedIp pra `dhcp-server lease remove`
 *   - SSH: tudo isso vai virar placeholder em `ssh_disconnect_cmd`
 */
export interface DisconnectTarget {
  authType: ContractAuthMethod;
  pppoeUsername?: string | null;
  macAddress?: string | null;
  framedIp?: string | null;
  callingStationId?: string | null;
  acctSessionId?: string | null;
  /** Identificador de sessão custom do BNG (Cisco subscriber-id, Juniper service-id, etc) */
  subscriberId?: string | null;
}

/**
 * Resultado homogêneo de uma tentativa de desconexão.
 *   - `ok=true`: equipamento confirmou (Disconnect-ACK / API success / SSH exit 0)
 *   - `ok=false` + `reason='not-supported'`: vendor não suporta esse cenário
 *     (ex: Mikrotik + CoA + IPoE). Útil pro DisconnectService fazer fallback.
 *   - `ok=false` + `reason='session-not-found'`: sessão expirou antes do call
 *   - `ok=false` + `reason='auth-failed'`: secret/credencial errada
 *   - `ok=false` + `reason='timeout'`: equipamento mudo
 *   - `ok=false` + `reason='error'`: outro problema (detalhes em `error`)
 */
export interface DisconnectResult {
  ok: boolean;
  strategy: 'COA' | 'MIKROTIK_API' | 'SSH';
  equipmentId: string;
  equipmentName: string;
  nasIp: string;
  reason?:
    | 'not-supported'
    | 'session-not-found'
    | 'auth-failed'
    | 'timeout'
    | 'error';
  message?: string;
  /** Detalhes brutos pra debug — não exibir na UI sem sanitizar */
  raw?: string;
  /** ms de latência da operação */
  durationMs?: number;
}

/**
 * Contrato comum de todas as strategies. Implementação NÃO deve lançar — sempre
 * retorna `DisconnectResult`. Quem trata é o orquestrador.
 */
export interface DisconnectStrategyExecutor {
  readonly kind: 'COA' | 'MIKROTIK_API' | 'SSH';

  /** Indica se a strategy pode atender esse equipamento+target. */
  canHandle(equipment: NetworkEquipment, target: DisconnectTarget): boolean;

  /** Executa o disconnect. Idempotente — chamar duas vezes não causa side-effect extra. */
  execute(
    equipment: NetworkEquipment,
    target: DisconnectTarget,
  ): Promise<DisconnectResult>;

  /**
   * Health-check / Test connection. Não derruba sessão; só valida credenciais
   * e conectividade. Usado pela UI no botão "Testar conexão".
   */
  testConnectivity(equipment: NetworkEquipment): Promise<{
    ok: boolean;
    message?: string;
  }>;
}
