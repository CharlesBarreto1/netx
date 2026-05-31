import { z } from 'zod';

/**
 * Colaborador (empleado). Login no sistema = User (employee.userId 1:1). Ao
 * criar, o backend pode provisionar um User com role restrita (`provisionUser`).
 */

const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v === '' ? null : (v ?? null)));

// Aceita ISO datetime (com offset) OU data simples YYYY-MM-DD OU vazio/null →
// normaliza vazio/undefined pra null.
const optionalDate = () =>
  z
    .union([
      z.string().datetime({ offset: true }),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      z.literal(''),
    ])
    .nullish()
    .transform((v) => (v ? v : null));

const optionalEmail = () =>
  z
    .union([z.string().email().max(160), z.literal('')])
    .nullish()
    .transform((v) => (v ? v : null));

export const EmployeeStatusSchema = z.enum([
  'ACTIVE',
  'ON_LEAVE',
  'SUSPENDED',
  'TERMINATED',
]);
export type EmployeeStatus = z.infer<typeof EmployeeStatusSchema>;

export const EmploymentTypeSchema = z.enum([
  'CLT',
  'PJ',
  'INTERN',
  'TEMPORARY',
  'RELACION_DEPENDENCIA',
  'OTHER',
]);
export type EmploymentType = z.infer<typeof EmploymentTypeSchema>;

export const PayFrequencySchema = z.enum(['MONTHLY', 'BIWEEKLY', 'WEEKLY']);
export type PayFrequency = z.infer<typeof PayFrequencySchema>;

export const CreateEmployeeRequestSchema = z.object({
  fullName: z.string().min(2).max(180),
  preferredName: optionalString(80),
  document: optionalString(32),
  documentType: optionalString(16),
  socialSecurityNo: optionalString(32),
  birthDate: optionalDate(),
  gender: optionalString(16),
  maritalStatus: optionalString(24),
  nationality: optionalString(48),

  email: optionalEmail(),
  phone: optionalString(32),
  emergencyContact: optionalString(180),
  emergencyPhone: optionalString(32),
  address: optionalString(500),

  department: optionalString(120),
  position: optionalString(120),
  employmentType: EmploymentTypeSchema.default('CLT'),
  status: EmployeeStatusSchema.default('ACTIVE'),
  hiredAt: optionalDate(),
  probationEndsAt: optionalDate(),

  baseSalary: z.coerce.number().min(0).max(100_000_000).nullish(),
  payFrequency: PayFrequencySchema.default('MONTHLY'),
  weeklyHours: z.coerce.number().min(0).max(168).nullish(),
  workSchedule: optionalString(255),
  clockToleranceMin: z.coerce.number().int().min(0).max(120).default(10),

  skills: z.array(z.string().max(80)).max(50).default([]),
  notes: optionalString(5000),

  managerId: z.string().uuid().nullish(),

  /** Vincular a um User já existente (técnico/operador que vira colaborador). */
  userId: z.string().uuid().nullish(),
  /**
   * Provisionar um novo User de login pro colaborador (role restrita). Exige
   * email. Mutuamente exclusivo com userId. Senha inicial é gerada e devolvida
   * uma vez na resposta de criação.
   */
  provisionUser: z.boolean().default(false),
});
export type CreateEmployeeRequest = z.infer<typeof CreateEmployeeRequestSchema>;

export const UpdateEmployeeRequestSchema = CreateEmployeeRequestSchema.partial().extend({
  terminatedAt: optionalDate(),
  terminationReason: optionalString(500),
});
export type UpdateEmployeeRequest = z.infer<typeof UpdateEmployeeRequestSchema>;

export const ListEmployeesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  status: EmployeeStatusSchema.optional(),
  department: z.string().max(120).optional(),
  managerId: z.string().uuid().optional(),
  search: z.string().max(255).optional(),
  sortBy: z.enum(['fullName', 'hiredAt', 'department', 'createdAt']).default('fullName'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});
export type ListEmployeesQuery = z.infer<typeof ListEmployeesQuerySchema>;

export interface EmployeeResponse {
  id: string;
  tenantId: string;
  registration: string | null;
  fullName: string;
  preferredName: string | null;
  document: string | null;
  documentType: string | null;
  socialSecurityNo: string | null;
  birthDate: string | null;
  gender: string | null;
  maritalStatus: string | null;
  nationality: string | null;
  email: string | null;
  phone: string | null;
  emergencyContact: string | null;
  emergencyPhone: string | null;
  address: string | null;
  department: string | null;
  position: string | null;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  hiredAt: string | null;
  probationEndsAt: string | null;
  terminatedAt: string | null;
  terminationReason: string | null;
  baseSalary: number | null;
  payFrequency: PayFrequency;
  weeklyHours: number | null;
  workSchedule: string | null;
  clockToleranceMin: number;
  skills: string[];
  notes: string | null;
  userId: string | null;
  managerId: string | null;
  createdAt: string;
  updatedAt: string;

  manager?: { id: string; fullName: string } | null;
  user?: { id: string; email: string; status: string } | null;
  reportsCount?: number;
}

/** Resposta de criação — inclui credenciais provisionadas (exibidas 1x). */
export interface CreateEmployeeResponse extends EmployeeResponse {
  provisionedUser?: {
    id: string;
    email: string;
    initialPassword: string;
  } | null;
}
