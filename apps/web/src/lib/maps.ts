/**
 * Helpers de navegação por mapa.
 *
 * `buildMapsNavUrl` monta uma URL universal de DIREÇÕES do Google Maps. No
 * celular (app do técnico / PWA), abrir essa URL aciona o app nativo do Google
 * Maps em modo navegação; no desktop, abre o Maps no navegador. Prioriza
 * coordenadas (pino exato) e cai pro endereço textual quando não há pino.
 */
export function buildMapsNavUrl(dest: {
  latitude?: number | null;
  longitude?: number | null;
  installationAddress?: string | null;
}): string | null {
  if (dest.latitude != null && dest.longitude != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${dest.latitude},${dest.longitude}&travelmode=driving`;
  }
  const addr = dest.installationAddress?.trim();
  if (addr) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}&travelmode=driving`;
  }
  return null;
}
