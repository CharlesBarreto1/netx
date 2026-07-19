import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';

import type { Env } from '../config/env.js';
import type { EventEnvelope } from './event-envelope.js';

/**
 * Fila durável EXCLUSIVA do NMS na exchange do ecossistema. Cada módulo tem a
 * sua própria fila ligada à mesma exchange topic (`netx.events`), então todos
 * recebem uma cópia dos eventos que assinam (fan-out por binding key).
 */
const NMS_QUEUE = 'netx.events.nms';

/**
 * Routing keys que o NMS consome (canal 3). O acoplamento ERP→NMS vive aqui:
 * quando um contrato é instalado/criado, o NMS pode reagir (ex.: reservar
 * recursos de rede, abrir baseline de monitoramento). Bindings explícitos —
 * não escutamos `#` pra deixar claro o que o NMS realmente consome (A.4).
 */
const BINDINGS = [
  'netx-erp.contract.created',
  'netx-erp.contract.installed',
  'netx-erp.contract.cancelled',
  'netx-cpe.ont.swapped',
];

/** Teto do cache de idempotência em memória (espelha o core). */
const DEDUP_CAP = 5000;
/** Backoff de reconexão (amqplib puro não reconecta sozinho). */
const RECONNECT_MS = 5000;

/**
 * Consumidor do bus de eventos no NMS (canal 3 do ecossistema). DESLIGADO por
 * default — só liga com `EVENTBUS_CONSUME=true` E `RABBITMQ_URL` presente,
 * espelhando o core. Liga uma fila durável própria à exchange topic, processa
 * cada evento de forma IDEMPOTENTE (dedup por `envelope.id`) e dá ack.
 *
 * Hoje os handlers só registram a recepção (prova o round-trip e a fronteira de
 * acoplamento). Lógica de negócio real (ex.: provisionar baseline ao receber
 * `contract.installed`) entra em `dispatch()`.
 */
@Injectable()
export class EventConsumerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(EventConsumerService.name);
  // Tipo agnóstico à versão do amqplib (Connection vs ChannelModel).
  private connection?: Awaited<ReturnType<typeof amqp.connect>>;
  private channel?: amqp.Channel;
  private shuttingDown = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];

  constructor(private readonly config: ConfigService<Env, true>) {}

  onApplicationBootstrap(): void {
    const enabled = this.config.get('EVENTBUS_CONSUME', { infer: true });
    const url = this.config.get('RABBITMQ_URL', { infer: true });
    if (!enabled || !url) {
      this.logger.log(
        'consumo de eventos DESLIGADO (EVENTBUS_CONSUME != true ou RABBITMQ_URL ausente)',
      );
      return;
    }
    void this.connect(url);
  }

  private async connect(url: string): Promise<void> {
    if (this.shuttingDown) return;
    const exchange = this.config.get('EVENTBUS_EXCHANGE', { infer: true });
    try {
      this.connection = await amqp.connect(url);
      this.connection.on('error', (err) => this.logger.warn(`conexão AMQP erro: ${err?.message}`));
      this.connection.on('close', () => this.scheduleReconnect(url));

      const ch = await this.connection.createChannel();
      await ch.assertExchange(exchange, 'topic', { durable: true });
      await ch.assertQueue(NMS_QUEUE, { durable: true });
      for (const key of BINDINGS) await ch.bindQueue(NMS_QUEUE, exchange, key);
      await ch.prefetch(20);
      await ch.consume(NMS_QUEUE, (msg) => this.onMessage(ch, msg));
      this.channel = ch;
      this.logger.log(
        `consumo de eventos LIGADO — fila "${NMS_QUEUE}" ligada a "${exchange}" (${BINDINGS.length} bindings)`,
      );
    } catch (err) {
      this.logger.warn(
        `falha ao conectar no RabbitMQ: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.scheduleReconnect(url);
    }
  }

  private scheduleReconnect(url: string): void {
    if (this.shuttingDown || this.reconnectTimer) return;
    this.connection = undefined;
    this.channel = undefined;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect(url);
    }, RECONNECT_MS);
  }

  private async onMessage(ch: amqp.Channel, msg: amqp.ConsumeMessage | null): Promise<void> {
    if (!msg) return;
    let env: EventEnvelope;
    try {
      env = JSON.parse(msg.content.toString('utf8')) as EventEnvelope;
    } catch (err) {
      // Poison (ilegível): ack sem requeue pra não travar a fila.
      this.logger.warn(
        `descartando mensagem ilegível: ${err instanceof Error ? err.message : String(err)}`,
      );
      ch.ack(msg);
      return;
    }

    if (env.id && this.seen.has(env.id)) {
      ch.ack(msg);
      return;
    }
    this.remember(env.id);
    try {
      await this.dispatch(env);
    } catch (err) {
      this.logger.warn(
        `handler falhou em ${env.type} id=${env.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    ch.ack(msg);
  }

  /** Ponto de extensão pros handlers de negócio do NMS. Hoje só registra. */
  private async dispatch(env: EventEnvelope): Promise<void> {
    this.logger.log(
      `consumido ${env.type} id=${env.id} tenant=${env.tenantId} source=${env.source}`,
    );
    // TODO(ecossistema): handlers reais. Ex.: em `netx-erp.contract.installed`,
    // abrir baseline de monitoramento do CPE do cliente.
  }

  private remember(id: string): void {
    if (!id) return;
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > DEDUP_CAP) {
      const old = this.seenOrder.shift();
      if (old) this.seen.delete(old);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch {
      // shutdown best-effort
    }
  }
}
