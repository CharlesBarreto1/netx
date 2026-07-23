/**
 * CÓPIA LOCAL de @netx/shared/provisioning/ont-serial (o ACS não depende de
 * @netx/shared por design — manter em sincronia). Normalização de serial GPON: o Hubsoft (e os equipamentos) guardam o
 * MESMO serial em formatos diferentes, e o casamento por string literal falha.
 *
 * Dois formatos observados na base real:
 *   - "amigável": 4 letras ASCII do Vendor ID + sufixo hex.  Ex.: HWTC6BA990AA
 *     (usado por serviço.phy_addr, OLT/phy_id, cadastro de CPE)
 *   - "hex puro": os 4 bytes do Vendor ID em hex + o mesmo sufixo. Ex.:
 *     485754436BA990AA  (48575443 = "HWTC")  (usado pelo comodato/patrimônio)
 *
 * "HWTC6ba990aa" e "485754436BA990AA" são o MESMO equipamento. Aqui geramos as
 * DUAS formas canônicas de qualquer serial, para casar por interseção — não
 * importa em que formato cada uma das 4 fontes (serviço, comodato, OLT, CPE)
 * gravou.
 *
 * Vendor IDs GPON conhecidos (4 chars ASCII → 8 hex):
 *   HWTC=48575443 (Huawei), ZTEG=5A544547 (ZTE), FHTT=46485454 (Fiberhome),
 *   PRKS=50524B53 (Parks), DACM=4441434D (Datacom), MKPG=4D4B5047 (Parks/MKPG),
 *   ALCL=414C434C (Nokia), CXNK=43584E4B (…). A conversão é genérica: qualquer
 *   prefixo de 8 hex que decodifique para 4 chars ASCII imprimíveis vira letras.
 */

const HEX8 = /^[0-9A-Fa-f]{8}/;

/** upper + só alfanumérico (base comum antes de qualquer conversão de formato). */
function baseNorm(s: string): string {
  return (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** 4 primeiros bytes hex → 4 chars ASCII, se todos imprimíveis (A-Z0-9). */
function hexPrefixToAscii(hex8: string): string | null {
  let out = '';
  for (let i = 0; i < 8; i += 2) {
    const code = parseInt(hex8.slice(i, i + 2), 16);
    const ch = String.fromCharCode(code);
    if (!/[A-Za-z0-9]/.test(ch)) return null; // não é um Vendor ID textual
    out += ch;
  }
  return out.toUpperCase();
}

/** 4 chars ASCII → 8 hex. */
function asciiPrefixToHex(ascii4: string): string {
  let out = '';
  for (const ch of ascii4) out += ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
  return out;
}

/**
 * Retorna as formas canônicas de um serial: sempre a "amigável" e a "hex".
 * Se o serial não casa nenhum dos padrões reconhecíveis, devolve só a base
 * normalizada (para não perder o caso comum de serial já limpo).
 */
export function ontSerialForms(raw: string): { friendly: string; hex: string; all: string[] } {
  const s = baseNorm(raw);
  if (!s) return { friendly: '', hex: '', all: [] };

  // Caso 1: começa com 4 letras ASCII (A-Z) — formato amigável.
  //   HWTC6BA990AA → hex = 48575443 + 6BA990AA
  if (/^[A-Z]{4}/.test(s)) {
    const friendly = s;
    const hex = asciiPrefixToHex(s.slice(0, 4)) + s.slice(4);
    return { friendly, hex, all: uniq([friendly, hex]) };
  }

  // Caso 2: começa com 8 hex que decodificam para 4 letras ASCII — formato hex.
  //   485754436BA990AA → ascii = HWTC + 6BA990AA
  if (HEX8.test(s)) {
    const asc = hexPrefixToAscii(s.slice(0, 8));
    if (asc && /^[A-Z]{4}$/.test(asc)) {
      const friendly = asc + s.slice(8);
      const hex = s;
      return { friendly, hex, all: uniq([friendly, hex]) };
    }
  }

  // Não reconhecido — usa a base como está (nada a converter).
  return { friendly: s, hex: s, all: [s] };
}

/** Chave canônica única de um serial (usa a forma amigável — legível). */
export function ontSerialKey(raw: string): string {
  return ontSerialForms(raw).friendly;
}

/**
 * Todas as chaves que representam um serial (amigável + hex + base). Use para
 * indexar/casar por INTERSEÇÃO: dois seriais são a mesma ONT se compartilham
 * qualquer chave.
 */
export function ontSerialKeys(raw: string): string[] {
  return ontSerialForms(raw).all;
}

function uniq(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}
