import { DynamicModule, Logger, Module, type Provider } from '@nestjs/common';

import { loadConfig } from '@netx/config';
import { EVENT_PUBLISHER, NoopEventPublisher, type EventPublisher } from '@netx/core-sdk';

import { AlarmsModule } from '../alarms/alarms.module';
import { ProvisioningModule } from '../provisioning/provisioning.module';

import { AmqpEventPublisher } from './amqp-event-publisher';
import { EventBusPublisher } from './event-bus.publisher';
import { EventConsumer } from './event-consumer';
import { EventsController } from './events.controller';
import { EVENT_HANDLERS } from './event-handler';
import { FeedHandler } from './feed.handler';
import { FeedStream } from './feed-stream.service';
import { NmsEventsHandler } from './nms-events.handler';
import { WifiOptEventsHandler } from './wifi-opt.handler';

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

    // Ponte bus → SSE do feed (NEXUS/Field). Assina tudo e re-emite no FeedStream.
    const feedHandler = {
      provide: EVENT_HANDLERS,
      useClass: FeedHandler,
      multi: true,
    } as Provider;

    // WiFi-Opt: fast-path da mudança de plano (netx-erp.contract.plan-changed
    // → re-avalia profile BASE/GIGA e ajusta largura). Best-effort — a
    // garantia é o sweeper horário do WifiOptService.
    const wifiOptHandler = {
      provide: EVENT_HANDLERS,
      useClass: WifiOptEventsHandler,
      multi: true,
    } as Provider;

    return {
      module: EventBusModule,
      global: true,
      // AlarmsModule: o NmsEventsHandler injeta o AlarmStream pra surfar faults
      // do NMS no NOC real-time.
      // ProvisioningModule: o WifiOptEventsHandler injeta o WifiOptService
      // (import direto — nada na cadeia do provisioning importa este módulo,
      // então não há ciclo e forwardRef é desnecessário).
      imports: [AlarmsModule, ProvisioningModule],
      // EventsController expõe GET /v1/events/stream (SSE do feed, tenant-scoped).
      controllers: [EventsController],
      providers: [
        publisher,
        EventBusPublisher,
        EventConsumer,
        nmsHandler,
        FeedStream,
        feedHandler,
        wifiOptHandler,
      ],
      exports: [publisher, EventBusPublisher, FeedStream],
    };
  }
}
