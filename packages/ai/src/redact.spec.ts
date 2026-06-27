import { redact, redactMessages } from './redact';

describe('redact', () => {
  it('mascara e-mail, CPF, CNPJ e telefone', () => {
    const out = redact('joao@ex.com, CPF 123.456.789-09, CNPJ 12.345.678/0001-95, (11) 91234-5678');
    expect(out).toContain('[EMAIL]');
    expect(out).toContain('[CPF]');
    expect(out).toContain('[CNPJ]');
    expect(out).toContain('[TELEFONE]');
    expect(out).not.toMatch(/joao@ex\.com/);
    expect(out).not.toMatch(/123\.456\.789-09/);
  });

  it('preserva endereços IP (diagnóstico de rede depende deles)', () => {
    const out = redact('ONT em 192.168.1.10 e gateway 10.0.0.1');
    expect(out).toContain('192.168.1.10');
    expect(out).toContain('10.0.0.1');
  });

  it('é idempotente', () => {
    const once = redact('email a@b.com');
    expect(redact(once)).toBe(once);
  });

  it('redactMessages aplica em todas as mensagens', () => {
    const msgs = redactMessages([
      { role: 'system', content: 'sem pii' },
      { role: 'user', content: 'fale com a@b.com' },
    ]);
    expect(msgs[0].content).toBe('sem pii');
    expect(msgs[1].content).toContain('[EMAIL]');
  });
});
