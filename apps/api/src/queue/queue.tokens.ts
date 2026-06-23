/** Token de injeção da fila de jobs de equipamento. */
export const DEVICE_JOBS_QUEUE = Symbol('DEVICE_JOBS_QUEUE');

/** Token de injeção dos eventos da fila (usado para aguardar o resultado de um job). */
export const DEVICE_JOBS_EVENTS = Symbol('DEVICE_JOBS_EVENTS');
