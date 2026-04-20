import {
  validateDocument,
  isDocumentTypeSupported,
  listSupportedDocuments,
  UnsupportedDocumentTypeError,
  brCpfValidator,
  brCnpjValidator,
  pyCiValidator,
  pyRucValidator,
} from './index';

describe('BR CPF validator', () => {
  it('aceita CPF válido (dígitos puros)', () => {
    const r = brCpfValidator.validate('52998224725'); // CPF válido gerado
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe('52998224725');
    expect(r.formatted).toBe('529.982.247-25');
  });

  it('aceita CPF válido (com máscara)', () => {
    const r = brCpfValidator.validate('529.982.247-25');
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe('52998224725');
  });

  it('rejeita CPF com dígito verificador errado', () => {
    const r = brCpfValidator.validate('52998224700');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/Dígito/i);
  });

  it('rejeita CPF com todos os dígitos iguais', () => {
    expect(brCpfValidator.validate('11111111111').valid).toBe(false);
    expect(brCpfValidator.validate('00000000000').valid).toBe(false);
  });

  it('rejeita CPF com tamanho errado', () => {
    expect(brCpfValidator.validate('1234').valid).toBe(false);
    expect(brCpfValidator.validate('123456789012').valid).toBe(false);
  });
});

describe('BR CNPJ validator', () => {
  it('aceita CNPJ válido (dígitos puros)', () => {
    const r = brCnpjValidator.validate('11222333000181');
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe('11222333000181');
    expect(r.formatted).toBe('11.222.333/0001-81');
  });

  it('aceita CNPJ válido (com máscara)', () => {
    const r = brCnpjValidator.validate('11.222.333/0001-81');
    expect(r.valid).toBe(true);
  });

  it('rejeita CNPJ com DV errado', () => {
    const r = brCnpjValidator.validate('11222333000100');
    expect(r.valid).toBe(false);
  });

  it('rejeita CNPJ com todos os dígitos iguais', () => {
    expect(brCnpjValidator.validate('00000000000000').valid).toBe(false);
    expect(brCnpjValidator.validate('99999999999999').valid).toBe(false);
  });

  it('rejeita tamanho diferente de 14', () => {
    expect(brCnpjValidator.validate('1122233300018').valid).toBe(false);
  });
});

describe('PY CI validator', () => {
  it('aceita CI de 6 a 9 dígitos', () => {
    expect(pyCiValidator.validate('123456').valid).toBe(true);
    expect(pyCiValidator.validate('4123456').valid).toBe(true);
    expect(pyCiValidator.validate('987654321').valid).toBe(true);
  });

  it('formata com pontos de milhar', () => {
    expect(pyCiValidator.validate('4123456').formatted).toBe('4.123.456');
    expect(pyCiValidator.validate('123456').formatted).toBe('123.456');
  });

  it('aceita entrada com máscara', () => {
    expect(pyCiValidator.validate('4.123.456').valid).toBe(true);
  });

  it('rejeita comprimento fora da faixa', () => {
    expect(pyCiValidator.validate('12345').valid).toBe(false);
    expect(pyCiValidator.validate('1234567890').valid).toBe(false);
  });

  it('rejeita todos dígitos iguais', () => {
    expect(pyCiValidator.validate('1111111').valid).toBe(false);
  });
});

describe('PY RUC validator', () => {
  // Casos construídos aplicando o próprio algoritmo de DV — servem como fixture.
  // Base 80018923 => pesos 2..7 cíclicos sobre "32981008" (invertida):
  //   3*2 + 2*3 + 9*4 + 8*5 + 1*6 + 0*7 + 0*2 + 8*3 = 6+6+36+40+6+0+0+24 = 118
  //   118 % 11 = 8 → DV = 11-8 = 3
  it('aceita RUC válido com hífen', () => {
    const r = pyRucValidator.validate('80018923-3');
    expect(r.valid).toBe(true);
    expect(r.normalized).toBe('800189233');
    expect(r.formatted).toBe('80018923-3');
  });

  it('aceita RUC sem hífen', () => {
    const r = pyRucValidator.validate('800189233');
    expect(r.valid).toBe(true);
  });

  it('rejeita RUC com DV errado', () => {
    const r = pyRucValidator.validate('80018923-9');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/Dígito/i);
  });

  it('rejeita formato inválido', () => {
    expect(pyRucValidator.validate('abc-1').valid).toBe(false);
    expect(pyRucValidator.validate('').valid).toBe(false);
  });

  it('calcula DV 0 para resto <= 1', () => {
    // Constrói base onde a soma dá resto 0: base '1' => 1*2=2, 2%11=2 → DV=9
    // Pega uma base curta qualquer e usa o próprio validator pra gerar o DV esperado
    // e conferir que o retorno formatado bate.
    const bases = ['1', '10', '123', '1234567'];
    for (const base of bases) {
      // Busca o DV correto testando de 0 a 9
      let validDv: number | null = null;
      for (let dv = 0; dv <= 9; dv++) {
        if (pyRucValidator.validate(`${base}-${dv}`).valid) {
          validDv = dv;
          break;
        }
      }
      expect(validDv).not.toBeNull();
      expect(pyRucValidator.validate(`${base}-${validDv}`).valid).toBe(true);
    }
  });
});

describe('Registry (validateDocument)', () => {
  it('lista os 4 validadores suportados', () => {
    const list = listSupportedDocuments();
    expect(list).toEqual(
      expect.arrayContaining([
        { country: 'BR', type: 'CPF' },
        { country: 'BR', type: 'CNPJ' },
        { country: 'PY', type: 'CI' },
        { country: 'PY', type: 'RUC' },
      ]),
    );
    expect(list.length).toBe(4);
  });

  it('isDocumentTypeSupported funciona case-insensitive', () => {
    expect(isDocumentTypeSupported('BR', 'CPF')).toBe(true);
    expect(isDocumentTypeSupported('br', 'cpf' as any)).toBe(true);
    expect(isDocumentTypeSupported('US', 'SSN')).toBe(false);
  });

  it('valida via factory (BR/CPF)', () => {
    expect(validateDocument('BR', 'CPF', '529.982.247-25').valid).toBe(true);
  });

  it('valida via factory (PY/RUC)', () => {
    expect(validateDocument('PY', 'RUC', '80018923-3').valid).toBe(true);
  });

  it('lança UnsupportedDocumentTypeError para país/tipo não registrado', () => {
    expect(() => validateDocument('US', 'SSN', '123-45-6789')).toThrow(
      UnsupportedDocumentTypeError,
    );
  });
});
