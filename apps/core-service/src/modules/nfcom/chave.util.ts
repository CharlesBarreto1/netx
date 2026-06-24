/**
 * chave.util — chave de acesso da NFCom (44 dígitos) + dígito verificador.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Layout da chave NFCom (modelo 62), 44 posições (espelha o padrão NF3e/CT-e
 * mais novo, com nSiteAutoriz e nNF de 9 dígitos):
 *
 *   cUF(2) AAMM(4) CNPJ(14) mod(2) serie(3) nNF(9) tpEmis(1) nSiteAutoriz(1) cNF(7) cDV(1)
 *    = 2 + 4 + 14 + 2 + 3 + 9 + 1 + 1 + 7 + 1 = 44
 *
 * ⚠️ A ordem/tamanho dos campos DEVE bater com o XSD oficial da NT vigente
 *    (2026.002 RTC). Confirmar contra o schema antes da homologação — erro aqui
 *    = nota rejeitada (chave ≠ recalculada pelo SVRS).
 */

/** Códigos IBGE de UF (cUF) — usados no início da chave e no grupo ide. */
export const UF_CODE: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17',
  MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27',
  SE: '28', BA: '29', MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41',
  SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
};

export interface ChaveNfcomInput {
  uf: string;            // sigla (ex: "SP")
  issuedAt: Date;        // p/ AAMM
  cnpj: string;          // 14 dígitos
  serie: string;         // até 3 dígitos
  numero: number;        // nNF
  cNF: string;           // 7 dígitos (código numérico)
  tpEmis?: string;       // 1 = normal (default)
  nSiteAutoriz?: string; // 0 = SVRS (default)
  modelo?: string;       // 62 (default)
}

const onlyDigits = (s: string): string => s.replace(/\D/g, '');
const pad = (v: string | number, len: number): string =>
  String(v).replace(/\D/g, '').padStart(len, '0').slice(-len);

/**
 * Dígito verificador da chave — módulo 11, pesos 2..9 ciclando da direita
 * pra esquerda sobre os 43 primeiros dígitos. DV 0 ou 1 → 0 (regra SEFAZ).
 */
export function calcDvChave(chave43: string): string {
  const digits = onlyDigits(chave43);
  if (digits.length !== 43) {
    throw new Error(`calcDvChave: esperado 43 dígitos, recebido ${digits.length}`);
  }
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  const dv = 11 - rest;
  return dv >= 10 ? '0' : String(dv);
}

/** Monta a chave de acesso de 44 dígitos (com DV). */
export function buildChaveNfcom(input: ChaveNfcomInput): string {
  const cUF = UF_CODE[input.uf?.toUpperCase()];
  if (!cUF) throw new Error(`UF inválida para cUF: "${input.uf}"`);

  const yy = String(input.issuedAt.getFullYear()).slice(-2);
  const mm = String(input.issuedAt.getMonth() + 1).padStart(2, '0');
  const aamm = `${yy}${mm}`;

  const cnpj = pad(input.cnpj, 14);
  const mod = pad(input.modelo ?? '62', 2);
  const serie = pad(input.serie, 3);
  const nNF = pad(input.numero, 9);
  const tpEmis = pad(input.tpEmis ?? '1', 1);
  const nSite = pad(input.nSiteAutoriz ?? '0', 1);
  const cNF = pad(input.cNF, 7);

  const chave43 = `${cUF}${aamm}${cnpj}${mod}${serie}${nNF}${tpEmis}${nSite}${cNF}`;
  if (chave43.length !== 43) {
    throw new Error(`buildChaveNfcom: chave43 com ${chave43.length} dígitos (esperado 43)`);
  }
  return chave43 + calcDvChave(chave43);
}

/**
 * Gera o cNF (7 dígitos). Não pode ser igual ao nNF (regra do leiaute) e não
 * deve ser sequencial previsível. Recebe o número aleatório de fora pra manter
 * a função pura/testável.
 */
export function formatCnf(random7: number): string {
  return pad(Math.abs(random7) % 10_000_000, 7);
}

/** Formata a chave pra exibição em blocos de 4 (44 dígitos → 11 blocos). */
export function formatChaveDisplay(chave: string): string {
  const d = onlyDigits(chave);
  return d.match(/.{1,4}/g)?.join(' ') ?? d;
}
