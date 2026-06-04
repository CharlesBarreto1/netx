/**
 * Cliente tipado dos endpoints de RH. Rotas proxiadas pelo gateway em
 * `/api/v1/hr/*`. Types espelham @netx/shared/hr (mantidos aqui pra dispensar
 * build do shared antes do web em dev — mesma convenção de fleet-api/stock-api).
 */
import { api } from './api';

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

function qs<T extends object>(params: T | Record<string, never> = {}): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

// ── Tipos ─────────────────────────────────────────────────────────────────────
export type EmployeeStatus = 'ACTIVE' | 'ON_LEAVE' | 'SUSPENDED' | 'TERMINATED';
export type EmploymentType =
  | 'CLT'
  | 'PJ'
  | 'INTERN'
  | 'TEMPORARY'
  | 'RELACION_DEPENDENCIA'
  | 'OTHER';
export type PayFrequency = 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY';

export interface Employee {
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

export interface CreateEmployeeInput {
  fullName: string;
  preferredName?: string | null;
  document?: string | null;
  documentType?: string | null;
  socialSecurityNo?: string | null;
  birthDate?: string | null;
  gender?: string | null;
  maritalStatus?: string | null;
  nationality?: string | null;
  email?: string | null;
  phone?: string | null;
  emergencyContact?: string | null;
  emergencyPhone?: string | null;
  address?: string | null;
  department?: string | null;
  position?: string | null;
  employmentType?: EmploymentType;
  status?: EmployeeStatus;
  hiredAt?: string | null;
  probationEndsAt?: string | null;
  baseSalary?: number | null;
  payFrequency?: PayFrequency;
  weeklyHours?: number | null;
  workSchedule?: string | null;
  clockToleranceMin?: number;
  skills?: string[];
  notes?: string | null;
  managerId?: string | null;
  userId?: string | null;
  provisionUser?: boolean;
}

export interface CreateEmployeeResult extends Employee {
  provisionedUser?: { id: string; email: string; initialPassword: string } | null;
}

export type EmployeeDocumentType =
  | 'CONTRACT'
  | 'AMENDMENT'
  | 'MEDICAL_CERTIFICATE'
  | 'WARNING'
  | 'SUSPENSION'
  | 'ID_DOCUMENT'
  | 'CERTIFICATE'
  | 'PAYSLIP'
  | 'PAYMENT_RECEIPT'
  | 'OTHER';

export interface DocumentSignature {
  id: string;
  documentId: string;
  employeeId: string;
  signedAt: string;
  signedFileHash: string | null;
  ipAddress: string | null;
  acceptedText: string | null;
}

export interface EmployeeDocument {
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
  signature?: DocumentSignature | null;
}

export type TimeEntryType = 'CLOCK_IN' | 'CLOCK_OUT' | 'BREAK_START' | 'BREAK_END';
export type TimeEntrySource = 'PORTAL' | 'MOBILE' | 'MANUAL';

export interface TimeEntry {
  id: string;
  employeeId: string;
  type: TimeEntryType;
  occurredAt: string;
  source: TimeEntrySource;
  notes: string | null;
  employee?: { id: string; fullName: string } | null;
}

export type TimeCorrectionKind = 'ADD' | 'EDIT' | 'REMOVE';
export type TimeCorrectionStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface TimeCorrection {
  id: string;
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
  employee?: { id: string; fullName: string } | null;
}

export interface TimesheetDay {
  date: string;
  entries: { id: string; type: TimeEntryType; occurredAt: string; source: TimeEntrySource }[];
  workedMinutes: number;
  firstIn: string | null;
  lastOut: string | null;
}
export interface Timesheet {
  employeeId: string;
  from: string;
  to: string;
  days: TimesheetDay[];
  totalWorkedMinutes: number;
}

export type PayslipStatus = 'DRAFT' | 'APPROVED' | 'PAID' | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'PIX' | 'CARD' | 'BANK_TRANSFER' | 'OTHER';
export interface PayslipItem {
  kind: 'EARNING' | 'DEDUCTION';
  label: string;
  amount: number;
}
export interface SalaryPayment {
  id: string;
  payslipId: string;
  employeeId: string;
  amount: number;
  paidAt: string;
  method: PaymentMethod;
  cashRegisterId: string | null;
  cashMovementId: string | null;
  receiptStorageKey: string | null;
  notes: string | null;
}
export interface Payslip {
  id: string;
  employeeId: string;
  referenceMonth: string;
  items: PayslipItem[];
  grossAmount: number;
  deductionsTotal: number;
  netAmount: number;
  status: PayslipStatus;
  notes: string | null;
  storageKey: string | null;
  createdAt: string;
  updatedAt: string;
  employee?: { id: string; fullName: string } | null;
  payment?: SalaryPayment | null;
}

export type CompanyPostStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export interface CompanyPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  coverStorageKey: string | null;
  status: CompanyPostStatus;
  pinned: boolean;
  publishedAt: string | null;
  authorId: string | null;
  author?: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollReportRow {
  employeeId: string;
  employeeName: string;
  department: string | null;
  payslipId: string | null;
  status: PayslipStatus | 'MISSING';
  netAmount: number;
  paidAmount: number;
  paidAt: string | null;
}
export interface PayrollReport {
  month: string;
  rows: PayrollReportRow[];
  totals: { employees: number; totalNet: number; totalPaid: number; totalPending: number };
}

// ── Self-service ────────────────────────────────────────────────────────────
export interface SelfProfile {
  employeeId: string;
  fullName: string;
  preferredName: string | null;
  department: string | null;
  position: string | null;
  registration: string | null;
  hiredAt: string | null;
  workSchedule: string | null;
  email: string | null;
  phone: string | null;
}
export interface SelfClockStatus {
  nextAction: TimeEntryType;
  lastEntry: { type: TimeEntryType; occurredAt: string } | null;
  todayWorkedMinutes: number;
  todayEntries: { type: TimeEntryType; occurredAt: string }[];
}
export interface SelfDashboard {
  profile: SelfProfile;
  clock: SelfClockStatus;
  pendingSignatures: number;
  latestPosts: CompanyPost[];
}

const B = '/v1/hr';

export const hrApi = {
  // Employees
  employeesPath: (q?: object) => `${B}/employees${qs(q ?? {})}`,
  listEmployees: (q?: object) => api.get<Paginated<Employee>>(`${B}/employees${qs(q ?? {})}`),
  getEmployee: (id: string) => api.get<Employee>(`${B}/employees/${id}`),
  createEmployee: (body: CreateEmployeeInput) =>
    api.post<CreateEmployeeResult>(`${B}/employees`, body),
  updateEmployee: (id: string, body: Partial<CreateEmployeeInput>) =>
    api.patch<Employee>(`${B}/employees/${id}`, body),
  deleteEmployee: (id: string) => api.delete(`${B}/employees/${id}`),

  // Documents
  documentsPath: (employeeId: string) => `${B}/employees/${employeeId}/documents`,
  listDocuments: (employeeId: string, q?: object) =>
    api.get<EmployeeDocument[]>(`${B}/employees/${employeeId}/documents${qs(q ?? {})}`),
  uploadUrl: (employeeId: string, body: { fileName: string; contentType?: string }) =>
    api.post<{ uploadUrl: string; storageKey: string; expiresIn: number }>(
      `${B}/employees/${employeeId}/documents/upload-url`,
      body,
    ),
  createDocument: (
    employeeId: string,
    body: {
      type?: EmployeeDocumentType;
      title: string;
      description?: string | null;
      storageKey?: string | null;
      fileName?: string | null;
      issuedAt?: string | null;
      expiresAt?: string | null;
      requiresSignature?: boolean;
    },
  ) => api.post<EmployeeDocument>(`${B}/employees/${employeeId}/documents`, body),
  documentDownload: (employeeId: string, docId: string) =>
    api.get<{ url: string; expiresIn: number }>(
      `${B}/employees/${employeeId}/documents/${docId}/download`,
    ),
  signDocument: (employeeId: string, docId: string) =>
    api.post<DocumentSignature>(
      `${B}/employees/${employeeId}/documents/${docId}/sign`,
      { accepted: true },
    ),
  deleteDocument: (employeeId: string, docId: string) =>
    api.delete(`${B}/employees/${employeeId}/documents/${docId}`),

  // Timeclock
  listEntries: (q?: object) =>
    api.get<Paginated<TimeEntry>>(`${B}/timeclock/entries${qs(q ?? {})}`),
  createEntry: (body: { employeeId: string; type: TimeEntryType; occurredAt: string; notes?: string | null }) =>
    api.post<TimeEntry>(`${B}/timeclock/entries`, body),
  updateEntry: (
    id: string,
    body: { type?: TimeEntryType; occurredAt?: string; notes?: string | null },
  ) => api.patch<TimeEntry>(`${B}/timeclock/entries/${id}`, body),
  removeEntry: (id: string) => api.delete(`${B}/timeclock/entries/${id}`),
  timesheet: (employeeId: string, from: string, to: string) =>
    api.get<Timesheet>(`${B}/timeclock/timesheet/${employeeId}${qs({ from, to })}`),
  correctionsPath: (q?: object) => `${B}/timeclock/corrections${qs(q ?? {})}`,
  listCorrections: (q?: object) =>
    api.get<Paginated<TimeCorrection>>(`${B}/timeclock/corrections${qs(q ?? {})}`),
  reviewCorrection: (id: string, body: { decision: 'APPROVED' | 'REJECTED'; reviewNotes?: string | null }) =>
    api.post<TimeCorrection>(`${B}/timeclock/corrections/${id}/review`, body),

  // Payroll
  payslipsPath: (q?: object) => `${B}/payroll/payslips${qs(q ?? {})}`,
  listPayslips: (q?: object) =>
    api.get<Paginated<Payslip>>(`${B}/payroll/payslips${qs(q ?? {})}`),
  getPayslip: (id: string) => api.get<Payslip>(`${B}/payroll/payslips/${id}`),
  createPayslip: (body: { employeeId: string; referenceMonth: string; items: PayslipItem[]; notes?: string | null }) =>
    api.post<Payslip>(`${B}/payroll/payslips`, body),
  updatePayslip: (id: string, body: { items?: PayslipItem[]; notes?: string | null; storageKey?: string | null }) =>
    api.patch<Payslip>(`${B}/payroll/payslips/${id}`, body),
  approvePayslip: (id: string) => api.post<Payslip>(`${B}/payroll/payslips/${id}/approve`),
  payPayslip: (
    id: string,
    body: {
      amount?: number;
      paidAt?: string;
      method?: PaymentMethod;
      cashRegisterId?: string | null;
      receiptStorageKey?: string | null;
      notes?: string | null;
    },
  ) => api.post<SalaryPayment>(`${B}/payroll/payslips/${id}/pay`, body),
  payslipReceipt: (id: string) =>
    api.get<{ url: string; expiresIn: number }>(`${B}/payroll/payslips/${id}/receipt`),
  reversePayment: (id: string) => api.post(`${B}/payroll/payslips/${id}/reverse`),
  deletePayslip: (id: string) => api.delete(`${B}/payroll/payslips/${id}`),

  // Blog
  postsPath: (q?: object) => `${B}/posts${qs(q ?? {})}`,
  listPosts: (q?: object) => api.get<Paginated<CompanyPost>>(`${B}/posts${qs(q ?? {})}`),
  getPost: (id: string) => api.get<CompanyPost>(`${B}/posts/${id}`),
  createPost: (body: {
    title: string;
    excerpt?: string | null;
    body: string;
    status?: CompanyPostStatus;
    pinned?: boolean;
  }) => api.post<CompanyPost>(`${B}/posts`, body),
  updatePost: (id: string, body: object) => api.patch<CompanyPost>(`${B}/posts/${id}`, body),
  deletePost: (id: string) => api.delete(`${B}/posts/${id}`),

  // Reports
  payrollReportPath: (month?: string) => `${B}/reports/payroll${qs(month ? { month } : {})}`,
  payrollReport: (month?: string) =>
    api.get<PayrollReport>(`${B}/reports/payroll${qs(month ? { month } : {})}`),

  // Self-service (/me)
  meDashboard: () => api.get<SelfDashboard>(`${B}/me/dashboard`),
  meProfile: () => api.get<SelfProfile>(`${B}/me/profile`),
  meClockStatus: () => api.get<SelfClockStatus>(`${B}/me/clock-status`),
  meClock: (body: { type: TimeEntryType; latitude?: number | null; longitude?: number | null }) =>
    api.post<TimeEntry>(`${B}/me/clock`, body),
  meTimesheet: (from: string, to: string) =>
    api.get<Timesheet>(`${B}/me/timesheet${qs({ from, to })}`),
  meCreateCorrection: (body: {
    kind: TimeCorrectionKind;
    targetDate: string;
    targetEntryId?: string | null;
    proposedType?: TimeEntryType | null;
    proposedTime?: string | null;
    reason: string;
  }) => api.post<TimeCorrection>(`${B}/me/corrections`, body),
  meEarnings: () => api.get<{ payslips: Payslip[] }>(`${B}/me/earnings`),
  meDocuments: () =>
    api.get<{ pendingSignature: EmployeeDocument[]; signed: EmployeeDocument[] }>(`${B}/me/documents`),
  meDocumentDownload: (docId: string) =>
    api.get<{ url: string; expiresIn: number }>(`${B}/me/documents/${docId}/download`),
  meSignDocument: (docId: string) =>
    api.post<DocumentSignature>(`${B}/me/documents/${docId}/sign`, { accepted: true }),
  meFeed: () => api.get<CompanyPost[]>(`${B}/me/feed`),
};

// Labels de enum agora vivem no dicionário i18n em `hr.enums.*` (ver
// src/i18n/messages). Resolva nos componentes via `useTranslations('hr.enums')`.

export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${String(m).padStart(2, '0')}`;
}
