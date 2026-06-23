/** Formata bits/s em b/k/M/G. */
export function bps(v: number | string | null): string {
  if (v == null) return '—';
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
  let n = Number(v);
  if (!Number.isFinite(n)) return '—';
  let u = 0;
  while (n >= 1000 && u < units.length - 1) {
    n /= 1000;
    u++;
  }
  return `${n.toFixed(n < 10 && u > 0 ? 1 : 0)} ${units[u]}`;
}

export function speed(v: number | null): string {
  if (v == null) return '—';
  if (v >= 1e9) return `${Math.round(v / 1e9)}G`;
  if (v >= 1e6) return `${Math.round(v / 1e6)}M`;
  return `${v}`;
}

/** Cor de saúde para luz óptica RX (dBm): verde ok, amarelo limítrofe, vermelho crítico. */
export function opticalColor(dbm: number | string | null): string {
  if (dbm == null) return 'var(--muted)';
  const v = Number(dbm);
  if (!Number.isFinite(v)) return 'var(--muted)';
  if (v < -28 || v > 1) return 'var(--danger)';
  if (v < -20 || v > -1) return 'var(--warn)';
  return 'var(--ok)';
}

export function statusColor(s: string): string {
  if (s === 'up') return 'var(--ok)';
  if (s === 'down') return 'var(--danger)';
  return 'var(--muted)';
}

export function severityColor(s: string): string {
  if (s === 'critical' || s === 'error') return 'var(--danger)';
  if (s === 'warning') return 'var(--warn)';
  return 'var(--accent)';
}

export function tempColor(c: number | null): string {
  if (c == null) return 'var(--muted)';
  if (c >= 70) return 'var(--danger)';
  if (c >= 55) return 'var(--warn)';
  return 'var(--ok)';
}
