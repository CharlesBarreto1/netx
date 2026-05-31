import { z } from 'zod';

/**
 * Ponto: marcações (TimeEntry) + solicitações de correção (TimeCorrectionRequest).
 * MVP bate ponto pela web (source=PORTAL). lat/lng existem pro mobile (fase 2).
 */

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : (v ?? null)));

export const TimeEntryTypeSchema = z.enum([
  'CLOCK_IN',
  'CLOCK_OUT',
  'BREAK_START',
  'BREAK_END',
]);
export type TimeEntryType = z.infer<typeof TimeEntryTypeSchema>;

export const TimeEntrySourceSchema = z.enum(['PORTAL', 'MOBILE', 'MANUAL']);
export type TimeEntrySource = z.infer<typeof TimeEntrySourceSchema>;

/** Bater ponto (self-service). occurredAt default = agora no backend. */
export const ClockInOutSchema = z.object({
  type: TimeEntryTypeSchema,
  latitude: z.coerce.number().min(-90).max(90).nullish(),
  longitude: z.coerce.number().min(-180).max(180).nullish(),
});
export type ClockInOut = z.infer<typeof ClockInOutSchema>;

/** Lançamento manual de marcação pelo RH (ajuste fora de correção). */
export const CreateTimeEntrySchema = z.object({
  employeeId: z.string().uuid(),
  type: TimeEntryTypeSchema,
  occurredAt: z.string().datetime({ offset: true }),
  notes: optionalString(500),
});
export type CreateTimeEntry = z.infer<typeof CreateTimeEntrySchema>;

export const ListTimeEntriesQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListTimeEntriesQuery = z.infer<typeof ListTimeEntriesQuerySchema>;

export interface TimeEntryResponse {
  id: string;
  tenantId: string;
  employeeId: string;
  type: TimeEntryType;
  occurredAt: string;
  source: TimeEntrySource;
  latitude: number | null;
  longitude: number | null;
  correctionId: string | null;
  notes: string | null;
  createdById: string | null;
  createdAt: string;
  employee?: { id: string; fullName: string } | null;
}

// ── Correção de ponto ────────────────────────────────────────────────────────
export const TimeCorrectionKindSchema = z.enum(['ADD', 'EDIT', 'REMOVE']);
export type TimeCorrectionKind = z.infer<typeof TimeCorrectionKindSchema>;

export const TimeCorrectionStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
]);
export type TimeCorrectionStatus = z.infer<typeof TimeCorrectionStatusSchema>;

/**
 * Solicitação de correção. Validação por `kind`:
 *  - ADD: proposedType + proposedTime obrigatórios.
 *  - EDIT: targetEntryId + proposedTime (e/ou proposedType) obrigatórios.
 *  - REMOVE: targetEntryId obrigatório.
 */
export const CreateTimeCorrectionSchema = z
  .object({
    kind: TimeCorrectionKindSchema,
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    targetEntryId: z.string().uuid().nullish(),
    proposedType: TimeEntryTypeSchema.nullish(),
    proposedTime: z.string().datetime({ offset: true }).nullish(),
    reason: z.string().min(3).max(1000),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'ADD' && (!v.proposedType || !v.proposedTime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ADD exige proposedType e proposedTime',
        path: ['proposedTime'],
      });
    }
    if (v.kind === 'EDIT' && (!v.targetEntryId || !v.proposedTime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'EDIT exige targetEntryId e proposedTime',
        path: ['targetEntryId'],
      });
    }
    if (v.kind === 'REMOVE' && !v.targetEntryId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'REMOVE exige targetEntryId',
        path: ['targetEntryId'],
      });
    }
  });
export type CreateTimeCorrection = z.infer<typeof CreateTimeCorrectionSchema>;

/** Decisão do RH sobre uma solicitação. */
export const ReviewTimeCorrectionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reviewNotes: optionalString(1000),
});
export type ReviewTimeCorrection = z.infer<typeof ReviewTimeCorrectionSchema>;

export const ListTimeCorrectionsQuerySchema = z.object({
  status: TimeCorrectionStatusSchema.optional(),
  employeeId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListTimeCorrectionsQuery = z.infer<
  typeof ListTimeCorrectionsQuerySchema
>;

export interface TimeCorrectionResponse {
  id: string;
  tenantId: string;
  employeeId: string;
  kind: TimeCorrectionKind;
  targetDate: string;
  targetEntryId: string | null;
  proposedType: TimeEntryType | null;
  proposedTime: string | null;
  reason: string;
  status: TimeCorrectionStatus;
  reviewedById: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
  employee?: { id: string; fullName: string } | null;
}

// ── Espelho de ponto (relatório por dia) ─────────────────────────────────────
export interface TimesheetDay {
  date: string; // YYYY-MM-DD (timezone do tenant)
  entries: { type: TimeEntryType; occurredAt: string; source: TimeEntrySource }[];
  workedMinutes: number; // soma dos pares IN→OUT menos intervalos
  firstIn: string | null;
  lastOut: string | null;
}

export interface TimesheetResponse {
  employeeId: string;
  from: string;
  to: string;
  days: TimesheetDay[];
  totalWorkedMinutes: number;
}
