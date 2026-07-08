import { WIFI_PASSWORD_RULES, WifiPasswordSchema } from './types';

describe('WifiPasswordSchema (política de senha forte)', () => {
  it('aceita senha forte válida', () => {
    expect(WifiPasswordSchema.safeParse('Casa#2026x').success).toBe(true);
    expect(WifiPasswordSchema.safeParse('Zux!net99').success).toBe(true);
  });

  it('rejeita menos de 8 caracteres', () => {
    expect(WifiPasswordSchema.safeParse('Aa1!bc').success).toBe(false);
  });

  it('rejeita mais de 63 caracteres', () => {
    const long = 'Aa1!' + 'x'.repeat(60); // 64 chars
    expect(long.length).toBe(64);
    expect(WifiPasswordSchema.safeParse(long).success).toBe(false);
  });

  it('aceita exatamente 63 caracteres', () => {
    const at63 = 'Aa1!' + 'x'.repeat(59); // 63 chars
    expect(at63.length).toBe(63);
    expect(WifiPasswordSchema.safeParse(at63).success).toBe(true);
  });

  it('exige letra maiúscula', () => {
    expect(WifiPasswordSchema.safeParse('casa#2026x').success).toBe(false);
  });

  it('exige letra minúscula', () => {
    expect(WifiPasswordSchema.safeParse('CASA#2026X').success).toBe(false);
  });

  it('exige dígito', () => {
    expect(WifiPasswordSchema.safeParse('CasaForte#x').success).toBe(false);
  });

  it('exige caractere especial', () => {
    expect(WifiPasswordSchema.safeParse('CasaForte2026').success).toBe(false);
  });

  it('rejeita espaço (algumas ONTs recusam em silêncio)', () => {
    expect(WifiPasswordSchema.safeParse('Casa 2026#x').success).toBe(false);
  });

  it('rejeita acento / não-ASCII', () => {
    expect(WifiPasswordSchema.safeParse('Sençã2026#x').success).toBe(false);
    expect(WifiPasswordSchema.safeParse('Café2026#xX').success).toBe(false);
  });

  it('constantes expõem os limites documentados', () => {
    expect(WIFI_PASSWORD_RULES.minLength).toBe(8);
    expect(WIFI_PASSWORD_RULES.maxLength).toBe(63);
  });
});
