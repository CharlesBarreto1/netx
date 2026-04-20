import { z } from 'zod';

export const ConsentPurposeSchema = z.enum([
  'MARKETING_EMAIL',
  'MARKETING_SMS',
  'MARKETING_WHATSAPP',
  'MARKETING_VOICE',
  'DATA_PROCESSING',
  'THIRD_PARTY_SHARING',
  'CREDIT_SCORE_QUERY',
  'CONTRACT_NOTIFICATION',
  'SUPPORT_RECORDING',
  'OTHER',
]);
export type ConsentPurpose = z.infer<typeof ConsentPurposeSchema>;

export const ConsentStatusSchema = z.enum(['GRANTED', 'REVOKED', 'PENDING', 'EXPIRED']);
export type ConsentStatus = z.infer<typeof ConsentStatusSchema>;

export const ConsentMethodSchema = z.enum([
  'WEB_FORM',
  'EMAIL',
  'IN_PERSON',
  'VOICE',
  'API',
  'IMPORT',
  'OTHER',
]);
export type ConsentMethod = z.infer<typeof ConsentMethodSchema>;

export const RecordConsentRequestSchema = z.object({
  purpose: ConsentPurposeSchema,
  status: ConsentStatusSchema,
  method: ConsentMethodSchema.default('WEB_FORM'),
  expiresAt: z.string().datetime().nullish(),
  policyVersion: z.string().max(32).nullish(),
  evidenceUrl: z.string().url().max(2048).nullish(),
  notes: z.string().max(500).nullish(),
  metadata: z.record(z.unknown()).nullish(),
});
export type RecordConsentRequest = z.infer<typeof RecordConsentRequestSchema>;

export const ListConsentsQuerySchema = z.object({
  purpose: ConsentPurposeSchema.optional(),
  status: ConsentStatusSchema.optional(),
});
export type ListConsentsQuery = z.infer<typeof ListConsentsQuerySchema>;

export interface CustomerConsentResponse {
  id: string;
  customerId: string;
  purpose: ConsentPurpose;
  status: ConsentStatus;
  method: ConsentMethod;
  grantedAt: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
  policyVersion: string | null;
  sourceIp: string | null;
  sourceUserAgent: string | null;
  evidenceUrl: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}
