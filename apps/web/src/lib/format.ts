/**
 * Formatadores de exibição para a UI.
 * Normalização de entrada para o backend deve ser feita lá (o backend
 * mantém o valor canônico em dígitos).
 */

export function formatCPF(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatCNPJ(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function formatPYRUC(value: string): string {
  // RUC paraguaio: dígitos + '-' + DV (1 dígito)
  const d = value.replace(/[^\dKk]/g, '');
  if (d.length <= 1) return d;
  return `${d.slice(0, d.length - 1)}-${d.slice(-1)}`;
}

export function formatTaxId(type: string | null | undefined, value: string | null | undefined): string {
  if (!value) return '—';
  switch (type) {
    case 'CPF':
      return formatCPF(value);
    case 'CNPJ':
      return formatCNPJ(value);
    case 'RUC':
      return formatPYRUC(value);
    default:
      return value;
  }
}

export function formatPhone(value: string | null | undefined): string {
  if (!value) return '—';
  // Mantém o + inicial; o resto é agrupado de forma simples.
  const plus = value.startsWith('+');
  const d = value.replace(/\D/g, '');
  if (!d) return value;
  if (plus && d.length >= 12) {
    // +55 11 99999-8888
    return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return value;
}

export function formatDate(iso: string | null | undefined, locale = 'pt-BR'): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(locale);
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string | null | undefined, locale = 'pt-BR'): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(locale);
  } catch {
    return iso;
  }
}

/**
 * Símbolos forçados por moeda. O Intl às vezes devolve "R$" pra BRL no pt-BR
 * mas "BRL" em outros locales; e devolve "PYG" pro guarani em pt-BR. Como o
 * usuário sempre quer ver o símbolo nativo, sobrescrevemos por aqui.
 *
 * Convenção pedida pelo cliente:
 *   - BRL → R$
 *   - PYG → ₲
 *   - USD → U$  (informal brasileiro; o padrão Intl seria "US$")
 *   - EUR → €
 *   - ARS → $   (Intl já retorna $; mantido por consistência)
 */
const CURRENCY_SYMBOL: Record<string, string> = {
  BRL: 'R$',
  PYG: '₲',
  USD: 'U$',
  EUR: '€',
  ARS: '$',
  COP: '$',
  MXN: '$',
};

/**
 * Casas decimais default por moeda. Guarani não tem centavos, então 0.
 * Demais moedas usam 2 (Intl resolve o resto).
 */
const CURRENCY_DECIMALS: Record<string, number> = {
  PYG: 0,
};

/**
 * Formata dinheiro. Quando `short`, colapsa em k/M para cards (R$ 12,3 k / ₲ 1,2 M).
 *
 * Estratégia: forçamos o símbolo via `CURRENCY_SYMBOL` em vez de delegar pro
 * Intl, porque o Intl varia de locale pra locale. Para o número em si, ainda
 * usamos `Intl.NumberFormat` style `decimal` pra ter agrupamento e separadores
 * locale-aware.
 */
export function formatMoney(
  value: number | null | undefined,
  currency = 'BRL',
  opts: { short?: boolean; locale?: string; decimals?: number } = {},
): string {
  const locale = opts.locale ?? 'pt-BR';
  const v = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const symbol = CURRENCY_SYMBOL[currency] ?? currency;
  const decimals =
    opts.decimals ?? CURRENCY_DECIMALS[currency] ?? 2;

  if (opts.short) {
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (abs >= 1_000_000)
      return `${sign}${symbol} ${(abs / 1_000_000).toLocaleString(locale, {
        maximumFractionDigits: 1,
      })} M`;
    if (abs >= 1_000)
      return `${sign}${symbol} ${(abs / 1_000).toLocaleString(locale, {
        maximumFractionDigits: 1,
      })} k`;
    return `${sign}${symbol} ${abs.toLocaleString(locale, {
      maximumFractionDigits: 0,
    })}`;
  }

  try {
    const num = v.toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return `${symbol} ${num}`;
  } catch {
    return `${symbol} ${v.toFixed(decimals)}`;
  }
}

export function relativeTime(iso: string | null | undefined, locale = 'pt-BR'): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const now = Date.now();
  const diff = Math.round((then - now) / 1000);
  const absSec = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (absSec < 60) return rtf.format(diff, 'second');
  if (absSec < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (absSec < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (absSec < 604_800) return rtf.format(Math.round(diff / 86400), 'day');
  if (absSec < 2_592_000) return rtf.format(Math.round(diff / 604_800), 'week');
  if (absSec < 31_536_000) return rtf.format(Math.round(diff / 2_592_000), 'month');
  return rtf.format(Math.round(diff / 31_536_000), 'year');
}
