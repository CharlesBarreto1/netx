import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';

import { mobileMigrations } from './migrations';
import { mobileSchema } from './schema';

/**
 * Singleton do banco local WatermelonDB.
 *
 * `jsi: true` ativa o modo síncrono via JSI (10× mais rápido que via bridge).
 * `dbName` muda quando o user faz logout? Não — manter o mesmo db e limpar
 * tabelas em logout via `database.write(() => database.unsafeResetDatabase())`.
 * (limpa tudo, schema reaplica no próximo boot)
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
  modelClasses: [
    // Fase 1: registrar Model classes aqui (ServiceOrderModel, etc).
  ],
});
