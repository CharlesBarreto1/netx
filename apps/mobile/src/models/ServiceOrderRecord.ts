import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * ServiceOrderRecord — cache local de uma O.S do técnico (listagem offline).
 * A fonte da verdade é o servidor; isto é só um espelho pra ler sem rede.
 * Timestamps vêm como epoch ms (number) do ERP — não uso as colunas especiais
 * created_at/updated_at do WatermelonDB aqui.
 */
export class ServiceOrderRecord extends Model {
  static table = 'service_orders';

  @field('remote_id') remoteId!: string;
  @field('code') code!: string;
  @field('status') status!: string;
  @field('display_status') displayStatus!: string;
  @field('customer_name') customerName?: string;
  @field('contract_id') contractId?: string;
  @field('reason_name') reasonName?: string;
  @field('city') city?: string;
  @field('scheduled_at') scheduledAt?: number;
  @field('opened_at') openedAt!: number;
  @field('assigned_to_id') assignedToId!: string;
  @field('synced_at') syncedAt?: number;
}
