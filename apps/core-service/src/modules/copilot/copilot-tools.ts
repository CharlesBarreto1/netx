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
import type { AiPendingTest } from '@netx/shared';

import { PrismaService } from '../prisma/prisma.service';
import { RadacctService } from '../radius/radacct.service';
import { NmsClient } from './nms-client';

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
  {
    name: 'dispositivos_rede',
    description:
      'Lista os equipamentos monitorados pelo NMS (switches/roteadores) com id, hostname, fabricante e status. Use para descobrir o id de um device antes de consultar tráfego/óptica.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'trafego_rede',
    description:
      'Tráfego ATUAL (últimos ~60min) das interfaces de um equipamento de rede (entrada/saída em Mbps, erros, status). Não tem histórico/pico — só o momento.',
    parameters: {
      type: 'object',
      properties: { deviceId: { type: 'string', description: 'id do device (de dispositivos_rede)' } },
      required: ['deviceId'],
      additionalProperties: false,
    },
  },
  {
    name: 'optica_rede',
    description:
      'Leituras ópticas (RX/TX em dBm, temperatura do módulo) das interfaces de um equipamento de rede.',
    parameters: {
      type: 'object',
      properties: { deviceId: { type: 'string', description: 'id do device (de dispositivos_rede)' } },
      required: ['deviceId'],
      additionalProperties: false,
    },
  },
  {
    name: 'executar_teste_rede',
    description:
      'Dispara um teste de rede ATIVO (ping ou traceroute) a um alvo. NÃO aguarde o resultado — ele chega ao operador automaticamente em segundos. Use para "faça um trace/ping pro X", "qual a latência pro 8.8.8.8". Por padrão roda do servidor (NOC); para rodar de um equipamento específico, informe "device" com o nome dele (ex.: "roteador de Barbosa Ferraz").',
    parameters: {
      type: 'object',
      properties: {
        testType: { type: 'string', enum: ['ping', 'traceroute'] },
        target: { type: 'string', description: 'IP ou host alvo (ex.: 8.8.8.8)' },
        source: { type: 'string', enum: ['host', 'device'], description: 'host = servidor NOC (padrão)' },
        device: { type: 'string', description: 'nome do equipamento (quando source=device)' },
      },
      required: ['testType', 'target'],
      additionalProperties: false,
    },
  },
];

interface ToolDeps {
  prisma: PrismaService;
  radacct: RadacctService;
  nms: NmsClient;
  tenantId: string;
  /** Bearer do operador, encaminhado ao NMS (ponte SSO). */
  authToken: string | null;
  /** Capturado quando a IA dispara um teste ativo (o Nexus faz polling). */
  context: { pendingTest?: AiPendingTest };
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** bps → Mbps com 1 casa (legível pro modelo). */
function mbps(bps: number | null): number | null {
  return bps == null ? null : Math.round((bps / 1e6) * 10) / 10;
}

/** Constrói o executor com as deps fechadas (tenantId nunca vai pro modelo). */
export function buildCopilotExecutor({
  prisma,
  radacct,
  nms,
  tenantId,
  authToken,
  context,
}: ToolDeps): ToolExecutor {
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

      case 'dispositivos_rede': {
        try {
          const devices = await nms.listDevices(authToken);
          return {
            total: devices.length,
            dispositivos: devices.map((d) => ({
              deviceId: d.id,
              hostname: d.hostname,
              fabricante: d.vendor,
              modelo: d.model,
              status: d.status,
            })),
          };
        } catch (e) {
          return { erro: e instanceof Error ? e.message : String(e) };
        }
      }

      case 'trafego_rede': {
        const deviceId = String(call.args.deviceId ?? '').trim();
        if (!deviceId) return { erro: 'informe deviceId' };
        try {
          const rates = await nms.interfaceRates(deviceId, authToken);
          const ativas = rates
            .filter((r) => (r.inBps ?? 0) > 0 || (r.outBps ?? 0) > 0 || (r.inErrors ?? 0) > 0)
            .sort((a, b) => (b.inBps ?? 0) + (b.outBps ?? 0) - ((a.inBps ?? 0) + (a.outBps ?? 0)))
            .slice(0, 15);
          return {
            obs: 'tráfego instantâneo (~últimos 60min); sem histórico/pico',
            interfaces: ativas.map((r) => ({
              interface: r.ifName,
              entradaMbps: mbps(r.inBps),
              saidaMbps: mbps(r.outBps),
              errosEntrada: r.inErrors,
              errosSaida: r.outErrors,
              oper: r.operStatus === 1 ? 'up' : r.operStatus === 2 ? 'down' : '?',
            })),
          };
        } catch (e) {
          return { erro: e instanceof Error ? e.message : String(e) };
        }
      }

      case 'optica_rede': {
        const deviceId = String(call.args.deviceId ?? '').trim();
        if (!deviceId) return { erro: 'informe deviceId' };
        try {
          const optical = await nms.optical(deviceId, authToken);
          return {
            leituras: optical.map((o) => ({
              interface: o.ifName,
              rxDbm: num(o.rxDbm),
              txDbm: num(o.txDbm),
              tempC: num(o.moduleTempC),
            })),
          };
        } catch (e) {
          return { erro: e instanceof Error ? e.message : String(e) };
        }
      }

      case 'executar_teste_rede': {
        const testType = call.args.testType === 'traceroute' ? 'traceroute' : 'ping';
        const target = String(call.args.target ?? '').trim();
        if (!target) return { erro: 'informe o alvo (target)' };
        const source = call.args.source === 'device' ? 'device' : 'host';
        const device = call.args.device ? String(call.args.device) : undefined;
        try {
          const { jobId } = await nms.enqueueNetworkTest({ testType, target, source, device }, authToken);
          context.pendingTest = { jobId, testType, target, source };
          return {
            enfileirado: true,
            obs: `${testType} para ${target} disparado. O resultado chega ao operador automaticamente em alguns segundos — apenas confirme que disparou, NÃO invente o resultado.`,
          };
        } catch (e) {
          return { erro: e instanceof Error ? e.message : String(e) };
        }
      }

      default:
        return { erro: `ferramenta desconhecida: ${call.name}` };
    }
  };
}
