/**
 * Outbox — fila local idempotente de mutações capturadas offline.
 *
 * Fronteira dura (regra do NetX Field): a outbox só serve pra CAPTURAR. NUNCA
 * enfileire aqui provisionamento, desbloqueio, nova venda ou qualquer escrita
 * de rede/financeiro — essas são online-obrigatório e a UI as chama direto.
 * A outbox carrega captura de O.S (fotos já subidas, assinatura, leitura de
 * sinal, baixa de material, fechamento de suporte).
 *
 * Idempotência: o `id` do registro (estável) vai como header `Idempotency-Key`.
 * Se o servidor commitou mas o app não recebeu o 2xx, o reenvio NÃO reaplica
 * (o IdempotencyInterceptor devolve a resposta guardada). last-write-wins NÃO
 * é usado pra material — o servidor dedupa por chave.
 */
import NetInfo from '@react-native-community/netinfo';
import { Q } from '@nozbe/watermelondb';

import { database } from '@/db/database';
import { api, ApiError } from '@/lib/api';
import { OutboxOp } from '@/models/OutboxOp';

const collection = () => database.get<OutboxOp>('outbox_ops');

export interface EnqueueInput {
  entity: string; // 'service_order' | 'so_consumption' ...
  entityLocalId?: string;
  op: string; // 'complete_field' | 'consumption' | 'checkin' ...
  method: 'POST' | 'PATCH';
  path: string; // ex '/service-orders/<id>/complete-field'
  payload: unknown;
}

/** Enfileira uma mutação pra sync. Retorna o id (= Idempotency-Key). */
export async function enqueueOp(input: EnqueueInput): Promise<string> {
  let opId = '';
  await database.write(async () => {
    const rec = await collection().create((o) => {
      o.entity = input.entity;
      o.entityLocalId = input.entityLocalId ?? '';
      o.op = input.op;
      o.method = input.method;
      o.path = input.path;
      o.payloadJson = JSON.stringify(input.payload ?? {});
      o.status = 'pending';
      o.attempts = 0;
    });
    opId = rec.id;
  });
  // Tenta drenar já (se tiver rede); se offline, fica pra reconexão.
  void flushOutbox();
  return opId;
}

let flushing = false;

/** Drena a fila: envia pendentes/erros em ordem de criação. Idempotente. */
export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const pending = await collection()
      .query(Q.where('status', Q.oneOf(['pending', 'error'])), Q.sortBy('created_at', Q.asc))
      .fetch();

    for (const op of pending) {
      await database.write(async () => {
        await op.update((o) => {
          o.status = 'sending';
          o.updatedAt = new Date();
        });
      });

      try {
        await api(op.path, {
          method: op.method as 'POST' | 'PATCH',
          body: JSON.parse(op.payloadJson),
          headers: { 'Idempotency-Key': op.id },
          // Endpoints Field podem não estar deployados ainda — não desloga.
          silentUnauthorized: true,
        });
        await database.write(async () => {
          await op.destroyPermanently();
        });
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        const message = err instanceof ApiError ? err.message : String(err);
        // 409 = op idêntica em andamento (in-flight) → re-tenta depois.
        // 4xx (exceto 429) = erro definitivo do cliente → 'failed' (sem loop).
        // 5xx / rede / 429 = transitório → 'error' (re-tenta na próxima drenagem).
        const definitiveClientError = status >= 400 && status < 500 && status !== 409 && status !== 429;
        await database.write(async () => {
          await op.update((o) => {
            o.status = definitiveClientError ? 'failed' : status === 409 ? 'pending' : 'error';
            o.attempts = (o.attempts ?? 0) + 1;
            o.lastError = message;
            o.updatedAt = new Date();
          });
        });
      }
    }
  } finally {
    flushing = false;
  }
}

/** Conta ops ainda não sincronizadas (badge de "pendências"). */
export async function pendingCount(): Promise<number> {
  return collection().query(Q.where('status', Q.oneOf(['pending', 'sending', 'error']))).fetchCount();
}

/**
 * Liga o sync: drena ao reconectar e uma vez no boot. Retorna o unsubscribe.
 * Primeiro uso de @react-native-community/netinfo no app.
 */
export function startOutboxSync(): () => void {
  void flushOutbox();
  return NetInfo.addEventListener((s) => {
    if (s.isConnected) void flushOutbox();
  });
}
