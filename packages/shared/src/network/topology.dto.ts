/**
 * DTOs do endpoint de topologia agregada de uma caixa óptica (R4.5a).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc: docs/architecture/osp-network.md
 *
 * GET /v1/optical/enclosures/:id/topology retorna um snapshot completo de
 * uma caixa pra a vista esquemática (R4.5b) renderizar sem N+1.
 *
 * Estrutura:
 *   - enclosure: a própria CTO/CEO
 *   - childSplitters: splitters cascateados dentro (parentId = enclosure.id)
 *   - incomingCables: cabos com endpointA OU endpointB = enclosure.id
 *     (operador interpreta "entrando" semanticamente — backbone vem do POP,
 *     drops vão pra cliente)
 *   - splices: fusões cujos cableA ou cableB estão em incomingCables — ou
 *     seja, fusões físicas que acontecem DENTRO desta caixa
 *   - ports: as portas da caixa (1..capacity) com contrato atribuído
 */
import type { FiberCableType } from './fiber.dto';

export interface TopologyEnclosure {
  id: string;
  code: string;
  type: 'CTO' | 'NAP' | 'SPLITTER' | 'EMENDA';
  latitude: number;
  longitude: number;
  capacity: number;
  splitterRatio:
    | 'ONE_TO_2'
    | 'ONE_TO_4'
    | 'ONE_TO_8'
    | 'ONE_TO_16'
    | 'ONE_TO_32'
    | 'ONE_TO_64'
    | null;
}

export interface TopologyChildSplitter {
  id: string;
  code: string;
  type: 'SPLITTER';
  splitterRatio: TopologyEnclosure['splitterRatio'];
  capacity: number;
  /** Sumário de ocupação. UI mostra "8/16 portas usadas". */
  portsUsed: number;
  portsTotal: number;
}

export interface TopologyCable {
  id: string;
  code: string;
  type: FiberCableType;
  fiberCount: number;
  /** Indica qual lado do cabo está aqui: A (origem) ou B (destino). */
  endpointRole: 'A' | 'B';
  /** ID da OUTRA ponta — caixa do lado oposto (pra UI saber "este cabo vai pra X"). */
  otherEndpointId: string | null;
  otherEndpointCode: string | null;
  lengthMeters: number;
}

export interface TopologySplice {
  id: string;
  /** Soft side dentro deste contexto: qual cabo é "deste lado" da caixa. */
  cableAId: string;
  cableACode: string;
  fiberAIndex: number;
  fiberAColorHex: string;
  cableBId: string;
  cableBCode: string;
  fiberBIndex: number;
  fiberBColorHex: string;
  lossDb: number | null;
  lossClass: 'unmeasured' | 'good' | 'warning' | 'bad';
}

export interface TopologyPort {
  id: string;
  number: number;
  status: 'FREE' | 'RESERVED' | 'USED' | 'DAMAGED';
  /** Contrato/cliente atendido — preenchido se status = USED. */
  contract: {
    id: string;
    code: string | null;
    customerDisplayName: string;
  } | null;
}

export interface EnclosureTopologyResponse {
  enclosure: TopologyEnclosure;
  childSplitters: TopologyChildSplitter[];
  incomingCables: TopologyCable[];
  splices: TopologySplice[];
  ports: TopologyPort[];
}
