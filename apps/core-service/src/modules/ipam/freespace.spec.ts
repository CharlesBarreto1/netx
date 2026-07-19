import { parseCidr } from './ip.util';
import {
  freeRanges,
  freeSpace,
  firstFreeSubnet,
  rangeToCidrs,
  splitIntoSubnets,
  type NumRange,
} from './freespace';

/** Açúcar: CIDR string → range numérico. */
const r = (cidr: string): NumRange => {
  const p = parseCidr(cidr);
  return { first: p.first, last: p.last };
};
const cidrs = (blocks: { cidr: string }[]) => blocks.map((b) => b.cidr);

describe('rangeToCidrs', () => {
  it('devolve um único bloco quando o range já é um CIDR alinhado', () => {
    const { blocks } = rangeToCidrs(r('10.0.0.0/24').first, r('10.0.0.0/24').last, 4);
    expect(cidrs(blocks)).toEqual(['10.0.0.0/24']);
  });

  it('decompõe range não-alinhado no menor conjunto de blocos', () => {
    // 10.0.0.1–10.0.0.6 não é um CIDR. O alinhamento limita o começo (.1 só
    // aceita /32) e o fim limita o tamanho: em .4 um /30 cobriria .4–.7, mas .7
    // está fora do range — então sai /31 + /32.
    const { blocks } = rangeToCidrs(r('10.0.0.1/32').first, r('10.0.0.6/32').first, 4);
    expect(cidrs(blocks)).toEqual([
      '10.0.0.1/32',
      '10.0.0.2/31',
      '10.0.0.4/31',
      '10.0.0.6/32',
    ]);
  });

  it('cobre o espaço de endereçamento inteiro como /0', () => {
    const { blocks } = rangeToCidrs(0n, (1n << 32n) - 1n, 4);
    expect(cidrs(blocks)).toEqual(['0.0.0.0/0']);
  });

  it('trunca no limite pedido', () => {
    const res = rangeToCidrs(r('10.0.0.1/32').first, r('10.0.0.6/32').first, 4, 2);
    expect(res.truncated).toBe(true);
    expect(res.blocks).toHaveLength(2);
  });
});

describe('freeRanges', () => {
  it('sem filhos, o pai inteiro está livre', () => {
    expect(freeRanges(r('10.0.0.0/24'), [])).toEqual([r('10.0.0.0/24')]);
  });

  it('acha buracos antes, entre e depois dos filhos', () => {
    const gaps = freeRanges(r('10.0.0.0/22'), [r('10.0.1.0/24'), r('10.0.2.0/24')]);
    expect(gaps).toEqual([r('10.0.0.0/24'), r('10.0.3.0/24')]);
  });

  it('não devolve buraco quando os filhos preenchem o pai', () => {
    expect(freeRanges(r('10.0.0.0/23'), [r('10.0.0.0/24'), r('10.0.1.0/24')])).toEqual([]);
  });

  it('tolera filhos fora de ordem', () => {
    const gaps = freeRanges(r('10.0.0.0/22'), [r('10.0.3.0/24'), r('10.0.1.0/24')]);
    expect(gaps).toEqual([r('10.0.0.0/24'), r('10.0.2.0/24')]);
  });

  it('funde filhos aninhados sem retroceder o cursor', () => {
    // Um /25 dentro de um /24 não pode reabrir espaço já consumido.
    const gaps = freeRanges(r('10.0.0.0/23'), [r('10.0.0.0/24'), r('10.0.0.128/25')]);
    expect(gaps).toEqual([r('10.0.1.0/24')]);
  });

  it('ignora ocupantes fora do pai e recorta os que cruzam a borda', () => {
    const gaps = freeRanges(r('10.0.0.0/24'), [r('192.168.0.0/24'), r('10.0.0.0/23')]);
    expect(gaps).toEqual([]);
  });
});

describe('freeSpace', () => {
  it('soma o total livre mesmo com vários buracos', () => {
    const fs = freeSpace(r('10.0.0.0/22'), [r('10.0.1.0/24')], 4);
    expect(fs.totalFree).toBe(768n); // 1024 - 256
    expect(cidrs(fs.blocks)).toEqual(['10.0.0.0/24', '10.0.2.0/23']);
    expect(fs.truncated).toBe(false);
  });

  it('devolve lista vazia quando não há espaço', () => {
    const fs = freeSpace(r('10.0.0.0/24'), [r('10.0.0.0/24')], 4);
    expect(fs.blocks).toEqual([]);
    expect(fs.totalFree).toBe(0n);
  });

  it('contabiliza o total mesmo truncando a lista', () => {
    const fs = freeSpace(r('10.0.0.0/24'), [r('10.0.0.1/32')], 4, 1);
    expect(fs.truncated).toBe(true);
    expect(fs.blocks).toHaveLength(1);
    expect(fs.totalFree).toBe(255n);
  });
});

describe('firstFreeSubnet', () => {
  it('acha o primeiro /24 livre num /22 parcialmente usado', () => {
    const b = firstFreeSubnet(r('10.0.0.0/22'), [r('10.0.0.0/24')], 4, 24);
    expect(b?.cidr).toBe('10.0.1.0/24');
  });

  it('respeita alinhamento: buraco grande mas mal posicionado não serve', () => {
    // Livre = 10.0.0.128–10.0.1.255 (384 endereços), mas nenhum /23 alinhado
    // cabe ali — o /23 candidato começaria em 10.0.0.0, que está ocupado.
    const occupied = [r('10.0.0.0/25')];
    expect(firstFreeSubnet(r('10.0.0.0/23'), occupied, 4, 23)).toBeNull();
    // Um /24 cabe: 10.0.1.0/24.
    expect(firstFreeSubnet(r('10.0.0.0/23'), occupied, 4, 24)?.cidr).toBe('10.0.1.0/24');
  });

  it('devolve null quando o prefixo está cheio', () => {
    expect(firstFreeSubnet(r('10.0.0.0/24'), [r('10.0.0.0/24')], 4, 30)).toBeNull();
  });

  it('devolve null se a subrede pedida é maior que o próprio pai', () => {
    expect(firstFreeSubnet(r('10.0.0.0/24'), [], 4, 16)).toBeNull();
  });

  it('rejeita prefixLen fora do range da versão', () => {
    expect(firstFreeSubnet(r('10.0.0.0/24'), [], 4, 33)).toBeNull();
    expect(firstFreeSubnet(r('10.0.0.0/24'), [], 4, -1)).toBeNull();
  });

  it('acha o próximo /30 de P2P pulando os já alocados', () => {
    const occupied = [r('10.255.0.0/30'), r('10.255.0.4/30'), r('10.255.0.8/30')];
    expect(firstFreeSubnet(r('10.255.0.0/24'), occupied, 4, 30)?.cidr).toBe('10.255.0.12/30');
  });
});

describe('IPv6 — mesmo código, números grandes', () => {
  it('acha o próximo /64 dentro de um /48', () => {
    const b = firstFreeSubnet(r('2001:db8::/48'), [r('2001:db8::/64')], 6, 64);
    expect(b?.cidr).toBe('2001:db8:0:1::/64');
  });

  it('calcula o total livre de um /48 com um /64 alocado', () => {
    const fs = freeSpace(r('2001:db8::/48'), [r('2001:db8::/64')], 6);
    // 2^80 endereços no /48, menos 2^64 do /64 alocado.
    expect(fs.totalFree).toBe((1n << 80n) - (1n << 64n));
  });

  it('decompõe corretamente um buraco em v6', () => {
    const fs = freeSpace(r('2001:db8::/48'), [r('2001:db8::/64')], 6);
    expect(cidrs(fs.blocks)[0]).toBe('2001:db8:0:1::/64');
  });
});

describe('splitIntoSubnets', () => {
  it('fatia um /22 em quatro /24', () => {
    const { blocks } = splitIntoSubnets(r('10.0.0.0/22'), [], 4, 24);
    expect(cidrs(blocks)).toEqual([
      '10.0.0.0/24',
      '10.0.1.0/24',
      '10.0.2.0/24',
      '10.0.3.0/24',
    ]);
  });

  it('pula o que já está ocupado', () => {
    const { blocks } = splitIntoSubnets(r('10.0.0.0/22'), [r('10.0.1.0/24')], 4, 24);
    expect(cidrs(blocks)).toEqual(['10.0.0.0/24', '10.0.2.0/24', '10.0.3.0/24']);
  });

  it('trunca em faixas absurdas em vez de explodir', () => {
    const res = splitIntoSubnets(r('2001:db8::/48'), [], 6, 64, 10);
    expect(res.truncated).toBe(true);
    expect(res.blocks).toHaveLength(10);
  });
});
