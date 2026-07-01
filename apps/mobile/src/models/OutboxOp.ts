import { Model } from '@nozbe/watermelondb';
import { date, field, readonly } from '@nozbe/watermelondb/decorators';

/**
 * OutboxOp — uma mutação capturada offline, pendente de sync com a API do
 * módulo dono. O `id` (WatermelonDB) é estável e vira a `Idempotency-Key`
 * enviada ao servidor: reenvio depois de resposta perdida NÃO reaplica.
 */
export class OutboxOp extends Model {
  static table = 'outbox_ops';

  @field('entity') entity!: string;
  @field('entity_local_id') entityLocalId!: string;
  @field('op') op!: string;
  @field('method') method!: string;
  @field('path') path!: string;
  @field('payload_json') payloadJson!: string;
  @field('status') status!: string;
  @field('attempts') attempts!: number;
  @field('last_error') lastError?: string;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
