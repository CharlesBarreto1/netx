/**
 * CDC — Código de Control (44 dígitos).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Identificador único do DTE, determinístico, gerado pelo emisor. Vai no
 * QR Code, na URL de consulta pública do SIFEN e no XML. Não pode ter
 * colisão (UNIQUE constraint no DB).
 *
 * Composição (Manual Técnico v150, item 5.10):
 *   pos 1-2:   Tipo de Documento (01=Factura, 04=Autofactura, 05=NC, 06=ND, 07=NR)
 *   pos 3-10:  RUC do emisor (8 dígitos com leading zeros)
 *   pos 11:    Dígito verificador do RUC
 *   pos 12-14: Establecimiento (3 dígitos)
 *   pos 15-17: Punto de Expedición (3 dígitos)
 *   pos 18-24: Número do documento (7 dígitos)
 *   pos 25:    Tipo de Emissão (1=Normal, 2=Contingência)
 *   pos 26-33: Data de emissão (AAAAMMDD)
 *   pos 34-42: Código de segurança (9 dígitos aleatórios)
 *   pos 43-44: Dígito verificador (módulo 11 sobre as 42 primeiras posições)
 *
 * Total: 44 caracteres numéricos.
 */

const TYPE_TO_CODE: Record<string, string> = {
  FACTURA: '01',
  AUTOFACTURA: '04',
  NOTA_CREDITO: '05',
  NOTA_DEBITO: '06',
  NOTA_REMISION: '07',
};

export interface CdcInput {
  /** Tipo do documento (FACTURA, NOTA_CREDITO, etc). */
  type: keyof typeof TYPE_TO_CODE | string;
  /** RUC do emisor no formato 'NNNNNNNN-D' (com DV) ou 'NNNNNNNN' (sem). */
  emisorRuc: string;
  /** Estabelecimento (3 dígitos, com zero à esquerda). */
  establecimiento: string;
  /** Punto de expedición (3 dígitos). */
  puntoExpedicion: string;
  /** Número sequencial (vira 7 dígitos com zero à esquerda). */
  numero: number;
  /** Tipo de emissão: 1=Normal (default), 2=Contingência. */
  tipoEmision?: 1 | 2;
  /** Data/hora de emissão. */
  issuedAt: Date;
  /** Código de segurança (9 dígitos). Se omitido, gera aleatório. */
  securityCode?: string;
}

/**
 * Gera o CDC completo (44 chars). Idempotente se você passar o mesmo
 * `securityCode` (use isso pra re-emissão após rejeição, mas com número
 * NOVO — número usado fica queimado).
 */
export function generateCdc(input: CdcInput): string {
  const tipoDoc = TYPE_TO_CODE[input.type];
  if (!tipoDoc) {
    throw new Error(`Tipo de documento inválido pra CDC: ${input.type}`);
  }

  // RUC: separa raiz e DV. Aceita "12345678-1" ou "12345678" (calcula DV).
  const rucClean = input.emisorRuc.replace(/[^0-9-]/g, '');
  const [rucRaw, dvRaw] = rucClean.split('-');
  const rucPadded = rucRaw.padStart(8, '0').slice(-8);
  const dv = dvRaw ?? calculateRucDv(rucRaw);

  const estab = input.establecimiento.padStart(3, '0').slice(-3);
  const punto = input.puntoExpedicion.padStart(3, '0').slice(-3);
  const numStr = String(input.numero).padStart(7, '0').slice(-7);
  const tipoEm = String(input.tipoEmision ?? 1);

  // YYYYMMDD em UTC (SIFEN usa hora oficial paraguaia, mas pra CDC só importa
  // a data calendário do emisor — backend grava issuedAt em UTC, frontend
  // exibe em zona local).
  const d = input.issuedAt;
  const yyyy = String(d.getUTCFullYear()).padStart(4, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const dateStr = `${yyyy}${mm}${dd}`;

  const security = (input.securityCode ?? generateSecurityCode())
    .padStart(9, '0')
    .slice(-9);

  const base42 =
    tipoDoc + rucPadded + dv + estab + punto + numStr + tipoEm + dateStr + security;

  if (base42.length !== 42) {
    throw new Error(`CDC base com ${base42.length} chars, esperado 42`);
  }

  const dvCdc = calculateMod11Dv(base42);
  const cdc = base42 + dvCdc.padStart(2, '0');

  if (cdc.length !== 44) {
    throw new Error(`CDC final com ${cdc.length} chars, esperado 44`);
  }
  return cdc;
}

/**
 * Calcula o dígito verificador do RUC paraguaio (módulo 11, peso base 2).
 * Algoritmo padrão SET.
 */
export function calculateRucDv(rucRaw: string): string {
  const num = rucRaw.padStart(8, '0').slice(-8);
  let sum = 0;
  let factor = 2;
  for (let i = num.length - 1; i >= 0; i--) {
    sum += Number(num[i]) * factor;
    factor = factor < 7 ? factor + 1 : 2;
  }
  const mod = sum % 11;
  const dv = mod < 2 ? 0 : 11 - mod;
  return String(dv);
}

/**
 * DV do CDC: módulo 11 sobre as 42 posições com pesos 2..7 cíclicos.
 * Retorna 2 dígitos (com leading zero se < 10).
 *
 * Conforme Manual Técnico v150, seção 5.10.5.
 */
export function calculateMod11Dv(digits: string): string {
  let sum = 0;
  let factor = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = Number(digits[i]);
    if (Number.isNaN(d)) {
      throw new Error(`CDC contém não-dígito: '${digits[i]}'`);
    }
    sum += d * factor;
    factor = factor < 7 ? factor + 1 : 2;
  }
  const mod = sum % 11;
  const dv = mod < 2 ? 0 : 11 - mod;
  // Mod 11 retorna 0-10; pra 1 dígito (que é o caso), pad pra 2 chars.
  // SIFEN usa o DV como 2 caracteres no CDC final, então formatamos assim.
  return dv === 10 ? '10' : `0${dv}`.slice(-2);
}

/** Gera 9 dígitos aleatórios criptograficamente seguros (não previsível). */
function generateSecurityCode(): string {
  // 9 dígitos = ~30 bits de entropia, suficiente pra evitar colisão acidental
  // dentro do tenant. Em produção, o backend pode persistir e checar UNIQUE
  // antes de aceitar — improvável colidir com 1 bilhão de combinações.
  const bytes = new Uint8Array(8);
  // No Node 18+ globalThis.crypto está disponível.
  const cryptoApi =
    typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : null;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // Converte pra número e pega 9 dígitos.
  const big = bytes.reduce((acc, b) => acc * 256n + BigInt(b), 0n);
  return String(big % 1_000_000_000n).padStart(9, '0');
}

/** Formato de exibição: "001-001-0000001" (estab-punto-numero). */
export function formatNumeroDocumento(
  establecimiento: string,
  puntoExpedicion: string,
  numero: number,
): string {
  return `${establecimiento.padStart(3, '0')}-${puntoExpedicion.padStart(3, '0')}-${String(numero).padStart(7, '0')}`;
}
