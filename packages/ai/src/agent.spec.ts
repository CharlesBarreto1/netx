import { AiEngine } from './engine';
import type { AiEngineConfig, ToolDef } from './types';

function fakeResponse(ok: boolean, body: unknown, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

/** Anthropic: 1ª resposta pede tool_use; 2ª devolve texto final. */
const anthropicToolUse = (id: string, name: string, input: unknown) =>
  fakeResponse(true, {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id, name, input }],
  });
const anthropicText = (text: string) =>
  fakeResponse(true, { stop_reason: 'end_turn', content: [{ type: 'text', text }] });

function cfg(over: Partial<AiEngineConfig> = {}): AiEngineConfig {
  return {
    primary: { kind: 'anthropic', apiKey: 'sk-test', model: 'claude-haiku-4-5' },
    fallbackEnabled: false,
    defaultMaxTokens: 512,
    defaultTimeoutMs: 5000,
    redactPii: true,
    ...over,
  };
}

const TOOLS: ToolDef[] = [
  {
    name: 'get_overdue',
    description: 'Faturas vencidas',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
];

describe('AiEngine.agent', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('executa a ferramenta e compõe a resposta final (Anthropic)', async () => {
    fetchMock
      .mockResolvedValueOnce(anthropicToolUse('t1', 'get_overdue', {}))
      .mockResolvedValueOnce(anthropicText('Você tem R$ 1.234 vencidos.'));
    const ai = new AiEngine(cfg());

    const exec = jest.fn().mockResolvedValue({ total: 1234 });
    const r = await ai.agent(
      [{ role: 'user', content: 'Inadimplência?' }],
      TOOLS,
      exec,
      {},
      'copilot.ask',
    );

    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][0]).toMatchObject({ name: 'get_overdue' });
    expect(r.text).toContain('1.234');
    expect(r.toolsUsed).toEqual(['get_overdue']);
    expect(r.steps).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 2ª chamada já leva o tool_result no histórico
    const secondBody = JSON.parse((fetchMock.mock.calls[1] as [string, { body: string }])[1].body);
    expect(JSON.stringify(secondBody.messages)).toContain('tool_result');
  });

  it('responde direto quando o modelo não pede ferramenta', async () => {
    fetchMock.mockResolvedValueOnce(anthropicText('Olá!'));
    const ai = new AiEngine(cfg());
    const exec = jest.fn();
    const r = await ai.agent([{ role: 'user', content: 'oi' }], TOOLS, exec);
    expect(exec).not.toHaveBeenCalled();
    expect(r.text).toBe('Olá!');
    expect(r.steps).toBe(0);
  });

  it('supportsTools reflete o backend', () => {
    expect(new AiEngine(cfg()).supportsTools()).toBe(true);
    const ollamaOnly = new AiEngine(
      cfg({ primary: { kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'x' } }),
    );
    expect(ollamaOnly.supportsTools()).toBe(false);
  });

  it('lança quando nenhum backend suporta ferramentas', async () => {
    const ai = new AiEngine(
      cfg({ primary: { kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'x' } }),
    );
    await expect(ai.agent([{ role: 'user', content: 'oi' }], TOOLS, jest.fn())).rejects.toThrow(
      /suporte a ferramentas/,
    );
  });
});
