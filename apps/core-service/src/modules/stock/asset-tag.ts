import type { Prisma } from '@prisma/client';

/**
 * Código de patrimônio (asset tag) do item serializado.
 *
 * Por que não basta o `serial`: o serial é do FABRICANTE. Só é único por
 * produto (`@@unique([tenantId, productId, serial])`), é editável via
 * `renameSerial`, e dois fornecedores diferentes podem repetir o mesmo número.
 * Nada disso serve de identidade patrimonial — a etiqueta colada no bem
 * precisa de um número da OPERAÇÃO: único no tenant, imutável, nunca reusado.
 *
 * Formato: "{Tenant.assetPrefix}-{assetSeq}" com padding em 6 dígitos
 * ("PAT-000123"). O padding é o que diferencia do código de contrato
 * ("ZUX-1", sem padding): etiqueta é lida por humano e por scanner, e largura
 * fixa evita ambiguidade de leitura e ordena direito alfabeticamente.
 *
 * Alocação: MAX(assetSeq)+1 dentro da transação, protegido pelos únicos
 * parciais em `serial_items`. É o mesmo contrato de `Contract.seq/code` —
 * sob corrida, a segunda transação leva P2002 e o chamador re-tenta. Preferido
 * a um contador em coluna porque não introduz linha quente nem mecanismo novo.
 */

/** Largura do sequencial na etiqueta. 6 dígitos = 999.999 bens por tenant. */
const SEQ_WIDTH = 6;

/**
 * Prefixo default quando o tenant ainda não configurou um `assetPrefix`:
 * 3 primeiros alfanuméricos do slug, em maiúsculas, sufixados por "PAT" pra
 * não colidir visualmente com o código de contrato. Fallback "NTXPAT".
 */
export function deriveAssetPrefix(slug?: string | null): string {
  const base = (slug ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return `${base.slice(0, 3) || 'NTX'}PAT`;
}

/** "PAT" + 123 → "PAT-000123". */
export function formatAssetTag(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(SEQ_WIDTH, '0')}`;
}

export interface AllocatedAssetTag {
  assetSeq: number;
  assetTag: string;
}

/**
 * Reserva um bloco de `count` códigos de patrimônio para o tenant.
 *
 * Deve rodar DENTRO da transação que cria os SerialItems — o MAX+1 só vale
 * enquanto a transação estiver aberta, e o único é quem arbitra a corrida.
 * Retorna [] se count <= 0 (lançamento parcial de compra sem seriais).
 *
 * O chamador é responsável por tratar P2002 em `asset_seq`/`asset_tag` como
 * corrida e re-tentar a operação inteira (ver PurchasesService.create).
 */
export async function allocateAssetTags(
  tx: Prisma.TransactionClient,
  tenantId: string,
  count: number,
): Promise<AllocatedAssetTag[]> {
  if (count <= 0) return [];

  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { slug: true, assetPrefix: true },
  });
  const prefix = tenant?.assetPrefix?.trim() || deriveAssetPrefix(tenant?.slug);

  // MAX+1 no tenant inteiro (não por produto): o patrimônio é da operação, não
  // do SKU. Itens antigos com assetSeq NULL são ignorados pelo _max.
  const agg = await tx.serialItem.aggregate({
    where: { tenantId },
    _max: { assetSeq: true },
  });
  const base = (agg._max.assetSeq ?? 0) + 1;

  return Array.from({ length: count }, (_, i) => ({
    assetSeq: base + i,
    assetTag: formatAssetTag(prefix, base + i),
  }));
}

/**
 * Roda `fn` re-tentando quando duas entradas simultâneas colidem no
 * sequencial de patrimônio. Envolve APENAS a transação — as validações de
 * entrada já rodaram e não precisam repetir.
 *
 * Loop em vez de recursão de propósito: o método público não ganha um
 * parâmetro `attempt` só de plumbing, e o TS infere o retorno sem anotação.
 */
export async function withAssetTagRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isAssetTagCollision(err) && attempt < maxRetries) continue;
      throw err;
    }
  }
}

/**
 * True se o erro do Prisma é colisão do sequencial de patrimônio — sinal de
 * corrida entre duas entradas simultâneas, e não de dado inválido do operador.
 */
export function isAssetTagCollision(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } };
  if (e?.code !== 'P2002') return false;
  const target = Array.isArray(e.meta?.target)
    ? e.meta.target.join(',')
    : String(e.meta?.target ?? '');
  return target.includes('asset_seq') || target.includes('asset_tag');
}
