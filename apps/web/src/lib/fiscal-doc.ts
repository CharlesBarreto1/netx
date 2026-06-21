/**
 * Utilitários compartilhados pelos documentos imprimíveis (fatura / KuDE).
 */

/** Agrupa o CDC (44 díg.) em blocos de 4 pra leitura, igual ao KuDE da SET. */
export function formatCdc(cdc: string): string {
  return cdc.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Desglose de IVA paraguaio a partir de um total COM IVA incluso.
 * Ex.: total 125.000 a 10% → gravada 113.636, iva 11.364.
 * ratePct = 0 (exento) zera os dois.
 */
export function ivaBreakdown(
  total: number,
  ratePct: number,
): { gravada: number; iva: number } {
  if (!ratePct || ratePct <= 0) return { gravada: 0, iva: 0 };
  const gravada = Math.round(total / (1 + ratePct / 100));
  return { gravada, iva: total - gravada };
}
