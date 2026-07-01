/**
 * WatermelonDB migrations. Cada bump de SCHEMA_VERSION ganha um bloco
 * { toVersion, steps }. As colunas TÊM que ser idênticas às de ./schema.ts.
 */
import { schemaMigrations, createTable } from '@nozbe/watermelondb/Schema/migrations';

export const mobileMigrations = schemaMigrations({
  migrations: [
    {
      // v1 → v2 (NetX Field, offline-first): cache de O.S + outbox de mutações.
      toVersion: 2,
      steps: [
        createTable({
          name: 'service_orders',
          columns: [
            { name: 'remote_id', type: 'string', isIndexed: true },
            { name: 'code', type: 'string' },
            { name: 'status', type: 'string', isIndexed: true },
            { name: 'display_status', type: 'string' },
            { name: 'customer_name', type: 'string', isOptional: true },
            { name: 'contract_id', type: 'string', isOptional: true },
            { name: 'reason_name', type: 'string', isOptional: true },
            { name: 'city', type: 'string', isOptional: true },
            { name: 'scheduled_at', type: 'number', isOptional: true },
            { name: 'opened_at', type: 'number' },
            { name: 'assigned_to_id', type: 'string', isIndexed: true },
            { name: 'synced_at', type: 'number', isOptional: true },
          ],
        }),
        createTable({
          name: 'outbox_ops',
          columns: [
            { name: 'entity', type: 'string', isIndexed: true },
            { name: 'entity_local_id', type: 'string' },
            { name: 'op', type: 'string' },
            { name: 'method', type: 'string' },
            { name: 'path', type: 'string' },
            { name: 'payload_json', type: 'string' },
            { name: 'status', type: 'string', isIndexed: true },
            { name: 'attempts', type: 'number' },
            { name: 'last_error', type: 'string', isOptional: true },
            { name: 'created_at', type: 'number' },
            { name: 'updated_at', type: 'number' },
          ],
        }),
      ],
    },
  ],
});
