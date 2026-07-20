import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SnmpConfigService } from './snmp-config.service.js';

/**
 * No boot, apaga os perfis SNMP do Telegraf que ficaram órfãos — device removido em uma
 * versão anterior (que não limpava o perfil) ou com o gateway fora do ar. Sem isso o
 * Telegraf continua pollando IPs de devices que não existem mais, indefinidamente.
 *
 * Fora do caminho crítico do boot: não bloqueia a subida da API e, se o gateway ainda não
 * estiver de pé, o job fica na fila e é processado quando ele subir.
 */
@Injectable()
export class SnmpConfigReconciler implements OnModuleInit {
  constructor(private readonly snmpConfig: SnmpConfigService) {}

  onModuleInit(): void {
    void this.snmpConfig.reconcileQuietly('system');
  }
}
