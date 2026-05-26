/**
 * Cliente tipado pra árvore PON (R7 OSP).
 * Backend: apps/core-service/src/modules/optical/pon-tree.service.ts
 */
import { api } from './api';

export interface PonTreeCable {
  id: string;
  code: string;
  type: 'BACKBONE' | 'DISTRIBUTION' | 'DROP';
  fiberCount: number;
  lengthMeters: number;
  destination: PonTreeNode | null;
  cycleToEnclosureId?: string;
  activeEventsCount: number;
}

export interface PonTreeNode {
  enclosure: {
    id: string;
    code: string;
    type: 'CTO' | 'NAP' | 'SPLITTER' | 'EMENDA';
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
  outgoingCables: PonTreeCable[];
}

export interface PonTreeResponse {
  root: PonTreeNode;
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
  type: 'CTO' | 'NAP' | 'SPLITTER' | 'EMENDA';
  isRootCandidate: boolean;
  outgoingCableCount: number;
}

export const ponTreeApi = {
  rootsPath: () => '/v1/optical/pon-tree/roots',
  listRoots: () =>
    api.get<PonTreeRootCandidate[]>('/v1/optical/pon-tree/roots'),
  treePath: (enclosureId: string) => `/v1/optical/pon-tree/${enclosureId}`,
  getTree: (enclosureId: string) =>
    api.get<PonTreeResponse>(`/v1/optical/pon-tree/${enclosureId}`),
};
