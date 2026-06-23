import {
  ALL_MODULE_CODES,
  MODULE_CATALOG,
  entitledModules,
  isModuleCode,
  isModuleEntitled,
} from './licensing';

describe('core-sdk licensing façade', () => {
  it('reexporta o catálogo de módulos do @netx/shared', () => {
    expect(MODULE_CATALOG['netx-erp'].code).toBe('netx-erp');
    expect(ALL_MODULE_CODES).toContain('netx-rh');
    expect(isModuleCode('netx-cpe')).toBe(true);
    expect(isModuleCode('bogus')).toBe(false);
  });

  describe('entitledModules (regra de compatibilidade)', () => {
    it('token sem claim => catálogo inteiro', () => {
      expect(entitledModules(null)).toEqual([...ALL_MODULE_CODES]);
      expect(entitledModules({})).toEqual([...ALL_MODULE_CODES]);
      expect(entitledModules({ modules: [] })).toEqual([...ALL_MODULE_CODES]);
    });

    it('claim com subconjunto válido => exatamente esse subconjunto', () => {
      expect(entitledModules({ modules: ['netx-rh'] })).toEqual(['netx-rh']);
    });

    it('claim só com códigos desconhecidos => fallback p/ tudo (não bloqueia pagante)', () => {
      expect(entitledModules({ modules: ['inexistente'] })).toEqual([...ALL_MODULE_CODES]);
    });

    it('filtra desconhecidos misturados com válidos', () => {
      expect(entitledModules({ modules: ['netx-rh', 'xpto'] })).toEqual(['netx-rh']);
    });
  });

  it('isModuleEntitled respeita o claim', () => {
    expect(isModuleEntitled({ modules: ['netx-rh'] }, 'netx-rh')).toBe(true);
    expect(isModuleEntitled({ modules: ['netx-rh'] }, 'netx-cpe')).toBe(false);
    // sem claim libera tudo
    expect(isModuleEntitled(null, 'netx-cpe')).toBe(true);
  });
});
