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
