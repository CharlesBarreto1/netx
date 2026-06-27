/**
 * Ferramentas read-only do copiloto agêntico. O modelo escolhe qual chamar; o
 * executor roda a consulta (tenant-scoped) e devolve dado real. NENHUMA tool
 * muta estado — a IA é conselheira.
 *
 * tenantId NUNCA é exposto ao modelo: vem fechado no executor (segurança +
 * isolamento multi-tenant).
 */
import type { Prisma } from '@prisma/client';

import type { ToolDef, ToolExecutor } from '@netx/ai';

import { PrismaService } from '../prisma/prisma.service';
import { RadacctService } from '../radius/radacct.service';

export const COPILOT_TOOLS: ToolDef[] = [
  {
    name: 'buscar_cliente',
    description:
      'Busca clientes por nome (ou parte do nome) e retorna seus contratos. Use primeiro para descobrir o id do cliente/contrato.',
    parameters: {
      type: 'object',
      properties: { termo: { type: 'string', description: 'Nome ou parte do nome do cliente' } },
      required: ['termo'],
      additionalProperties: false,
    },
  },
  {
    name: 'diagnostico_conexao',
    description:
      'Diagnostica a conexão de um cliente/contrato: status do contrato, sessão PPPoE (online/offline, última queda), sinal da ONT (RX/TX) e incidentes de rede que o afetam. Use para "por que o cliente está sem internet".',
    parameters: {
      type: 'object',
      properties: {
        contratoId: { type: 'string', description: 'id do contrato (preferível)' },
        clienteId: { type: 'string', description: 'id do cliente (usa os contratos dele)' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'inadimplencia',
    description:
      'Resumo financeiro de faturas em aberto e vencidas (inadimplência). Opcionalmente filtra por cliente.',
    parameters: {
      type: 'object',
      properties: {
        clienteId: { type: 'string', description: 'opcional — limita a um cliente' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'incidentes_abertos',
    description:
      'Lista os incidentes de rede abertos (quedas correlacionadas por ONT/PON/CTO/cabo/OLT/bairro) com severidade e causa provável.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
];

interface ToolDeps {
  prisma: PrismaService;
  radacct: RadacctService;
  tenantId: string;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Constrói o executor com as deps fechadas (tenantId nunca vai pro modelo). */
export function buildCopilotExecutor({ prisma, radacct, tenantId }: ToolDeps): ToolExecutor {
  return async (call) => {
    switch (call.name) {
      case 'buscar_cliente': {
        const termo = String(call.args.termo ?? '').trim();
        if (!termo) return { erro: 'termo vazio' };
        const customers = await prisma.customer.findMany({
          where: {
            tenantId,
            deletedAt: null,
            displayName: { contains: termo, mode: 'insensitive' },
          },
          take: 8,
          select: {
            id: true,
            displayName: true,
            status: true,
            contracts: {
              where: { deletedAt: null },
              select: { id: true, code: true, status: true },
              take: 10,
            },
          },
        });
        return {
          encontrados: customers.length,
          clientes: customers.map((c) => ({
            clienteId: c.id,
            nome: c.displayName,
            status: c.status,
            contratos: c.contracts.map((ct) => ({
              contratoId: ct.id,
              codigo: ct.code,
              status: ct.status,
            })),
          })),
        };
      }

      case 'diagnostico_conexao': {
        const contratoId = call.args.contratoId ? String(call.args.contratoId) : null;
        const clienteId = call.args.clienteId ? String(call.args.clienteId) : null;
        if (!contratoId && !clienteId) return { erro: 'informe contratoId ou clienteId' };

        const contracts = await prisma.contract.findMany({
          where: {
            tenantId,
            deletedAt: null,
            ...(contratoId ? { id: contratoId } : {}),
            ...(clienteId ? { customerId: clienteId } : {}),
          },
          take: 5,
          select: {
            id: true,
            code: true,
            status: true,
            authMethod: true,
            pppoeUsername: true,
            macAddress: true,
            circuitId: true,
          },
        });
        if (contracts.length === 0) return { erro: 'nenhum contrato encontrado' };

        const diags = [];
        for (const ct of contracts) {
          const session = await radacct
            .getCurrentSession({
              pppoeUsername: ct.pppoeUsername,
              macAddress: ct.macAddress,
              circuitId: ct.circuitId,
            })
            .catch(() => null);

          const ont = await prisma.ont.findUnique({
            where: { contractId: ct.id },
            select: {
              id: true,
              status: true,
              lastRxPower: true,
              lastTxPower: true,
              lastSeenAt: true,
              snGpon: true,
              olt: { select: { name: true, status: true } },
            },
          });

          const incidents = ont
            ? await prisma.incident.findMany({
                where: {
                  tenantId,
                  status: 'OPEN',
                  OR: [{ scope: 'ONT', scopeRefId: ont.id }],
                },
                select: { scope: true, scopeLabel: true, severity: true, rootCause: true },
                take: 5,
              })
            : [];

          diags.push({
            contratoId: ct.id,
            codigo: ct.code,
            statusContrato: ct.status,
            autenticacao: ct.authMethod,
            sessao: session
              ? {
                  online: session.online,
                  desde: session.sessionStart,
                  ultimaQueda: session.sessionStop,
                  causaQueda: session.terminateCause,
                  uptimeSegundos: session.uptimeSeconds,
                  ip: session.framedIp,
                }
              : { online: false, obs: 'sem sessão RADIUS encontrada' },
            ont: ont
              ? {
                  status: ont.status,
                  rxPowerDbm: num(ont.lastRxPower),
                  txPowerDbm: num(ont.lastTxPower),
                  ultimoContato: ont.lastSeenAt,
                  olt: ont.olt?.name ?? null,
                  oltStatus: ont.olt?.status ?? null,
                }
              : { obs: 'contrato sem ONT vinculada' },
            incidentesAbertos: incidents.map((i) => ({
              escopo: i.scope,
              local: i.scopeLabel,
              severidade: i.severity,
              causaProvavel: i.rootCause,
            })),
          });
        }
        return { contratos: diags };
      }

      case 'inadimplencia': {
        const clienteId = call.args.clienteId ? String(call.args.clienteId) : null;
        const baseWhere: Prisma.ContractInvoiceWhereInput = {
          tenantId,
          status: { in: ['OPEN', 'OVERDUE'] },
          ...(clienteId ? { contract: { customerId: clienteId } } : {}),
        };
        const [tenant, emAberto, vencido] = await Promise.all([
          prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } }),
          prisma.contractInvoice.aggregate({ where: baseWhere, _sum: { amount: true }, _count: true }),
          prisma.contractInvoice.aggregate({
            where: { ...baseWhere, dueDate: { lt: new Date() } },
            _sum: { amount: true },
            _count: true,
          }),
        ]);
        return {
          moeda: tenant?.currency ?? null,
          totalEmAberto: num(emAberto._sum.amount) ?? 0,
          qtdEmAberto: emAberto._count,
          totalVencido: num(vencido._sum.amount) ?? 0,
          qtdVencidas: vencido._count,
          escopo: clienteId ? 'cliente' : 'tenant',
        };
      }

      case 'incidentes_abertos': {
        const incidents = await prisma.incident.findMany({
          where: { tenantId, status: 'OPEN' },
          orderBy: { affectedCount: 'desc' },
          take: 20,
          select: {
            scope: true,
            scopeLabel: true,
            severity: true,
            rootCause: true,
            affectedCount: true,
            totalInScope: true,
          },
        });
        return {
          abertos: incidents.length,
          incidentes: incidents.map((i) => ({
            escopo: i.scope,
            local: i.scopeLabel,
            severidade: i.severity,
            causaProvavel: i.rootCause,
            afetados: i.affectedCount,
            totalNoEscopo: i.totalInScope,
          })),
        };
      }

      default:
        return { erro: `ferramenta desconhecida: ${call.name}` };
    }
  };
}
