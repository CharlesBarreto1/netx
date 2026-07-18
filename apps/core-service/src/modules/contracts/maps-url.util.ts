/**
 * Extração de coordenadas a partir do link público de localização
 * (Contract.installationMapsUrl, o "Enlace de ubicación" do cadastro).
 *
 * Motivação: o mapa comercial (/v1/mapping/customers) só plota contrato com
 * latitude/longitude preenchidos, mas na prática o atendente cola o link do
 * Google Maps e não marca o pino no LocationPicker — o contrato some do mapa.
 * Estes helpers derivam a coordenada do próprio link.
 *
 * O shortlink `maps.app.goo.gl/XXXX` NÃO carrega coordenada no texto: só a URL
 * final (depois do redirect) tem. Por isso `resolveMapsUrlCoords` faz rede;
 * `extractMapsUrlCoords` é puro e resolve os links longos sem sair da máquina.
 */

export interface MapsCoords {
  latitude: number;
  longitude: number;
}

/** Número decimal com sinal, usado nos padrões abaixo. */
const DEC = String.raw`-?\d+(?:\.\d+)?`;

/**
 * Padrões de coordenada na URL do Maps, em ordem de precisão:
 *  1. `!3d<lat>!4d<lng>` — pino do place. É o alvo real; preferir sempre.
 *  2. `?q=<lat>,<lng>`   — coordenada explícita (links compartilhados pelo app
 *                          mobile, os que vêm com `g_st=ic`).
 *  3. `?ll=<lat>,<lng>`  — forma antiga da API de links.
 *  4. `@<lat>,<lng>`     — CENTRO DO VIEWPORT, não o pino: costuma ficar
 *                          algumas centenas de metros fora. Último recurso.
 */
const COORD_PATTERNS: readonly RegExp[] = [
  new RegExp(`!3d(${DEC})!4d(${DEC})`),
  new RegExp(`[?&]q=(${DEC}),(${DEC})`),
  new RegExp(`[?&]ll=(${DEC}),(${DEC})`),
  new RegExp(`@(${DEC}),(${DEC})`),
];

/**
 * Hosts cujo redirect aceitamos seguir. O link vem de input do operador, então
 * sem allowlist isso viraria um SSRF: bastaria cadastrar um contrato apontando
 * pra rede interna pra usar o core-service como proxy.
 */
const REDIRECT_ALLOWED_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|maps\.google\.[a-z.]+|(www\.)?google\.[a-z.]+)$/;

const RESOLVE_TIMEOUT_MS = 6000;

function isPlausible(latitude: number, longitude: number): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  // Ilha Nula: quase sempre parsing errado, não um cliente no golfo da Guiné.
  if (latitude === 0 && longitude === 0) return false;
  return true;
}

/**
 * Lê a coordenada de uma URL do Maps já expandida. Puro (sem rede).
 * Devolve null quando a URL é shortlink ou não casa com nenhum padrão.
 */
export function extractMapsUrlCoords(url: string | null | undefined): MapsCoords | null {
  if (!url) return null;
  // A URL final vem percent-encoded (`%2C`, `%C2%B0`…); decodifica pra os
  // padrões casarem. Link com `%` solto quebra decodeURIComponent — cai no cru.
  let text = url;
  try {
    text = decodeURIComponent(url);
  } catch {
    text = url;
  }
  for (const pattern of COORD_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (!isPlausible(latitude, longitude)) continue;
    return { latitude, longitude };
  }
  return null;
}

/** True se o link é de host do Google Maps que vale seguir o redirect. */
export function isResolvableMapsUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    return REDIRECT_ALLOWED_HOSTS.test(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Resolve a coordenada do link, seguindo o redirect quando for shortlink.
 * Best-effort: NUNCA lança — link privado, host fora da allowlist, timeout ou
 * formato novo devolvem null e o chamador segue sem coordenada.
 */
export async function resolveMapsUrlCoords(url: string | null | undefined): Promise<MapsCoords | null> {
  if (!url) return null;

  // Link longo já traz a coordenada: resolve sem tocar na rede.
  const direct = extractMapsUrlCoords(url);
  if (direct) return direct;

  if (!isResolvableMapsUrl(url)) return null;

  try {
    // Só interessa a URL final (`res.url`) — o corpo é descartado. GET em vez
    // de HEAD porque o shortlink do Maps nem sempre honra HEAD. UA próprio só
    // pra nos identificarmos; o redirect não depende dele.
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; NetX/1.0)' },
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    });
    await res.body?.cancel();
    return extractMapsUrlCoords(res.url);
  } catch {
    return null;
  }
}
