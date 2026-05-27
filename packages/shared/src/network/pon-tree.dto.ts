/**
 * DTOs da vista de árvore PON (R7 OSP).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Doc: docs/architecture/osp-network.md
 *
 * Estrutura recursiva: cada nó tem caixa + lista de cabos saindo + cada
 * cabo tem destination que é outro nó (recursivo). Backend traversa o
 * grafo a partir da raiz pra baixo, limitado em profundidade.
 *
 * Não-geográfico: o frontend faz layout em árvore (top-down ou
 * left-right). Útil pra diagnóstico ("onde está o cliente X no caminho
 * lógico até a OLT?") sem distração do mapa.
 */

export interface PonTreeCable {
  id: string;
  code: string;
  type: 'BACKBONE' | 'DISTRIBUTION' | 'DROP';
  fiberCount: number;
  lengthMeters: number;
  /** Nó destino (caixa do outro lado). Cyclic refs detectados → null. */
  destination: PonTreeNode | null;
  /** Sinaliza visited (ciclo) — UI mostra "(volta pra X)". */
  cycleToEnclosureId?: string;
  /** Eventos OTDR ATIVOS neste cabo — badge vermelho na UI. */
  activeEventsCount: number;
}

export interface PonTreeNode {
  enclosure: {
    id: string;
    code: string;
    type: 'CTO' | 'NAP' | 'SPLITTER' | 'EMENDA' | 'RESERVA';
    splitterRatio:
      | 'ONE_TO_2'
      | 'ONE_TO_4'
      | 'ONE_TO_8'
      | 'ONE_TO_16'
      | 'ONE_TO_32'
      | 'ONE_TO_64'
      | null;
    capacity: number;
    portsUsed: number;
    portsTotal: number;
  };
  /** Cabos cuja endpointA é esta caixa (saídas). */
  outgoingCables: PonTreeCable[];
}

export interface PonTreeResponse {
  root: PonTreeNode;
  /** Estatística pra UI mostrar "tree com N nós, M ONTs no fim". */
  stats: {
    totalNodes: number;
    totalCables: number;
    leafClients: number;
    maxDepth: number;
  };
}

export interface PonTreeRootCandidate {
  id: string;
  code: string;
  type: 'CTO' | 'NAP' | 'SPLITTER' | 'EMENDA' | 'RESERVA';
  /**
   * True se é candidato natural a raiz: caixa SEM cabo apontando pra ela
   * como endpointB (i.e., não recebe cabo de outra caixa — é cabeça da árvore).
   */
  isRootCandidate: boolean;
  outgoingCableCount: number;
}
