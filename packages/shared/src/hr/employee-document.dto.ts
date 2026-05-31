import { z } from 'zod';

/**
 * Documentos do colaborador (contrato, atestado, advertência, holerite…) e o
 * "protocolo" de assinatura (aceite eletrônico — NÃO é cert digital ICP).
 *
 * Fluxo de upload (presigned):
 *   1. POST /hr/employees/:id/documents/upload-url  → { uploadUrl, storageKey }
 *   2. client faz PUT do arquivo direto no MinIO usando uploadUrl
 *   3. POST /hr/employees/:id/documents  com { storageKey, ... } pra registrar
 */

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : (v ?? null)));

const optionalDate = () =>
  z
    .union([
      z.string().datetime({ offset: true }),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      z.literal(''),
    ])
    .nullish()
    .transform((v) => (v ? v : null));

export const EmployeeDocumentTypeSchema = z.enum([
  'CONTRACT',
  'AMENDMENT',
  'MEDICAL_CERTIFICATE',
  'WARNING',
  'SUSPENSION',
  'ID_DOCUMENT',
  'CERTIFICATE',
  'PAYSLIP',
  'PAYMENT_RECEIPT',
  'OTHER',
]);
export type EmployeeDocumentType = z.infer<typeof EmployeeDocumentTypeSchema>;

/** Passo 1: pedir URL de upload presigned. */
export const RequestUploadUrlSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().max(120).optional(),
});
export type RequestUploadUrl = z.infer<typeof RequestUploadUrlSchema>;

export interface UploadUrlResponse {
  uploadUrl: string;
  storageKey: string;
  expiresIn: number;
}

/** Passo 3: registrar o documento (com ou sem anexo). */
export const CreateEmployeeDocumentSchema = z.object({
  type: EmployeeDocumentTypeSchema.default('OTHER'),
  title: z.string().min(1).max(200),
  description: optionalString(500),
  storageKey: optionalString(500),
  fileName: optionalString(255),
  issuedAt: optionalDate(),
  expiresAt: optionalDate(),
  requiresSignature: z.boolean().default(false),
});
export type CreateEmployeeDocument = z.infer<typeof CreateEmployeeDocumentSchema>;

export const UpdateEmployeeDocumentSchema = CreateEmployeeDocumentSchema.partial();
export type UpdateEmployeeDocument = z.infer<typeof UpdateEmployeeDocumentSchema>;

export const ListEmployeeDocumentsQuerySchema = z.object({
  type: EmployeeDocumentTypeSchema.optional(),
  requiresSignature: z.coerce.boolean().optional(),
  search: z.string().max(255).optional(),
});
export type ListEmployeeDocumentsQuery = z.infer<
  typeof ListEmployeeDocumentsQuerySchema
>;

/** Aceite eletrônico de um documento (chamado do portal/self-service). */
export const SignDocumentSchema = z.object({
  /** Confirma que o colaborador marcou o aceite. */
  accepted: z.literal(true),
});
export type SignDocument = z.infer<typeof SignDocumentSchema>;

export interface DocumentSignatureResponse {
  id: string;
  documentId: string;
  employeeId: string;
  signedAt: string;
  signedFileHash: string | null;
  ipAddress: string | null;
  acceptedText: string | null;
}

export interface EmployeeDocumentResponse {
  id: string;
  tenantId: string;
  employeeId: string;
  type: EmployeeDocumentType;
  title: string;
  description: string | null;
  storageKey: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  fileHash: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  requiresSignature: boolean;
  uploadedById: string | null;
  createdAt: string;
  updatedAt: string;
  /** URL presigned de download — preenchida sob demanda (não na listagem). */
  downloadUrl?: string | null;
  signature?: DocumentSignatureResponse | null;
}
