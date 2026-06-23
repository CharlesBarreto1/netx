import { z } from 'zod';

export const CopilotSchema = z.object({
  question: z.string().min(1).max(2000),
});
export type CopilotDto = z.infer<typeof CopilotSchema>;
