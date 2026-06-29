/**
 * Ferramentas de AÇÃO do chatbot de atendimento — escopadas a UM cliente (o
 * customer vinculado ao contato da conversa). São autônomas (o dono ligou o bot)
 * mas auditadas pelos próprios services chamados.
 *
 * Cada ação tem uma implementação "core" (retorna dado estruturado) usada pelos
 * DOIS caminhos do bot:
 *   - Menu determinístico: o motor formata o resultado e envia.
 *   - IA agêntica: o executor expõe a ação como tool; o LLM compõe a resposta.
 *
 * tenantId e customerId ficam FECHADOS no contexto — nunca vêm do modelo.
 */
import type { ToolCall, ToolDef, ToolExecutor } from '@netx/ai';

import type { BtgChargesService } from '../../btg/btg-charges.service';
import type { ContractsService } from '../../contracts/contracts.service';
import type { EfiChargesService } from '../../efi/efi-charges.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RadacctService } from '../../radius/radacct.service';
import type { ServiceOrdersService } from '../../service-orders/service-orders.service';

export interface BotActionDeps {
  prisma: PrismaService;
  efi: EfiChargesService;
  btg: BtgChargesService;
  contracts: ContractsService;
  serviceOrders: ServiceOrdersService;
  radacct: RadacctService;
}

export interface BotActionCtx {
  tenantId: string;
  customerId: string;
  /** Locale/moeda do provedor p/ formatar valores e datas (default pt-BR/BRL). */
  locale?: string;
  currency?: string;
}

const ACTOR = 'system:bot';

function money(v: unknown, ctx: BotActionCtx): string {
  return Number(v).toLocaleString(ctx.locale ?? 'pt-BR', {
    style: 'currency',
    currency: ctx.currency ?? 'BRL',
  });
}
function fmtDate(d: Date | string | null, ctx: BotActionCtx): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(ctx.locale ?? 'pt-BR');
}

// ---------------------------------------------------------------------------
// Ações "core" — retornam dado estruturado (sem efeito de envio no WhatsApp).
// ---------------------------------------------------------------------------

/** Faturas em aberto/vencidas do cliente (ignora notas de crédito). */
export async function listOpenInvoices(deps: BotActionDeps, ctx: BotActionCtx) {
  const rows = await deps.prisma.contractInvoice.findMany({
    where: {
      tenantId: ctx.tenantId,
      contract: { customerId: ctx.customerId },
      status: { in: ['OPEN', 'OVERDUE'] },
      amount: { gt: 0 },
    },
    orderBy: { dueDate: 'asc' },
    take: 12,
    include: { contract: { select: { code: true, brBillingGateway: true } } },
  });
  return rows.map((r) => ({
    invoiceId: r.id,
    contrato: r.contract.code ?? '—',
    valor: Number(r.amount),
    valorFmt: money(r.amount, ctx),
    vencimento: fmtDate(r.dueDate, ctx),
    status: r.status,
    gateway: r.contract.brBillingGateway,
  }));
}

export interface SegundaViaResult {
  ok: boolean;
  reason?: string;
  invoiceId?: string;
  valorFmt?: string;
  vencimento?: string;
  pix?: string | null;
  paymentLink?: string | null;
  barcode?: string | null;
}

/**
 * Gera a 2ª via (Pix) de uma fatura. Sem invoiceId, pega a mais antiga em
 * aberto/vencida. Usa o gateway do contrato (EFI/BTG); MANUAL não gera.
 */
export async function generateSegundaVia(
  deps: BotActionDeps,
  ctx: BotActionCtx,
  invoiceId?: string,
): Promise<SegundaViaResult> {
  const invoice = invoiceId
    ? await deps.prisma.contractInvoice.findFirst({
        where: { id: invoiceId, tenantId: ctx.tenantId, contract: { customerId: ctx.customerId } },
        include: { contract: { select: { brBillingGateway: true } } },
      })
    : await deps.prisma.contractInvoice.findFirst({
        where: {
          tenantId: ctx.tenantId,
          contract: { customerId: ctx.customerId },
          status: { in: ['OPEN', 'OVERDUE'] },
          amount: { gt: 0 },
        },
        orderBy: { dueDate: 'asc' },
        include: { contract: { select: { brBillingGateway: true } } },
      });

  if (!invoice) return { ok: false, reason: 'nenhuma fatura em aberto' };
  const gateway = invoice.contract.brBillingGateway;
  if (gateway === 'EFI') {
    const c = await deps.efi.createForInvoice(ctx.tenantId, ACTOR, invoice.id, { kind: 'PIX' });
    return {
      ok: true,
      invoiceId: invoice.id,
      valorFmt: money(invoice.amount, ctx),
      vencimento: fmtDate(invoice.dueDate, ctx),
      pix: c.pixCopiaECola,
      paymentLink: c.paymentLink,
      barcode: c.barcode,
    };
  }
  if (gateway === 'BTG') {
    const c = await deps.btg.createForInvoice(ctx.tenantId, ACTOR, invoice.id, { kind: 'PIX' });
    return {
      ok: true,
      invoiceId: invoice.id,
      valorFmt: money(invoice.amount, ctx),
      vencimento: fmtDate(invoice.dueDate, ctx),
      pix: c.pixEmv,
      paymentLink: c.paymentLink,
      barcode: c.digitableLine ?? c.barcode,
    };
  }
  return {
    ok: false,
    reason: 'gateway manual',
    invoiceId: invoice.id,
    valorFmt: money(invoice.amount, ctx),
    vencimento: fmtDate(invoice.dueDate, ctx),
  };
}

/** Status de conexão (online/offline) de cada contrato do cliente. */
export async function connectionStatus(deps: BotActionDeps, ctx: BotActionCtx) {
  const contracts = await deps.prisma.contract.findMany({
    where: { tenantId: ctx.tenantId, customerId: ctx.customerId, deletedAt: null },
    select: { id: true, code: true, status: true, suspendReason: true, pppoeUsername: true },
  });
  const out = [] as Array<{
    contrato: string;
    statusContrato: string;
    online: boolean | null;
    ip: string | null;
    uptimeHoras: number | null;
  }>;
  for (const c of contracts) {
    let session = null;
    try {
      session = await deps.radacct.getCurrentSession({
        pppoeUsername: c.pppoeUsername,
        macAddress: null,
        circuitId: null,
      });
    } catch {
      /* sem RADIUS/desconhecido */
    }
    out.push({
      contrato: c.code ?? '—',
      statusContrato: c.suspendReason ? `${c.status} (${c.suspendReason})` : c.status,
      online: session ? session.online : null,
      ip: session?.framedIp ?? null,
      uptimeHoras: session ? Math.round((session.uptimeSeconds / 3600) * 10) / 10 : null,
    });
  }
  return out;
}

export interface DesbloqueioResult {
  ok: boolean;
  reason?: string;
  contrato?: string;
  ate?: string;
}

/** Religue de confiança: estende o prazo de um contrato suspenso por dívida. */
export async function trustUnblock(
  deps: BotActionDeps,
  ctx: BotActionCtx,
  days = 5,
): Promise<DesbloqueioResult> {
  const target = await deps.prisma.contract.findFirst({
    where: {
      tenantId: ctx.tenantId,
      customerId: ctx.customerId,
      deletedAt: null,
      status: 'SUSPENDED',
      suspendReason: 'OVERDUE_PAYMENT',
    },
    select: { id: true, code: true },
  });
  if (!target) return { ok: false, reason: 'nenhum contrato bloqueado por dívida' };
  try {
    await deps.contracts.trustExtend(ctx.tenantId, ACTOR, target.id, {
      days,
      note: 'Religue de confiança solicitado pelo cliente via chatbot.',
    });
    const until = new Date();
    until.setDate(until.getDate() + days);
    return { ok: true, contrato: target.code ?? '—', ate: fmtDate(until, ctx) };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

export interface ChamadoResult {
  ok: boolean;
  reason?: string;
  code?: string;
}

/** Abre uma O.S. de suporte vinculada a um contrato ativo do cliente. */
export async function openTicket(
  deps: BotActionDeps,
  ctx: BotActionCtx,
  description: string,
): Promise<ChamadoResult> {
  const contract = await deps.prisma.contract.findFirst({
    where: { tenantId: ctx.tenantId, customerId: ctx.customerId, deletedAt: null },
    orderBy: { status: 'asc' },
    select: { id: true },
  });
  if (!contract) return { ok: false, reason: 'cliente sem contrato' };
  const reason = await deps.prisma.serviceOrderReason.findFirst({
    where: { tenantId: ctx.tenantId, isActive: true, kind: 'SUPPORT' },
    orderBy: { order: 'asc' },
    select: { id: true },
  });
  if (!reason) return { ok: false, reason: 'sem motivo de O.S. de suporte cadastrado' };
  try {
    const so = await deps.serviceOrders.create(ctx.tenantId, ACTOR, {
      contractId: contract.id,
      reasonId: reason.id,
      openDescription: description.slice(0, 4000) || 'Solicitação aberta pelo cliente via chatbot.',
    });
    return { ok: true, code: so.code ?? undefined };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Camada de IA: tools + executor (reusa as ações core).
// ---------------------------------------------------------------------------

export const BOT_TOOLS: ToolDef[] = [
  {
    name: 'minhas_faturas',
    description: 'Lista as faturas em aberto/vencidas do cliente desta conversa.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'segunda_via',
    description:
      'Gera a 2ª via (Pix copia-e-cola) de uma fatura. Sem invoiceId, usa a mais antiga em aberto.',
    parameters: {
      type: 'object',
      properties: { invoiceId: { type: 'string', description: 'ID da fatura (opcional)' } },
      additionalProperties: false,
    },
  },
  {
    name: 'status_conexao',
    description: 'Verifica se a conexão do cliente está online/offline e o status do contrato.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'desbloqueio_confianca',
    description:
      'Faz o religue de confiança (desbloqueio temporário) de um contrato suspenso por dívida.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'abrir_chamado',
    description: 'Abre uma ordem de serviço (chamado) de suporte para o cliente.',
    parameters: {
      type: 'object',
      properties: { descricao: { type: 'string', description: 'Resumo do problema relatado' } },
      required: ['descricao'],
      additionalProperties: false,
    },
  },
  {
    name: 'falar_com_atendente',
    description: 'Transfere a conversa para um atendente humano quando o cliente pedir.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
];

export interface BotExecutorState {
  handoff: boolean;
}

/** Monta o executor das tools do bot, fechando tenant/customer no contexto. */
export function buildBotExecutor(
  deps: BotActionDeps,
  ctx: BotActionCtx,
  state: BotExecutorState,
): ToolExecutor {
  return async (call: ToolCall) => {
    switch (call.name) {
      case 'minhas_faturas':
        return { faturas: await listOpenInvoices(deps, ctx) };
      case 'segunda_via':
        return generateSegundaVia(deps, ctx, call.args.invoiceId ? String(call.args.invoiceId) : undefined);
      case 'status_conexao':
        return { contratos: await connectionStatus(deps, ctx) };
      case 'desbloqueio_confianca':
        return trustUnblock(deps, ctx);
      case 'abrir_chamado':
        return openTicket(deps, ctx, String(call.args.descricao ?? ''));
      case 'falar_com_atendente':
        state.handoff = true;
        return { ok: true, obs: 'Transferindo para um atendente humano.' };
      default:
        return { erro: `ferramenta desconhecida: ${call.name}` };
    }
  };
}
