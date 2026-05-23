/**
 * WatermelonDB migrations — Fase 0: vazio.
 *
 * Quando bumpar SCHEMA_VERSION, adicionar bloco:
 *   { toVersion: 2, steps: [ createTable({...}) | addColumns({...}) ] }
 */
import { schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';

export const mobileMigrations = schemaMigrations({
  migrations: [],
});
