/**
 * Nomes de filas e canais Redis. Constantes compartilhadas para Node e Python não
 * divergirem em string mágica.
 */
export const QUEUE_DEVICE_JOBS = 'device-jobs' as const;

/** Canal pub/sub onde o device-gateway publica eventos assíncronos (traps normalizados etc.). */
export const CHANNEL_DEVICE_EVENTS = 'device-events' as const;
