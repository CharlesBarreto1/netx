/**
 * Despachador de RPCs ACS→CPE baseado em Tr069Task.
 *
 * Pega Tr069Task PENDING do device, marca RUNNING, e devolve o XML do
 * envelope SOAP correspondente. Quando CPE responder (na próxima request
 * do mesmo session), o session.service marca DONE/FAILED.
 *
 * Suportados (Fase 3):
 *   - SET_PARAMS   → SetParameterValues
 *   - GET_PARAMS   → GetParameterValues
 *   - REBOOT       → Reboot
 *   - FACTORY_RESET → FactoryReset
 *
 * Não suportados ainda (lança):
 *   - DOWNLOAD, ADD_OBJECT, DELETE_OBJECT
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { Logger } from '@nestjs/common';
import type { Tr069Task } from '@prisma/client';

import {
  buildFactoryReset,
  buildGetParameterValues,
  buildReboot,
  buildSetParameterValues,
  type SetParam,
} from './cwmp-soap';

const logger = new Logger('CwmpRpcDispatcher');

interface SetParamsPayload {
  params: Array<{ name: string; value: string; type: SetParam['type'] }>;
  parameterKey?: string;
}
interface GetParamsPayload {
  names: string[];
}

/**
 * Converte uma Tr069Task em envelope SOAP pronto pra envio.
 * `cwmpId` deve ser único por sessão — geramos da própria task.id.
 */
export function buildRpcForTask(task: Tr069Task): { xml: string; cwmpId: string } {
  // Usa task.id como cwmp:ID — quando CPE responder, conseguimos casar
  // pelo header ID (se cliente preservar) ou pelo cookie do session.
  const cwmpId = task.id;
  const payload = task.payload as unknown;

  switch (task.action) {
    case 'SET_PARAMS': {
      const p = payload as SetParamsPayload;
      if (!Array.isArray(p?.params) || p.params.length === 0) {
        throw new Error(`SET_PARAMS task ${task.id} sem params`);
      }
      return {
        xml: buildSetParameterValues(cwmpId, p.params, p.parameterKey ?? task.id),
        cwmpId,
      };
    }
    case 'GET_PARAMS': {
      const p = payload as GetParamsPayload;
      if (!Array.isArray(p?.names) || p.names.length === 0) {
        throw new Error(`GET_PARAMS task ${task.id} sem names`);
      }
      return { xml: buildGetParameterValues(cwmpId, p.names), cwmpId };
    }
    case 'REBOOT': {
      return { xml: buildReboot(cwmpId, task.id), cwmpId };
    }
    case 'FACTORY_RESET': {
      return { xml: buildFactoryReset(cwmpId), cwmpId };
    }
    case 'DOWNLOAD':
    case 'ADD_OBJECT':
    case 'DELETE_OBJECT':
      throw new Error(`Action ${task.action} ainda não suportada pelo ACS embedded`);
    default: {
      const exhaustive: never = task.action;
      throw new Error(`Action desconhecida: ${String(exhaustive)}`);
    }
  }
}

/** Inspeciona resposta do CPE pra detectar fault. */
export function detectFault(parsedBody: Record<string, unknown>): string | null {
  // SOAP Fault: <soap:Fault>...<detail><cwmp:Fault><FaultCode>...</FaultCode>
  //                                              <FaultString>...
  const fault = parsedBody.Fault as Record<string, unknown> | undefined;
  if (!fault) return null;
  const detail = fault.detail as Record<string, unknown> | undefined;
  const cwmpFault = detail?.Fault as Record<string, unknown> | undefined;
  if (cwmpFault) {
    const code = cwmpFault.FaultCode ?? '?';
    const str = cwmpFault.FaultString ?? '?';
    return `CWMP Fault ${code}: ${str}`;
  }
  const faultStr = fault.faultstring ?? fault.faultString ?? 'SOAP Fault';
  return String(faultStr);
}

/** Identifica se uma resposta CPE casa com a task que enviamos. */
export function isResponseForTask(taskAction: Tr069Task['action'], rpcKind: string): boolean {
  const expected: Record<Tr069Task['action'], string> = {
    SET_PARAMS: 'SetParameterValuesResponse',
    GET_PARAMS: 'GetParameterValuesResponse',
    REBOOT: 'RebootResponse',
    FACTORY_RESET: 'FactoryResetResponse',
    DOWNLOAD: 'DownloadResponse',
    ADD_OBJECT: 'AddObjectResponse',
    DELETE_OBJECT: 'DeleteObjectResponse',
  };
  return expected[taskAction] === rpcKind;
}

logger.debug('cwmp-rpc dispatcher loaded');
