import type { IpVer } from './ip.util';

/**
 * Reconciliação IPAM ↔ rede real: tipos e a lógica de diff (pura, sem banco).
 *
 * O IPAM documenta o que o operador ANOTOU. Esta camada olha o que a rede
 * está de fato usando e aponta onde os dois divergem. Manter o diff puro deixa
 * as regras testáveis sem infra — os coletores é que tocam banco/rede.
 */

/** De onde veio a evidência de que um IP está em uso. */
export type ObservationSource =
  | 'RADIUS' // sessão de accounting ativa (acctstoptime IS NULL)
  | 'CONTRACT' // IP fixo no cadastro do contrato (Framed-IP)
  | 'EQUIPMENT' // IP de gerência de equipamento
  | 'MIKROTIK_ARP' // tabela ARP lida do RouterOS
  | 'MIKROTIK_DHCP'; // lease DHCP lido do RouterOS

/** Um IP visto em uso, com o dono que a fonte alega. */
export interface Observation {
  ip: string;
  num: bigint;
  version: IpVer;
  source: ObservationSource;
  contractId?: string | null;
  customerId?: string | null;
  equipmentId?: string | null;
  macAddress?: string | null;
  hostname?: string | null;
  /** Texto livre pra UI (username PPPoE, nome do equipamento, interface…). */
  detail?: string | null;
}

/** O que o IPAM tem documentado, reduzido ao necessário pro diff. */
export interface DocumentedAddress {
  id: string;
  num: bigint;
  version: IpVer;
  address: string;
  status: string;
  contractId: string | null;
  customerId: string | null;
  equipmentId: string | null;
}

export interface PrefixRange {
  id: string;
  cidr: string;
  version: IpVer;
  first: bigint;
  last: bigint;
}

export type FindingKind =
  /** Em uso na rede, ausente do IPAM. O caso que mais aparece. */
  | 'UNDOCUMENTED'
  /** Em uso, mas nenhum prefixo documentado cobre esse IP. */
  | 'NO_PREFIX'
  /** IPAM diz um dono, a rede mostra outro. */
  | 'OWNER_MISMATCH'
  /** Documentado pra um contrato que não existe mais / foi cancelado. */
  | 'ORPHANED';

export interface Finding {
  kind: FindingKind;
  ip: string;
  version: IpVer;
  sources: ObservationSource[];
  prefixId: string | null;
  prefixCidr: string | null;
  /** Preenchido quando o IP já tem linha no IPAM. */
  addressId: string | null;
  observedContractId: string | null;
  observedEquipmentId: string | null;
  observedCustomerId: string | null;
  macAddress: string | null;
  hostname: string | null;
  detail: string | null;
  /** Frase pronta pro operador entender o que fazer. */
  suggestion: string;
}

/** Prefixo mais justo que contém `num` (o mesmo critério do parent na árvore). */
export function tightestPrefix(
  prefixes: PrefixRange[],
  num: bigint,
  version: IpVer,
): PrefixRange | null {
  let best: PrefixRange | null = null;
  for (const p of prefixes) {
    if (p.version !== version || num < p.first || num > p.last) continue;
    if (!best || p.last - p.first < best.last - best.first) best = p;
  }
  return best;
}

/** Agrupa observações do mesmo IP — várias fontes podem ver o mesmo endereço. */
function groupByIp(observations: Observation[]): Map<string, Observation[]> {
  const map = new Map<string, Observation[]>();
  for (const o of observations) {
    const k = `${o.version}:${o.num.toString()}`;
    const arr = map.get(k);
    if (arr) arr.push(o);
    else map.set(k, [o]);
  }
  return map;
}

/**
 * Primeiro valor não-nulo do campo, priorizando as fontes mais confiáveis sobre
 * o dono: ARP/DHCP sabem que o IP está vivo, mas não sabem de quem é — só
 * RADIUS e o cadastro amarram o IP a um contrato.
 */
const OWNER_PRIORITY: ObservationSource[] = [
  'CONTRACT',
  'RADIUS',
  'EQUIPMENT',
  'MIKROTIK_DHCP',
  'MIKROTIK_ARP',
];

function pick<K extends keyof Observation>(obs: Observation[], field: K): Observation[K] | null {
  const sorted = [...obs].sort(
    (a, b) => OWNER_PRIORITY.indexOf(a.source) - OWNER_PRIORITY.indexOf(b.source),
  );
  for (const o of sorted) {
    const v = o[field];
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
}

export interface DiffInput {
  observations: Observation[];
  documented: DocumentedAddress[];
  prefixes: PrefixRange[];
  /** Contratos cancelados ou apagados — base do ORPHANED. */
  deadContractIds: Set<string>;
}

/**
 * Compara o observado com o documentado. Puro: mesma entrada, mesma saída.
 *
 * Uma regra que vale destacar: NÃO marcamos como obsoleto um IP documentado que
 * simplesmente não apareceu na varredura. Cliente offline no momento do scan
 * continua com o IP legitimamente reservado — tratar ausência como prova de
 * desuso faria o operador liberar IP em uso. Só apontamos `ORPHANED` quando há
 * evidência positiva: o contrato dono sumiu ou foi cancelado.
 */
export function diffObservations(input: DiffInput): Finding[] {
  const { observations, documented, prefixes, deadContractIds } = input;

  const docByNum = new Map<string, DocumentedAddress>();
  for (const d of documented) docByNum.set(`${d.version}:${d.num.toString()}`, d);

  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const [key, obs] of groupByIp(observations)) {
    seen.add(key);
    const first = obs[0];
    const sources = [...new Set(obs.map((o) => o.source))].sort();
    const prefix = tightestPrefix(prefixes, first.num, first.version);
    const doc = docByNum.get(key);

    const observedContractId = pick(obs, 'contractId') ?? null;
    const observedEquipmentId = pick(obs, 'equipmentId') ?? null;
    const observedCustomerId = pick(obs, 'customerId') ?? null;

    const base = {
      ip: first.ip,
      version: first.version,
      sources,
      prefixId: prefix?.id ?? null,
      prefixCidr: prefix?.cidr ?? null,
      addressId: doc?.id ?? null,
      observedContractId,
      observedEquipmentId,
      observedCustomerId,
      macAddress: pick(obs, 'macAddress') ?? null,
      hostname: pick(obs, 'hostname') ?? null,
      detail: pick(obs, 'detail') ?? null,
    };

    if (!prefix) {
      findings.push({
        ...base,
        kind: 'NO_PREFIX',
        suggestion: `Em uso na rede mas fora de qualquer prefixo documentado — cadastre o prefixo que contém ${first.ip}.`,
      });
      continue;
    }

    if (!doc) {
      findings.push({
        ...base,
        kind: 'UNDOCUMENTED',
        suggestion: `Em uso (${sources.join(', ')}) e ausente do IPAM — importe para documentar em ${prefix.cidr}.`,
      });
      continue;
    }

    // Só acusamos divergência de dono quando a fonte sabe de quem é o IP.
    const contractConflict =
      observedContractId && doc.contractId && observedContractId !== doc.contractId;
    const equipmentConflict =
      observedEquipmentId && doc.equipmentId && observedEquipmentId !== doc.equipmentId;

    if (contractConflict || equipmentConflict) {
      findings.push({
        ...base,
        kind: 'OWNER_MISMATCH',
        suggestion: `O IPAM atribui ${first.ip} a outro dono do que a rede mostra — confira qual está certo antes de corrigir.`,
      });
    }
  }

  // Órfãos: documentados apontando pra contrato morto (evidência positiva).
  for (const d of documented) {
    if (!d.contractId || !deadContractIds.has(d.contractId)) continue;
    const prefix = tightestPrefix(prefixes, d.num, d.version);
    findings.push({
      kind: 'ORPHANED',
      ip: d.address,
      version: d.version,
      sources: [],
      prefixId: prefix?.id ?? null,
      prefixCidr: prefix?.cidr ?? null,
      addressId: d.id,
      observedContractId: null,
      observedEquipmentId: null,
      observedCustomerId: null,
      macAddress: null,
      hostname: null,
      detail: null,
      suggestion: `Documentado para um contrato cancelado ou removido — libere ${d.address} se o cliente saiu mesmo.`,
    });
  }

  // Ordem estável e útil: por tipo, depois por IP numérico.
  const order: FindingKind[] = ['UNDOCUMENTED', 'NO_PREFIX', 'OWNER_MISMATCH', 'ORPHANED'];
  return findings.sort((a, b) => {
    const byKind = order.indexOf(a.kind) - order.indexOf(b.kind);
    if (byKind !== 0) return byKind;
    return a.version !== b.version ? a.version - b.version : a.ip.localeCompare(b.ip);
  });
}
