import { MODULE_CODES } from './licensing';
import { allManifests, defineModule, getManifest, resolveLoadOrder } from './manifest';

describe('module manifest', () => {
  it('manifesto default = descritor do catálogo, sem metadados de runtime', () => {
    const m = getManifest('netx-erp');
    expect(m.code).toBe('netx-erp');
    expect(m.name).toBe('ERP base');
    expect(m.hardDeps).toEqual([]);
    expect(m.apiPrefixes).toBeUndefined();
    expect(m.emits).toBeUndefined();
  });

  it('defineModule anexa metadados de runtime (aditivo)', () => {
    const m = defineModule('netx-rh', { apiPrefixes: ['/hr'], emits: ['netx-rh.x.y'] });
    expect(m.apiPrefixes).toEqual(['/hr']);
    expect(m.emits).toEqual(['netx-rh.x.y']);
    // base do catálogo preservada
    expect(m.code).toBe('netx-rh');
    expect(m.softDeps).toEqual(['netx-erp']);
    // persiste no registry
    expect(getManifest('netx-rh').apiPrefixes).toEqual(['/hr']);
  });

  it('defineModule faz merge das chamadas sucessivas', () => {
    defineModule('netx-cpe', { apiPrefixes: ['/tr069'] });
    defineModule('netx-cpe', { emits: ['netx-cpe.ont.swapped'] });
    const m = getManifest('netx-cpe');
    expect(m.apiPrefixes).toEqual(['/tr069']);
    expect(m.emits).toEqual(['netx-cpe.ont.swapped']);
  });

  it('allManifests cobre todo o catálogo', () => {
    expect(allManifests().map((m) => m.code)).toEqual([...MODULE_CODES]);
  });
});

describe('resolveLoadOrder', () => {
  it('retorna todos os códigos (hardDeps hoje vazias => ordem do catálogo)', () => {
    expect(resolveLoadOrder()).toEqual([...MODULE_CODES]);
  });

  it('respeita um subconjunto', () => {
    expect(resolveLoadOrder(['netx-rh', 'netx-erp'])).toEqual(['netx-rh', 'netx-erp']);
  });
});
