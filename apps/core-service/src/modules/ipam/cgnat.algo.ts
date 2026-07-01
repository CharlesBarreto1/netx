/**
 * CGNAT determinístico (port-block) — mesma ideia da ferramenta do Remontti
 * (cgnat.remontti.com.br). A partir de um bloco PÚBLICO, um bloco PRIVADO de
 * CGNAT (ex.: 100.64.0.0/10) e o nº de portas por cliente, uma fórmula LINEAR
 * mapeia cada IP privado → (IP público, faixa de portas TCP/UDP).
 *
 * Determinístico e SEM estado: a mesma entrada sempre produz a mesma saída, e a
 * operação inversa (IP público + porta → IP privado) é O(1) — essencial pra
 * busca reversa / atendimento a ofício (Marco Civil), sem varrer tabela.
 *
 * Layout por IP público:
 *   [portBase .. maxPort] é fatiado em blocos de `portsPerClient` portas.
 *   blocksPerPublicIp = floor((maxPort - portBase + 1) / portsPerClient)
 *   Cada bloco (slot) atende exatamente 1 IP privado.
 *
 * Índice do IP privado i (0-based, a partir do início do bloco CGNAT):
 *   publicIndex = floor(i / blocksPerPublicIp)   → qual IP público
 *   slot        = i % blocksPerPublicIp          → qual fatia de portas
 *   publicNum   = publicFirst + publicIndex
 *   portStart   = portBase + slot * portsPerClient
 *   portEnd     = portStart + portsPerClient - 1
 *
 * Toda a aritmética é feita em `bigint` (os IPs já vêm como inteiros do
 * ip.util). CGNAT é técnica de conservação IPv4 — este módulo assume v4.
 */

export interface CgnatParams {
  /** Início do bloco público (bigint do IP), inclusive. */
  publicFirst: bigint;
  /** Fim do bloco público, inclusive. */
  publicLast: bigint;
  /** Início do bloco privado CGNAT, inclusive. */
  cgnatFirst: bigint;
  /** Fim do bloco privado CGNAT, inclusive. */
  cgnatLast: bigint;
  /** Portas alocadas por cliente (ex.: 1000). */
  portsPerClient: number;
  /** Primeira porta usável (ex.: 1024 — evita well-known). */
  portBase: number;
  /** Última porta usável (ex.: 65535). */
  maxPort: number;
}

export interface CgnatCapacity {
  blocksPerPublicIp: number;
  publicCount: bigint;
  cgnatCount: bigint;
  /** Máx. de clientes que os IPs públicos comportam. */
  capacity: bigint;
  /** cgnatCount <= capacity ? */
  sufficient: boolean;
  /** Sobra (capacity - cgnatCount) — negativo se faltar. */
  spare: bigint;
}

export interface CgnatMapping {
  privateNum: bigint;
  publicNum: bigint;
  portStart: number;
  portEnd: number;
}

/** Valida os parâmetros básicos e lança mensagem clara se algo estiver errado. */
export function assertParams(p: CgnatParams): void {
  if (p.publicLast < p.publicFirst) throw new Error('bloco público inválido (fim < início)');
  if (p.cgnatLast < p.cgnatFirst) throw new Error('bloco CGNAT inválido (fim < início)');
  if (!Number.isInteger(p.portsPerClient) || p.portsPerClient <= 0)
    throw new Error('portsPerClient deve ser inteiro > 0');
  if (!Number.isInteger(p.portBase) || p.portBase < 0 || p.portBase > 65535)
    throw new Error('portBase fora de 0..65535');
  if (!Number.isInteger(p.maxPort) || p.maxPort < 0 || p.maxPort > 65535)
    throw new Error('maxPort fora de 0..65535');
  if (p.maxPort < p.portBase) throw new Error('maxPort < portBase');
  if (p.maxPort - p.portBase + 1 < p.portsPerClient)
    throw new Error('faixa de portas menor que portsPerClient (0 blocos por IP público)');
}

/** blocos de porta por IP público. */
export function blocksPerPublicIp(p: CgnatParams): number {
  return Math.floor((p.maxPort - p.portBase + 1) / p.portsPerClient);
}

/** Calcula capacidade e verifica se o bloco público comporta o CGNAT. */
export function capacity(p: CgnatParams): CgnatCapacity {
  assertParams(p);
  const bpp = blocksPerPublicIp(p);
  const publicCount = p.publicLast - p.publicFirst + 1n;
  const cgnatCount = p.cgnatLast - p.cgnatFirst + 1n;
  const cap = publicCount * BigInt(bpp);
  return {
    blocksPerPublicIp: bpp,
    publicCount,
    cgnatCount,
    capacity: cap,
    sufficient: cgnatCount <= cap,
    spare: cap - cgnatCount,
  };
}

/**
 * Mapeia UM IP privado (bigint) → (IP público, faixa de portas). Determinístico.
 * Lança se o IP privado estiver fora do bloco ou exceder a capacidade pública.
 */
export function mapPrivate(privateNum: bigint, p: CgnatParams): CgnatMapping {
  assertParams(p);
  if (privateNum < p.cgnatFirst || privateNum > p.cgnatLast)
    throw new Error('IP privado fora do bloco CGNAT');
  const bpp = BigInt(blocksPerPublicIp(p));
  const i = privateNum - p.cgnatFirst;
  const publicIndex = i / bpp;
  const slot = i % bpp;
  const publicNum = p.publicFirst + publicIndex;
  if (publicNum > p.publicLast)
    throw new Error('capacidade pública excedida para este IP privado');
  const portStart = p.portBase + Number(slot) * p.portsPerClient;
  const portEnd = portStart + p.portsPerClient - 1;
  return { privateNum, publicNum, portStart, portEnd };
}

/**
 * Operação INVERSA: dado um IP público (bigint) + uma porta, resolve qual IP
 * privado estava mapeado. O(1), sem tocar em banco. Retorna `null` se a porta
 * cair fora dos blocos usáveis ou o resultado sair do bloco CGNAT.
 */
export function reverseLookup(publicNum: bigint, port: number, p: CgnatParams): bigint | null {
  assertParams(p);
  if (publicNum < p.publicFirst || publicNum > p.publicLast) return null;
  if (port < p.portBase || port > p.maxPort) return null;
  const bpp = blocksPerPublicIp(p);
  const slot = Math.floor((port - p.portBase) / p.portsPerClient);
  if (slot >= bpp) return null; // porta na "sobra" acima do último bloco
  const publicIndex = publicNum - p.publicFirst;
  const i = publicIndex * BigInt(bpp) + BigInt(slot);
  const privateNum = p.cgnatFirst + i;
  if (privateNum > p.cgnatLast) return null;
  return privateNum;
}

/**
 * Gera TODAS as entradas do mapeamento (lazy). O chamador decide materializar
 * ou limitar — pra /10 privado são milhões de linhas, então itere em lotes.
 * Só percorre até min(cgnatCount, capacity) IPs privados.
 */
export function* iterate(p: CgnatParams): Generator<CgnatMapping> {
  assertParams(p);
  const bpp = BigInt(blocksPerPublicIp(p));
  const cap = capacity(p);
  const limit = cap.sufficient ? cap.cgnatCount : cap.capacity;
  for (let i = 0n; i < limit; i++) {
    const publicIndex = i / bpp;
    const slot = i % bpp;
    const portStart = p.portBase + Number(slot) * p.portsPerClient;
    yield {
      privateNum: p.cgnatFirst + i,
      publicNum: p.publicFirst + publicIndex,
      portStart,
      portEnd: portStart + p.portsPerClient - 1,
    };
  }
}
