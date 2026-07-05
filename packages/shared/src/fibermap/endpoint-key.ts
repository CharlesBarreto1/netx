/**
 * FiberMap — chaves de ocupação de endpoint óptico.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Cada conexão ativa grava 2 linhas em fibermap_connection_endpoints com a
 * chave canônica da ponta; o UNIQUE(endpoint_key) garante — inclusive sob
 * concorrência — que uma ponta só participa de UMA conexão (aceites FM-0/FM-3).
 * As chaves embutem UUIDs, então a unicidade global não colide entre tenants.
 */

/** Ponta de extremidade de fibra (lado A/B do cabo). */
export function fibermapFiberEndKey(fiberId: string, side: 'A' | 'B'): string {
  return `FIBER:${fiberId}:${side}`;
}

/** Ponta criada por um corte ("tesoura"): lado Upstream/Downstream. */
export function fibermapCutEndKey(cutId: string, side: 'U' | 'D'): string {
  return `CUT:${cutId}:${side}`;
}

/**
 * Face de uma porta de device. Uma porta física real tem DUAS faces
 * independentes: o adaptador frontal (recebe conector/patch — conexões
 * kind=CONNECTOR) e o pigtail traseiro (recebe fusão — kind=FUSION).
 * Sem isso, um DIO de passagem (OLT →conector→ porta →fusão→ fibra do cabo)
 * seria impossível — cada face só pode ser usada UMA vez.
 * A face deriva do kind da conexão: CONNECTOR → 'C', FUSION → 'F'.
 */
export type FibermapPortFace = 'CONNECTOR' | 'FUSION';

/** Porta de device (splitter/DIO/OLT) numa das faces. */
export function fibermapPortKey(portId: string, face: FibermapPortFace): string {
  return `PORT:${portId}:${face === 'CONNECTOR' ? 'C' : 'F'}`;
}
