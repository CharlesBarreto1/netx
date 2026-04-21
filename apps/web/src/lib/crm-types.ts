/**
 * Tipos do CRM espelhados do `@netx/shared` para consumo no client.
 *
 * Evitamos importar o pacote shared direto no web (que carregaria o Zod como
 * dependência de runtime) — replicamos só o shape de TypeScript.
 */

export type CustomerType = 'INDIVIDUAL' | 'COMPANY';

export type CustomerStatus =
  | 'LEAD'
  | 'PROSPECT'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'INACTIVE'
  | 'CHURNED';

export type TaxIdType =
  | 'CPF'
  | 'CNPJ'
  | 'CI'
  | 'RUC'
  | 'VAT'
  | 'NIF'
  | 'RFC'
  | 'CUIT'
  | 'RUT'
  | 'NIT'
  | 'SSN'
  | 'EIN'
  | 'OTHER';

export interface CustomerTagLite {
  id: string;
  name: string;
  color: string | null;
}

export interface Customer {
  id: string;
  tenantId: string;
  code: string | null;
  type: CustomerType;
  status: CustomerStatus;

  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  gender: string | null;
  motherName: string | null;

  companyName: string | null;
  tradeName: string | null;
  foundedAt: string | null;
  stateRegistration: string | null;
  municipalRegistration: string | null;

  displayName: string;
  taxId: string | null;
  taxIdType: TaxIdType | null;
  taxIdCountry: string | null;
  taxIdVerifiedAt: string | null;

  primaryEmail: string | null;
  primaryPhone: string | null;
  preferredLanguage: string | null;
  timezone: string | null;
  shortNote: string | null;
  metadata: Record<string, unknown> | null;

  tags?: CustomerTagLite[];

  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Paginated<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface CustomerTag {
  id: string;
  tenantId: string;
  name: string;
  color: string | null;
  description: string | null;
  customerCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type AddressType = 'BILLING' | 'SERVICE' | 'SHIPPING' | 'OTHER';

export interface CustomerAddress {
  id: string;
  customerId: string;
  type: AddressType;
  label: string | null;
  country: string;
  state: string | null;
  city: string;
  district: string | null;
  street: string;
  number: string | null;
  complement: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ContactType =
  | 'EMAIL'
  | 'PHONE'
  | 'MOBILE'
  | 'WHATSAPP'
  | 'TELEGRAM'
  | 'OTHER';

export interface CustomerContact {
  id: string;
  customerId: string;
  type: ContactType;
  label: string | null;
  value: string;
  isPrimary: boolean;
  isVerified: boolean;
  optIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ConsentPurpose =
  | 'MARKETING_EMAIL'
  | 'MARKETING_SMS'
  | 'MARKETING_WHATSAPP'
  | 'MARKETING_VOICE'
  | 'DATA_PROCESSING'
  | 'THIRD_PARTY_SHARING'
  | 'CREDIT_SCORE_QUERY'
  | 'CONTRACT_NOTIFICATION'
  | 'SUPPORT_RECORDING'
  | 'OTHER';

export type ConsentStatus = 'GRANTED' | 'REVOKED' | 'PENDING' | 'EXPIRED';

export type ConsentMethod =
  | 'WEB_FORM'
  | 'EMAIL'
  | 'IN_PERSON'
  | 'VOICE'
  | 'API'
  | 'IMPORT'
  | 'OTHER';

export interface CustomerConsent {
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

export interface CustomerNote {
  id: string;
  customerId: string;
  authorId: string | null;
  authorName: string | null;
  title: string | null;
  body: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export const CUSTOMER_STATUSES: CustomerStatus[] = [
  'LEAD',
  'PROSPECT',
  'ACTIVE',
  'SUSPENDED',
  'INACTIVE',
  'CHURNED',
];

export const CUSTOMER_TYPES: CustomerType[] = ['INDIVIDUAL', 'COMPANY'];

export const TAX_ID_TYPES: TaxIdType[] = [
  'CPF',
  'CNPJ',
  'CI',
  'RUC',
  'VAT',
  'NIF',
  'RFC',
  'CUIT',
  'RUT',
  'NIT',
  'SSN',
  'EIN',
  'OTHER',
];

export const ADDRESS_TYPES: AddressType[] = ['BILLING', 'SERVICE', 'SHIPPING', 'OTHER'];
export const ADDRESS_TYPE_LABEL: Record<AddressType, string> = {
  BILLING: 'Cobrança',
  SERVICE: 'Instalação',
  SHIPPING: 'Entrega',
  OTHER: 'Outro',
};

export const CONTACT_TYPES: ContactType[] = [
  'EMAIL',
  'PHONE',
  'MOBILE',
  'WHATSAPP',
  'TELEGRAM',
  'OTHER',
];
export const CONTACT_TYPE_LABEL: Record<ContactType, string> = {
  EMAIL: 'Email',
  PHONE: 'Telefone',
  MOBILE: 'Celular',
  WHATSAPP: 'WhatsApp',
  TELEGRAM: 'Telegram',
  OTHER: 'Outro',
};

export const CONSENT_PURPOSES: ConsentPurpose[] = [
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
];
export const CONSENT_PURPOSE_LABEL: Record<ConsentPurpose, string> = {
  MARKETING_EMAIL: 'Marketing · Email',
  MARKETING_SMS: 'Marketing · SMS',
  MARKETING_WHATSAPP: 'Marketing · WhatsApp',
  MARKETING_VOICE: 'Marketing · Voz',
  DATA_PROCESSING: 'Tratamento de dados',
  THIRD_PARTY_SHARING: 'Compartilhamento com terceiros',
  CREDIT_SCORE_QUERY: 'Consulta de crédito',
  CONTRACT_NOTIFICATION: 'Notificação contratual',
  SUPPORT_RECORDING: 'Gravação de atendimento',
  OTHER: 'Outro',
};

export const CONSENT_METHODS: ConsentMethod[] = [
  'WEB_FORM',
  'EMAIL',
  'IN_PERSON',
  'VOICE',
  'API',
  'IMPORT',
  'OTHER',
];
export const CONSENT_METHOD_LABEL: Record<ConsentMethod, string> = {
  WEB_FORM: 'Formulário web',
  EMAIL: 'Email',
  IN_PERSON: 'Presencial',
  VOICE: 'Voz',
  API: 'API',
  IMPORT: 'Importação',
  OTHER: 'Outro',
};

export const CONSENT_STATUSES: ConsentStatus[] = ['GRANTED', 'REVOKED', 'PENDING', 'EXPIRED'];
export const CONSENT_STATUS_LABEL: Record<ConsentStatus, string> = {
  GRANTED: 'Concedido',
  REVOKED: 'Revogado',
  PENDING: 'Pendente',
  EXPIRED: 'Expirado',
};

export const COUNTRY_OPTIONS: Array<{ code: string; name: string }> = [
  { code: 'BR', name: 'Brasil' },
  { code: 'PY', name: 'Paraguai' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colômbia' },
  { code: 'MX', name: 'México' },
  { code: 'US', name: 'Estados Unidos' },
  { code: 'PT', name: 'Portugal' },
  { code: 'ES', name: 'Espanha' },
  { code: 'IT', name: 'Itália' },
  { code: 'FR', name: 'França' },
];
