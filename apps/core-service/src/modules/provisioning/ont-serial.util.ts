/**
 * Normalização de serial GPON de ONT — reexporta do pacote compartilhado
 * (@netx/shared) para que core-service e cwmp-server casem seriais com a MESMA
 * lógica (amigável ↔ hex). Ver packages/shared/src/provisioning/ont-serial.ts.
 */
export { ontSerialForms, ontSerialKey, ontSerialKeys } from '@netx/shared';
