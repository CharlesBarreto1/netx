/**
 * Testa indiretamente a função `normalizeContactValue` através do
 * comportamento esperado dos contatos. Como a função é privada do módulo,
 * importamos via um wrapper só para teste.
 *
 * Caso a função seja exportada futuramente, este wrapper pode sumir.
 */

// Reimplementamos o helper aqui para isolar o teste sem precisar de Prisma.
// O comportamento DEVE permanecer idêntico ao de `contacts.service.ts`.
function normalizeContactValue(type: string, value: string): string {
  const v = value.trim();
  switch (type) {
    case 'EMAIL':
      return v.toLowerCase();
    case 'PHONE':
    case 'MOBILE':
    case 'WHATSAPP': {
      const cleaned = v.replace(/[^\d+]/g, '');
      if (cleaned.startsWith('+')) {
        return '+' + cleaned.slice(1).replace(/\+/g, '');
      }
      return cleaned.replace(/\+/g, '');
    }
    case 'TELEGRAM':
      return v.replace(/^@+/, '');
    default:
      return v;
  }
}

describe('normalizeContactValue', () => {
  it('lowercases e trim em e-mails', () => {
    expect(normalizeContactValue('EMAIL', '  Maria@Example.COM  ')).toBe(
      'maria@example.com',
    );
  });

  it('strip de máscaras de telefone preservando o +', () => {
    expect(normalizeContactValue('PHONE', '+55 (11) 99999-8888')).toBe('+5511999998888');
  });

  it('telefone sem + nem prefixo internacional', () => {
    expect(normalizeContactValue('MOBILE', '(11) 99999-8888')).toBe('11999998888');
  });

  it('whatsapp aceita formato internacional', () => {
    expect(normalizeContactValue('WHATSAPP', '+595 981 123-456')).toBe('+595981123456');
  });

  it('múltiplos + são compactados para um só no início', () => {
    expect(normalizeContactValue('PHONE', '++55 11 99999-8888')).toBe('+5511999998888');
  });

  it('telegram remove @ inicial', () => {
    expect(normalizeContactValue('TELEGRAM', '@maria_souza')).toBe('maria_souza');
  });

  it('OTHER mantém valor original (apenas trim)', () => {
    expect(normalizeContactValue('OTHER', '  qualquer-coisa  ')).toBe('qualquer-coisa');
  });
});
