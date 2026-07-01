import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';

import { OutboxOp } from '../models/OutboxOp';
import { ServiceOrderRecord } from '../models/ServiceOrderRecord';

import { mobileMigrations } from './migrations';
import { mobileSchema } from './schema';

/**
 * Singleton do banco local WatermelonDB.
 *
 * `jsi: true` ativa o modo síncrono via JSI (10× mais rápido que via bridge).
 * Logout NÃO troca o dbName — limpa as tabelas via
 * `database.write(() => database.unsafeResetDatabase())` (ver lib/auth.ts).
 */
const adapter = new SQLiteAdapter({
  schema: mobileSchema,
  migrations: mobileMigrations,
  dbName: 'netx_mobile',
  jsi: true,
  onSetUpError: (error) => {
    // Em prod, mandar pra Sentry. Em dev, só logar.
    // eslint-disable-next-line no-console
    console.error('[NetX Mobile] WatermelonDB setup error:', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [ServiceOrderRecord, OutboxOp],
});
