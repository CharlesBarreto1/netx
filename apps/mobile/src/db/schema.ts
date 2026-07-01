import { appSchema, tableSchema } from '@nozbe/watermelondb';

/**
 * Schema local (WatermelonDB). Ritual pra evoluir:
 *   1. bump SCHEMA_VERSION
 *   2. adicionar/alterar tableSchema aqui
 *   3. adicionar o passo correspondente em ./migrations.ts (as colunas TÊM que
 *      bater com as daqui — o schema aplica no 1º boot, a migration no upgrade)
 *
 * v2 (NetX Field, offline-first):
 *   - service_orders: cache local das O.S do técnico (listagem offline)
 *   - outbox_ops: fila de mutações idempotentes pendentes de sync
 */
export const SCHEMA_VERSION = 2;

export const mobileSchema = appSchema({
  version: SCHEMA_VERSION,
  tables: [
    tableSchema({
      name: 'service_orders',
      columns: [
        { name: 'remote_id', type: 'string', isIndexed: true }, // id do ERP
        { name: 'code', type: 'string' },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'display_status', type: 'string' },
        { name: 'customer_name', type: 'string', isOptional: true },
        { name: 'contract_id', type: 'string', isOptional: true },
        { name: 'reason_name', type: 'string', isOptional: true },
        { name: 'city', type: 'string', isOptional: true },
        { name: 'scheduled_at', type: 'number', isOptional: true }, // epoch ms
        { name: 'opened_at', type: 'number' },
        { name: 'assigned_to_id', type: 'string', isIndexed: true },
        { name: 'synced_at', type: 'number', isOptional: true },
      ],
    }),
    tableSchema({
      name: 'outbox_ops',
      columns: [
        { name: 'entity', type: 'string', isIndexed: true }, // 'service_order' | 'so_photo' ...
        { name: 'entity_local_id', type: 'string' }, // referência local (opcional)
        { name: 'op', type: 'string' }, // 'complete_field' | 'consumption' | ...
        { name: 'method', type: 'string' }, // 'POST' | 'PATCH'
        { name: 'path', type: 'string' }, // ex '/service-orders/{id}/complete-field'
        { name: 'payload_json', type: 'string' }, // JSON.stringify do body
        { name: 'status', type: 'string', isIndexed: true }, // 'pending' | 'sending' | 'error' | 'failed'
        { name: 'attempts', type: 'number' },
        { name: 'last_error', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
  ],
});
