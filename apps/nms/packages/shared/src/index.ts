/**
 * @netx-nms/shared — contratos entre Node (apps/api) e Python (apps/device-gateway).
 *
 * Esta é a FONTE DA VERDADE do formato de jobs e eventos. Mudou aqui → regenerar o
 * JSON Schema (`pnpm --filter @netx-nms/shared export:schema`) que o device-gateway valida.
 */
export * from './queues.js';
export * from './jobs.js';
export * from './events.js';
