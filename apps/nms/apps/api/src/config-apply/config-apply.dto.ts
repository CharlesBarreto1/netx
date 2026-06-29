import { z } from 'zod';

/**
 * Aplicação de config (ESCRITA). O padrão é plan → revisão humana → apply → verify →
 * rollback (AGENTS.md §2). A IA nunca chama estes endpoints; o operador autenticado é
 * o aprovador humano (approvedBy = quem dispara).
 */
export const PlanConfigSchema = z.object({
  /** Config a aplicar (Junos: linhas `set ...`; RouterOS: comandos `/...`). */
  config: z.string().min(1).max(100_000),
});
export type PlanConfigDto = z.infer<typeof PlanConfigSchema>;

export const ApplyConfigSchema = z.object({
  config: z.string().min(1).max(100_000),
  /** Janela do rollback automático (Junos commit confirmed / RouterOS auto-revert). */
  confirmMinutes: z.number().int().min(1).max(60).default(5),
  /** Confirmação explícita de que o operador revisou o plan (gate de revisão humana). */
  approve: z.literal(true, {
    errorMap: () => ({ message: 'apply exige approve=true (revisão humana do plan)' }),
  }),
});
export type ApplyConfigDto = z.infer<typeof ApplyConfigSchema>;
