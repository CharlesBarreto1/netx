import {
  allocateAssetTags,
  deriveAssetPrefix,
  formatAssetTag,
  isAssetTagCollision,
  withAssetTagRetry,
} from './asset-tag';

describe('asset-tag — prefixo', () => {
  it('deriva do slug quando o tenant não configurou', () => {
    expect(deriveAssetPrefix('zux')).toBe('ZUXPAT');
    expect(deriveAssetPrefix('minha-isp')).toBe('MINPAT');
  });

  it('ignora não-alfanuméricos e cai no fallback', () => {
    expect(deriveAssetPrefix('a-b')).toBe('ABPAT');
    expect(deriveAssetPrefix('---')).toBe('NTXPAT');
    expect(deriveAssetPrefix(null)).toBe('NTXPAT');
    expect(deriveAssetPrefix(undefined)).toBe('NTXPAT');
  });
});

describe('asset-tag — formato', () => {
  it('aplica padding de 6 dígitos', () => {
    expect(formatAssetTag('PAT', 1)).toBe('PAT-000001');
    expect(formatAssetTag('PAT', 123)).toBe('PAT-000123');
    expect(formatAssetTag('ZUXPAT', 999999)).toBe('ZUXPAT-999999');
  });

  it('não trunca acima da largura — etiqueta cresce em vez de colidir', () => {
    expect(formatAssetTag('PAT', 1234567)).toBe('PAT-1234567');
  });
});

describe('asset-tag — alocação', () => {
  function txStub(maxSeq: number | null, tenant: { slug?: string; assetPrefix?: string | null } = {}) {
    return {
      tenant: { findUnique: async () => ({ slug: tenant.slug ?? 'zux', assetPrefix: tenant.assetPrefix ?? null }) },
      serialItem: { aggregate: async () => ({ _max: { assetSeq: maxSeq } }) },
    } as never;
  }

  it('começa em 1 no tenant sem nenhum patrimônio', async () => {
    const tags = await allocateAssetTags(txStub(null), 't1', 2);
    expect(tags).toEqual([
      { assetSeq: 1, assetTag: 'ZUXPAT-000001' },
      { assetSeq: 2, assetTag: 'ZUXPAT-000002' },
    ]);
  });

  it('continua de MAX+1 e reserva o bloco inteiro', async () => {
    const tags = await allocateAssetTags(txStub(41), 't1', 3);
    expect(tags.map((t) => t.assetSeq)).toEqual([42, 43, 44]);
    expect(tags[2].assetTag).toBe('ZUXPAT-000044');
  });

  it('respeita o assetPrefix configurado pelo tenant', async () => {
    const tags = await allocateAssetTags(txStub(0, { assetPrefix: 'ALMOX' }), 't1', 1);
    expect(tags[0].assetTag).toBe('ALMOX-000001');
  });

  it('devolve vazio pra lançamento parcial sem seriais', async () => {
    expect(await allocateAssetTags(txStub(10), 't1', 0)).toEqual([]);
    expect(await allocateAssetTags(txStub(10), 't1', -1)).toEqual([]);
  });
});

describe('asset-tag — detecção de corrida', () => {
  it('reconhece P2002 nos únicos de patrimônio', () => {
    expect(isAssetTagCollision({ code: 'P2002', meta: { target: ['tenant_id', 'asset_seq'] } })).toBe(true);
    expect(isAssetTagCollision({ code: 'P2002', meta: { target: 'serial_items_tenant_asset_tag_key' } })).toBe(true);
  });

  it('não confunde com colisão de serial do fabricante', () => {
    expect(isAssetTagCollision({ code: 'P2002', meta: { target: ['tenant_id', 'product_id', 'serial'] } })).toBe(false);
  });

  it('ignora erro que não é P2002', () => {
    expect(isAssetTagCollision({ code: 'P2025' })).toBe(false);
    expect(isAssetTagCollision(new Error('boom'))).toBe(false);
    expect(isAssetTagCollision(null)).toBe(false);
  });
});

describe('asset-tag — retry', () => {
  const collision = { code: 'P2002', meta: { target: ['tenant_id', 'asset_seq'] } };

  it('re-tenta até passar', async () => {
    let calls = 0;
    const out = await withAssetTagRetry(async () => {
      calls += 1;
      if (calls < 3) throw collision;
      return 'ok';
    });
    expect(out).toBe('ok');
    expect(calls).toBe(3);
  });

  it('propaga erro que não é corrida, sem re-tentar', async () => {
    let calls = 0;
    await expect(
      withAssetTagRetry(async () => {
        calls += 1;
        throw new Error('saldo insuficiente');
      }),
    ).rejects.toThrow('saldo insuficiente');
    expect(calls).toBe(1);
  });

  it('desiste depois do teto e propaga a colisão', async () => {
    let calls = 0;
    await expect(
      withAssetTagRetry(async () => {
        calls += 1;
        throw collision;
      }, 2),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(calls).toBe(3); // tentativa inicial + 2 retries
  });
});
