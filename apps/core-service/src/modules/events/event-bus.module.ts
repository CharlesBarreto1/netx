import { DynamicModule, Logger, Module, type Provider } from '@nestjs/common';

import { loadConfig } from '@netx/config';
import { EVENT_PUBLISHER, NoopEventPublisher, type EventPublisher } from '@netx/core-sdk';

import { AmqpEventPublisher } from './amqp-event-publisher';
import { EventBusPublisher } from './event-bus.publisher';
import { EventConsumer } from './event-consumer';
import { EVENT_HANDLERS } from './event-handler';
import { NmsEventsHandler } from './nms-events.handler';

/**
 * Bus de eventos do ecossistema (Fase 3). Registra o provider global
 * `EVENT_PUBLISHER` para qualquer módulo injetar e publicar.
 *
 * DESLIGADO POR DEFAULT (invariante "entra desligada"): só vira o adaptador
 * AMQP real quando `EVENTBUS_ENABLED=true|1`; caso contrário injeta o
 * NoopEventPublisher e publicar é um no-op silencioso — nenhuma costura de
 * negócio muda de comportamento e a produção segue intacta.
 */
function eventBusEnabled(): boolean {
  const v = process.env.EVENTBUS_ENABLED;
  return v === 'true' || v === '1';
}

@Module({})
export class EventBusModule {
  static forRoot(): DynamicModule {
    const publisher: Provider = {
      provide: EVENT_PUBLISHER,
      useFactory: (): EventPublisher => {
        const logger = new Logger(EventBusModule.name);
        if (!eventBusEnabled()) {
          logger.log('bus DESLIGADO (EVENTBUS_ENABLED != true) — publisher no-op');
          return new NoopEventPublisher();
        }
        const { rabbitmq } = loadConfig();
        logger.log('bus LIGADO — publicando eventos no RabbitMQ');
        return new AmqpEventPublisher(rabbitmq.url);
      },
    };

    // Handler do NetX para eventos do NMS (netx-nms.*) — lado consumidor do
    // canal 3. Registrado via token multi EVENT_HANDLERS (o EventConsumer
    // despacha por pattern). Só age quando EVENTBUS_CONSUME está ligado.
    // `multi` é suportado em runtime mas não tipado nesta versão do @nestjs/common.
    const nmsHandler = {
      provide: EVENT_HANDLERS,
      useClass: NmsEventsHandler,
      multi: true,
    } as Provider;

    return {
      module: EventBusModule,
      global: true,
      providers: [publisher, EventBusPublisher, EventConsumer, nmsHandler],
      exports: [publisher, EventBusPublisher],
    };
  }
}
