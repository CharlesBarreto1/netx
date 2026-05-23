/**
 * WatermelonDB schema — Fase 0: vazio (só infra).
 *
 * Cada nova tabela em fases seguintes:
 *   1. bumpar SCHEMA_VERSION
 *   2. adicionar tableSchema em `tables`
 *   3. adicionar migration em ./migrations.ts (addColumns/createTable)
 *
 * Schema é declarativo — WatermelonDB roda CREATE TABLE no primeiro boot.
 * Migrations só rodam pra schema antigo → novo.
 */
import { appSchema } from '@nozbe/watermelondb';

export const SCHEMA_VERSION = 1;

export const mobileSchema = appSchema({
  version: SCHEMA_VERSION,
  tables: [
    // Fase 1 adicionará: service_orders, service_order_photos, customers,
    // contracts, customer_addresses, stock_levels, outbox_ops, etc.
  ],
});
