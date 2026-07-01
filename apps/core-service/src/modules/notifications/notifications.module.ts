import { Global, Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller';
import { NotificationsEventsBus } from './notifications.events';
import { NotificationsService } from './notifications.service';

/**
 * Centro de notificações do NetX (sino global).
 *
 * @Global: qualquer módulo injeta NotificationsService SEM importar este módulo
 * — é o ponto "engatável" pra disparar avisos ao usuário (chat, tarefas,
 * alarmes do NMS). PrismaModule também é global, então não precisa importar.
 */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsEventsBus],
  exports: [NotificationsService],
})
export class NotificationsModule {}
