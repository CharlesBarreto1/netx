import { AiEngine } from './engine';
import type { AiEngineConfig, AiUsageEvent } from './types';

type FetchArgs = [input: string, init: { body: string }];

/** Resposta fake no shape mínimo que os providers leem. */
function fakeResponse(ok: boolean, body: unknown, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const ollamaOk = (content: string) =>
  fakeResponse(true, { message: { content }, prompt_eval_count: 10, eval_count: 5 });
const anthropicOk = (text: string) =>
  fakeResponse(true, { content: [{ type: 'text', text }], usage: { input_tokens: 3, output_tokens: 7 } });

function baseConfig(over: Partial<AiEngineConfig> = {}): AiEngineConfig {
  return {
    primary: { kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b' },
    fallback: { kind: 'anthropic', apiKey: 'sk-test', model: 'claude-haiku-4-5' },
    fallbackEnabled: true,
    defaultMaxTokens: 256,
    defaultTimeoutMs: 5000,
    redactPii: true,
    ...over,
  };
}

describe('AiEngine', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('usa o provider primário (Ollama) e devolve o texto', async () => {
    fetchMock.mockResolvedValueOnce(ollamaOk('olá mundo'));
    const ai = new AiEngine(baseConfig());

    const r = await ai.chat([{ role: 'user', content: 'oi' }]);

    expect(r.text).toBe('olá mundo');
    expect(r.provider).toBe('ollama');
    expect(r.usedFallback).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as FetchArgs)[0]).toContain('/api/chat');
  });

  it('json() força schema e devolve objeto parseado', async () => {
    fetchMock.mockResolvedValueOnce(ollamaOk('{"sev":"crit","n":3}'));
    const ai = new AiEngine(baseConfig());

    const out = await ai.json<{ sev: string; n: number }>(
      [{ role: 'user', content: 'classifique' }],
      { type: 'object', properties: { sev: { type: 'string' }, n: { type: 'number' } } },
    );

    expect(out).toEqual({ sev: 'crit', n: 3 });
    const body = JSON.parse((fetchMock.mock.calls[0] as FetchArgs)[1].body);
    expect(body.format).toBeDefined(); // Ollama: structured output nativo
  });

  it('cai pro fallback quando o primário falha', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce(anthropicOk('resposta da nuvem'));
    const ai = new AiEngine(baseConfig());

    const r = await ai.chat([{ role: 'user', content: 'oi' }]);

    expect(r.text).toBe('resposta da nuvem');
    expect(r.provider).toBe('anthropic');
    expect(r.usedFallback).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('mascara PII antes de enviar ao backend de nuvem', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(anthropicOk('ok'));
    const ai = new AiEngine(baseConfig());

    await ai.chat([
      { role: 'user', content: 'cliente joao@ex.com CPF 123.456.789-09 tel (11) 91234-5678' },
    ]);

    const cloudBody = JSON.parse((fetchMock.mock.calls[1] as FetchArgs)[1].body);
    const sent = JSON.stringify(cloudBody);
    expect(sent).toContain('[EMAIL]');
    expect(sent).toContain('[CPF]');
    expect(sent).not.toContain('joao@ex.com');
    expect(sent).not.toContain('123.456.789-09');
  });

  it('NÃO mascara quando o primário (local) responde', async () => {
    fetchMock.mockResolvedValueOnce(ollamaOk('ok'));
    const ai = new AiEngine(baseConfig());

    await ai.chat([{ role: 'user', content: 'email joao@ex.com' }]);

    const body = JSON.parse((fetchMock.mock.calls[0] as FetchArgs)[1].body);
    expect(JSON.stringify(body)).toContain('joao@ex.com'); // local: sem redaction
  });

  it('lança quando nenhum backend está disponível', async () => {
    const ai = new AiEngine(
      baseConfig({
        primary: { kind: 'anthropic', apiKey: '', model: 'x' }, // sem key
        fallbackEnabled: false,
        fallback: undefined,
      }),
    );
    await expect(ai.chat([{ role: 'user', content: 'oi' }])).rejects.toThrow(/indisponível/);
  });

  it('emite evento de uso no logger', async () => {
    fetchMock.mockResolvedValueOnce(ollamaOk('ok'));
    const events: AiUsageEvent[] = [];
    const ai = new AiEngine(baseConfig({ logger: { onUsage: (e) => events.push(e) } }));

    await ai.chat([{ role: 'user', content: 'oi' }], {}, 'teste.feature');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ provider: 'ollama', ok: true, feature: 'teste.feature' });
  });

  it('describe() reflete a topologia', () => {
    const ai = new AiEngine(baseConfig());
    const d = ai.describe();
    expect(d.primary.kind).toBe('ollama');
    expect(d.fallback?.kind).toBe('anthropic');
    expect(d.available).toBe(true);
  });
});
