/**
 * Testa o parser de coordenada do link de localização do contrato.
 *
 * As URLs longas dos casos abaixo são as URLs FINAIS reais devolvidas pelo
 * redirect de `maps.app.goo.gl` (capturadas do parque PY em 2026-07-18) —
 * é exatamente o texto que `resolveMapsUrlCoords` entrega pro parser.
 */

import {
  extractMapsUrlCoords,
  isResolvableMapsUrl,
  resolveMapsUrlCoords,
} from './maps-url.util';

describe('extractMapsUrlCoords', () => {
  it('prefere o pino (!3d/!4d) ao centro do viewport (@)', () => {
    // Caso real: o @ aponta -55.2512089, o pino -55.248634 (~250 m de erro).
    const url =
      "https://www.google.com/maps/place/25%C2%B025'40.4%22S+55%C2%B014'55.1%22W/" +
      '@-25.427896,-55.2512089,760m/data=!3m2!1e3!4b1!4m4!3m3!8m2!3d-25.427896!4d-55.248634';
    expect(extractMapsUrlCoords(url)).toEqual({
      latitude: -25.427896,
      longitude: -55.248634,
    });
  });

  it('lê o formato ?q=lat,lng dos links compartilhados pelo app mobile', () => {
    const url = 'https://www.google.com/maps?q=-25.4224760,-55.2622600&entry=gps&g_st=ic';
    expect(extractMapsUrlCoords(url)).toEqual({
      latitude: -25.422476,
      longitude: -55.26226,
    });
  });

  it('cai no centro do viewport quando não há pino nem q=', () => {
    const url = 'https://www.google.com/maps/@-25.5097,-54.6111,15z';
    expect(extractMapsUrlCoords(url)).toEqual({
      latitude: -25.5097,
      longitude: -54.6111,
    });
  });

  it('devolve null pro shortlink (a coordenada só existe após o redirect)', () => {
    expect(extractMapsUrlCoords('https://maps.app.goo.gl/HxbAHbWMgFZYipdY9')).toBeNull();
  });

  it('devolve null pra entrada vazia ou sem coordenada', () => {
    expect(extractMapsUrlCoords(null)).toBeNull();
    expect(extractMapsUrlCoords(undefined)).toBeNull();
    expect(extractMapsUrlCoords('')).toBeNull();
    expect(extractMapsUrlCoords('https://example.com/onde-fica')).toBeNull();
  });

  it('rejeita coordenada fora de faixa e a Ilha Nula', () => {
    expect(extractMapsUrlCoords('https://www.google.com/maps?q=-91.5,-55.2')).toBeNull();
    expect(extractMapsUrlCoords('https://www.google.com/maps?q=0,0')).toBeNull();
  });
});

describe('isResolvableMapsUrl', () => {
  it('aceita os hosts do Google Maps', () => {
    expect(isResolvableMapsUrl('https://maps.app.goo.gl/abc')).toBe(true);
    expect(isResolvableMapsUrl('https://goo.gl/maps/abc')).toBe(true);
    expect(isResolvableMapsUrl('https://www.google.com/maps/place/x')).toBe(true);
    expect(isResolvableMapsUrl('https://maps.google.com.py/?q=1,2')).toBe(true);
  });

  it('recusa host fora da allowlist — o link vem de input do operador (SSRF)', () => {
    expect(isResolvableMapsUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isResolvableMapsUrl('http://localhost:3000/v1/internal')).toBe(false);
    expect(isResolvableMapsUrl('https://evil.example.com/maps.app.goo.gl')).toBe(false);
    expect(isResolvableMapsUrl('file:///etc/passwd')).toBe(false);
    expect(isResolvableMapsUrl('nao-e-url')).toBe(false);
    expect(isResolvableMapsUrl(null)).toBe(false);
  });
});

describe('resolveMapsUrlCoords', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('não toca na rede quando o link já traz a coordenada', async () => {
    const spy = jest.fn();
    global.fetch = spy as unknown as typeof fetch;
    const coords = await resolveMapsUrlCoords(
      'https://www.google.com/maps/place/x/@-25.42,-55.25,760m/data=!3m2!8m2!3d-25.427896!4d-55.248634',
    );
    expect(coords).toEqual({ latitude: -25.427896, longitude: -55.248634 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('segue o redirect do shortlink e lê a URL final', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      url: 'https://www.google.com/maps/place/x/@-25.42,-55.25,760m/data=!3m2!8m2!3d-25.427896!4d-55.248634',
      body: null,
    }) as unknown as typeof fetch;
    await expect(resolveMapsUrlCoords('https://maps.app.goo.gl/HxbAHbWMgFZYipdY9')).resolves.toEqual({
      latitude: -25.427896,
      longitude: -55.248634,
    });
  });

  it('devolve null (sem lançar) quando a rede falha', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ETIMEDOUT')) as unknown as typeof fetch;
    await expect(resolveMapsUrlCoords('https://maps.app.goo.gl/abc')).resolves.toBeNull();
  });

  it('não faz request pra host fora da allowlist', async () => {
    const spy = jest.fn();
    global.fetch = spy as unknown as typeof fetch;
    await expect(resolveMapsUrlCoords('http://169.254.169.254/latest/')).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
