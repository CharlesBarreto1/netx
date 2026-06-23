/** Formata bits/s de forma compacta para o dossiê do copiloto. */
export function bps(v: number | null): string {
  if (v == null) return '—';
  const u = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
  let n = Number(v);
  let i = 0;
  while (n >= 1000 && i < u.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
