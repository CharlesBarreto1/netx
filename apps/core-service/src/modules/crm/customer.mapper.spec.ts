import { computeDisplayName } from './customer.mapper';

describe('computeDisplayName', () => {
  describe('INDIVIDUAL', () => {
    it('junta nome e sobrenome', () => {
      expect(
        computeDisplayName({
          type: 'INDIVIDUAL',
          firstName: 'Maria',
          lastName: 'Souza',
        }),
      ).toBe('Maria Souza');
    });

    it('aceita apenas nome', () => {
      expect(
        computeDisplayName({ type: 'INDIVIDUAL', firstName: 'Ana', lastName: null }),
      ).toBe('Ana');
    });

    it('faz trim e ignora campos vazios', () => {
      expect(
        computeDisplayName({
          type: 'INDIVIDUAL',
          firstName: '  Carlos  ',
          lastName: '',
        }),
      ).toBe('Carlos');
    });

    it('ignora null para firstName', () => {
      expect(
        computeDisplayName({ type: 'INDIVIDUAL', firstName: null, lastName: 'Silva' }),
      ).toBe('Silva');
    });
  });

  describe('COMPANY', () => {
    it('prefere tradeName quando presente', () => {
      expect(
        computeDisplayName({
          type: 'COMPANY',
          companyName: 'Acme Soluções LTDA',
          tradeName: 'Acme',
        }),
      ).toBe('Acme');
    });

    it('cai para companyName quando tradeName nulo', () => {
      expect(
        computeDisplayName({
          type: 'COMPANY',
          companyName: 'Acme Soluções LTDA',
          tradeName: null,
        }),
      ).toBe('Acme Soluções LTDA');
    });

    it('aceita apenas companyName', () => {
      expect(
        computeDisplayName({
          type: 'COMPANY',
          companyName: 'Servicios del Sur S.A.',
        }),
      ).toBe('Servicios del Sur S.A.');
    });

    it('trim no resultado', () => {
      expect(
        computeDisplayName({
          type: 'COMPANY',
          companyName: '   Servicios   ',
        }),
      ).toBe('Servicios');
    });
  });
});
