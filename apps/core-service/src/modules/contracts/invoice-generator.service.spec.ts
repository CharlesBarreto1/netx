import { Logger } from '@nestjs/common';

import { InvoiceGeneratorService } from './invoice-generator.service';

/**
 * Regressão do incidente de 19/06/2026: um bug no pagamento (corrigido em
 * b8c6f55) empurrou `prepaidUntil` 1 mês além do que a fatura cobria. O
 * gerador, que usa esse campo como próximo vencimento, pulou o ciclo de julho
 * em silêncio — 5 contratos ficaram sem cobrança e só descobrimos quando o
 * cliente foi pagar no balcão.
 *
 * O alerta não corrige o ciclo; ele garante que um buraco desses não volte a
 * passar despercebido.
 */
describe('InvoiceGeneratorService — alerta de ciclo não faturado', () => {
  const TENANT = 'tenant-1';
  const NOW = new Date('2026-07-21T00:00:00.000Z');

  let service: InvoiceGeneratorService;
  let prisma: {
    contract: { findMany: jest.Mock; update: jest.Mock; count: jest.Mock };
    contractInvoice: { findFirst: jest.Mock; create: jest.Mock; groupBy: jest.Mock };
  };
  let errorSpy: jest.SpyInstance;

  const contract = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'ct-1',
    tenantId: TENANT,
    paymentMode: 'PREPAID',
    monthlyValue: 125000,
    dueDay: 10,
    cycleAnchorDay: 19,
    // Fora da janela LEAD_DAYS (15d a partir de 21/07) → o gerador dá `continue`.
    prepaidUntil: new Date('2026-08-19T00:00:00.000Z'),
    activatedAt: new Date('2026-06-19T00:00:00.000Z'),
    invoices: [],
    ...over,
  });

  beforeEach(() => {
    prisma = {
      contract: { findMany: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      contractInvoice: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    service = new InvoiceGeneratorService(prisma as never);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('denuncia prepaidUntil à frente da cobertura faturada', async () => {
    // Exatamente o estado de ZUX-38: pagou 19/06→19/07, mas o campo foi
    // adiantado pra 19/08. O ciclo de julho nunca virou fatura.
    prisma.contract.findMany.mockResolvedValue([contract()]);
    prisma.contractInvoice.groupBy.mockResolvedValue([
      { contractId: 'ct-1', _max: { periodEnd: new Date('2026-07-19T00:00:00.000Z') } },
    ]);

    const created = await service.generateUpcoming(NOW);

    expect(created).toBe(0); // fora da janela: o skip silencioso do bug original
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('ciclo não faturado'),
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ct-1'));
  });

  it('fica calado quando a cobertura alcança prepaidUntil', async () => {
    prisma.contract.findMany.mockResolvedValue([contract()]);
    prisma.contractInvoice.groupBy.mockResolvedValue([
      { contractId: 'ct-1', _max: { periodEnd: new Date('2026-08-19T00:00:00.000Z') } },
    ]);

    await service.generateUpcoming(NOW);

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('ignora faturas CANCELLED ao medir cobertura', async () => {
    // groupBy filtra CANCELLED; se uma fatura cancelada contasse como
    // cobertura, o buraco real ficaria mascarado.
    prisma.contract.findMany.mockResolvedValue([contract()]);
    prisma.contractInvoice.groupBy.mockResolvedValue([
      { contractId: 'ct-1', _max: { periodEnd: new Date('2026-07-19T00:00:00.000Z') } },
    ]);

    await service.generateUpcoming(NOW);

    expect(prisma.contractInvoice.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: 'CANCELLED' } }),
      }),
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ciclo não faturado'));
  });

  it('não alerta contrato sem nenhuma fatura (caso do auto-cura)', async () => {
    prisma.contract.findMany.mockResolvedValue([contract()]);
    prisma.contractInvoice.groupBy.mockResolvedValue([]);

    await service.generateUpcoming(NOW);

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('denuncia PREPAID ativo vencido e sem fatura em aberto', async () => {
    prisma.contract.findMany.mockResolvedValue([]);
    prisma.contract.count.mockResolvedValue(3);

    await service.generateUpcoming(NOW);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('nenhuma fatura em aberto'),
    );
  });
});
