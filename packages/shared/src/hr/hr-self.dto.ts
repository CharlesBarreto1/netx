import type { CompanyPostResponse } from './company-post.dto';
import type { EmployeeDocumentResponse } from './employee-document.dto';
import type { PayslipResponse } from './payroll.dto';
import type { TimeEntryType } from './timeclock.dto';

/**
 * Self-service do colaborador (portal): resolve o Employee a partir do User
 * logado (currentUser). Endpoints sob /hr/me. Não exige permissão hr.* — só
 * estar logado e ter um Employee vinculado.
 */

export interface SelfProfileResponse {
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

/** Estado atual do ponto pra renderizar o botão (bater entrada vs saída). */
export interface SelfClockStatusResponse {
  /** Próxima ação sugerida com base na última marcação do dia. */
  nextAction: TimeEntryType;
  lastEntry: { type: TimeEntryType; occurredAt: string } | null;
  todayWorkedMinutes: number;
  todayEntries: { type: TimeEntryType; occurredAt: string }[];
}

/** Painel inicial do portal. */
export interface SelfDashboardResponse {
  profile: SelfProfileResponse;
  clock: SelfClockStatusResponse;
  pendingSignatures: number; // documentos aguardando assinatura
  latestPosts: CompanyPostResponse[];
}

export interface SelfEarningsResponse {
  payslips: PayslipResponse[]; // últimos holerites com pagamento embutido
}

export interface SelfDocumentsResponse {
  pendingSignature: EmployeeDocumentResponse[];
  signed: EmployeeDocumentResponse[];
}
