'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import {
  FieldError,
  FieldHelp,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui/Input';
import { ApiError } from '@/lib/api';
import { formatCPF, formatCNPJ, formatPYRUC } from '@/lib/format';
import {
  CUSTOMER_STATUSES,
  COUNTRY_OPTIONS,
  TAX_ID_TYPES,
  type Customer,
  type CustomerStatus,
  type CustomerType,
  type TaxIdType,
} from '@/lib/crm-types';
import { useTenantConfig } from '@/lib/tenant-config';
import { STATUS_LABEL } from '@/components/ui/Badge';

export interface CustomerFormValues {
  type: CustomerType;
  status?: CustomerStatus;
  code?: string;
  // PF
  firstName?: string;
  lastName?: string;
  birthDate?: string | null;
  gender?: string | null;
  motherName?: string | null;
  // PJ
  companyName?: string;
  tradeName?: string | null;
  foundedAt?: string | null;
  stateRegistration?: string | null;
  municipalRegistration?: string | null;
  // Fiscal
  taxIdType?: TaxIdType | null;
  taxIdCountry?: string | null;
  taxIdValue?: string | null;
  // Contato
  primaryEmail?: string | null;
  primaryPhone?: string | null;
  preferredLanguage?: string | null;
  timezone?: string | null;
  shortNote?: string | null;
}

export interface CustomerFormProps {
  mode: 'create' | 'edit';
  initial?: Customer;
  // Create: recebe o body pronto (com discriminator). Edit: recebe partial.
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
}

function defaultValues(
  initial?: Customer,
  presetDefaults?: { taxIdCountry: string; taxIdType: TaxIdType },
): CustomerFormValues {
  if (!initial) {
    return {
      type: 'INDIVIDUAL',
      status: 'LEAD',
      taxIdCountry: presetDefaults?.taxIdCountry ?? 'PY',
      taxIdType: presetDefaults?.taxIdType ?? 'CI',
    };
  }
  return {
    type: initial.type,
    status: initial.status,
    code: initial.code ?? undefined,
    firstName: initial.firstName ?? undefined,
    lastName: initial.lastName ?? undefined,
    birthDate: initial.birthDate,
    gender: initial.gender,
    motherName: initial.motherName,
    companyName: initial.companyName ?? undefined,
    tradeName: initial.tradeName,
    foundedAt: initial.foundedAt,
    stateRegistration: initial.stateRegistration,
    municipalRegistration: initial.municipalRegistration,
    taxIdType: initial.taxIdType,
    taxIdCountry: initial.taxIdCountry,
    taxIdValue: initial.taxId,
    primaryEmail: initial.primaryEmail,
    primaryPhone: initial.primaryPhone,
    preferredLanguage: initial.preferredLanguage,
    timezone: initial.timezone,
    shortNote: initial.shortNote,
  };
}

function autoFormatTaxId(type: TaxIdType | null | undefined, v: string) {
  switch (type) {
    case 'CPF':
      return formatCPF(v);
    case 'CNPJ':
      return formatCNPJ(v);
    case 'RUC':
      return formatPYRUC(v);
    default:
      return v;
  }
}

export function CustomerForm({ mode, initial, onSubmit, onCancel }: CustomerFormProps) {
  const { preset } = useTenantConfig();
  // Default do PF do país (CPF para BR, CI para PY, etc). PJ default vem na
  // troca de tipo no Select abaixo.
  const [v, setV] = useState<CustomerFormValues>(() =>
    defaultValues(initial, {
      taxIdCountry: preset.defaultTaxIdCountry,
      taxIdType: preset.defaultTaxIdType.INDIVIDUAL as TaxIdType,
    }),
  );
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function upd<K extends keyof CustomerFormValues>(k: K, val: CustomerFormValues[K]) {
    setV((prev) => ({ ...prev, [k]: val }));
  }

  const isEdit = mode === 'edit';
  const isPF = v.type === 'INDIVIDUAL';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      const body = buildPayload(v, isEdit);
      await onSubmit(body);
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.friendlyMessage);
        if (err.problem.errors) {
          const map: Record<string, string> = {};
          for (const e of err.problem.errors) {
            if (e.path) map[e.path] = e.message;
          }
          setFieldErrors(map);
        }
      } else {
        setFormError((err as Error).message ?? 'Erro inesperado');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {formError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {formError}
        </div>
      )}

      {/* Tipo + status */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <Label htmlFor="type" required>
            Tipo de cliente
          </Label>
          <Select
            id="type"
            value={v.type}
            onChange={(e) => {
              const next = e.target.value as CustomerType;
              // Ao trocar PF/PJ no create, atualiza o tipo de documento default
              // pro que faz sentido nesse país (BR PF=CPF, PJ=CNPJ; PY PF=CI, PJ=RUC).
              setV((prev) => ({
                ...prev,
                type: next,
                taxIdType: preset.defaultTaxIdType[next] as TaxIdType,
                taxIdCountry: preset.defaultTaxIdCountry,
              }));
            }}
            disabled={isEdit}
          >
            <option value="INDIVIDUAL">Pessoa Física</option>
            <option value="COMPANY">Pessoa Jurídica</option>
          </Select>
          {isEdit && <FieldHelp>O tipo não pode ser alterado após a criação.</FieldHelp>}
        </div>
        <div>
          <Label htmlFor="status">Status</Label>
          <Select
            id="status"
            value={v.status ?? ''}
            onChange={(e) => upd('status', (e.target.value || undefined) as CustomerStatus)}
          >
            {CUSTOMER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s] ?? s}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="code">Código interno</Label>
          <Input
            id="code"
            maxLength={32}
            value={v.code ?? ''}
            onChange={(e) => upd('code', e.target.value || undefined)}
            placeholder="Opcional"
          />
          <FieldError>{fieldErrors.code}</FieldError>
        </div>
      </section>

      {/* Dados do titular (PF) */}
      {isPF ? (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <Label htmlFor="firstName" required={!isEdit}>
              Nome
            </Label>
            <Input
              id="firstName"
              value={v.firstName ?? ''}
              onChange={(e) => upd('firstName', e.target.value)}
              required={!isEdit}
            />
            <FieldError>{fieldErrors.firstName}</FieldError>
          </div>
          <div>
            <Label htmlFor="lastName" required={!isEdit}>
              Sobrenome
            </Label>
            <Input
              id="lastName"
              value={v.lastName ?? ''}
              onChange={(e) => upd('lastName', e.target.value)}
              required={!isEdit}
            />
            <FieldError>{fieldErrors.lastName}</FieldError>
          </div>
          <div>
            <Label htmlFor="birthDate">Data de nascimento</Label>
            <Input
              id="birthDate"
              type="date"
              value={v.birthDate ?? ''}
              onChange={(e) => upd('birthDate', e.target.value || null)}
            />
          </div>
          <div>
            <Label htmlFor="gender">Gênero</Label>
            <Input
              id="gender"
              value={v.gender ?? ''}
              onChange={(e) => upd('gender', e.target.value || null)}
              placeholder="Ex.: F, M, Não-binário…"
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="motherName">Nome da mãe</Label>
            <Input
              id="motherName"
              value={v.motherName ?? ''}
              onChange={(e) => upd('motherName', e.target.value || null)}
            />
          </div>
        </section>
      ) : (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <Label htmlFor="companyName" required={!isEdit}>
              Razão social
            </Label>
            <Input
              id="companyName"
              value={v.companyName ?? ''}
              onChange={(e) => upd('companyName', e.target.value)}
              required={!isEdit}
            />
            <FieldError>{fieldErrors.companyName}</FieldError>
          </div>
          <div>
            <Label htmlFor="tradeName">Nome fantasia</Label>
            <Input
              id="tradeName"
              value={v.tradeName ?? ''}
              onChange={(e) => upd('tradeName', e.target.value || null)}
            />
          </div>
          <div>
            <Label htmlFor="foundedAt">Fundação</Label>
            <Input
              id="foundedAt"
              type="date"
              value={v.foundedAt ?? ''}
              onChange={(e) => upd('foundedAt', e.target.value || null)}
            />
          </div>
          <div>
            <Label htmlFor="stateRegistration">Inscrição estadual</Label>
            <Input
              id="stateRegistration"
              value={v.stateRegistration ?? ''}
              onChange={(e) => upd('stateRegistration', e.target.value || null)}
            />
          </div>
          <div>
            <Label htmlFor="municipalRegistration">Inscrição municipal</Label>
            <Input
              id="municipalRegistration"
              value={v.municipalRegistration ?? ''}
              onChange={(e) => upd('municipalRegistration', e.target.value || null)}
            />
          </div>
        </section>
      )}

      {/* Documento fiscal */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
          Documento fiscal
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <Label htmlFor="taxIdType">Tipo</Label>
            <Select
              id="taxIdType"
              value={v.taxIdType ?? ''}
              onChange={(e) => upd('taxIdType', (e.target.value || null) as TaxIdType | null)}
            >
              <option value="">—</option>
              {TAX_ID_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="taxIdCountry">País</Label>
            <Select
              id="taxIdCountry"
              value={v.taxIdCountry ?? ''}
              onChange={(e) => upd('taxIdCountry', e.target.value || null)}
            >
              <option value="">—</option>
              {COUNTRY_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="taxIdValue">Número</Label>
            <Input
              id="taxIdValue"
              value={v.taxIdValue ?? ''}
              onChange={(e) => upd('taxIdValue', autoFormatTaxId(v.taxIdType, e.target.value))}
              placeholder="Será validado pelo backend"
            />
            <FieldHelp>
              O backend valida CPF/CNPJ (BR) e RUC (PY). Outros países aceitam valor livre.
            </FieldHelp>
            <FieldError>{fieldErrors['taxId.value']}</FieldError>
          </div>
        </div>
      </section>

      {/* Contato principal */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
          Contato principal
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="primaryEmail">Email</Label>
            <Input
              id="primaryEmail"
              type="email"
              value={v.primaryEmail ?? ''}
              onChange={(e) => upd('primaryEmail', e.target.value || null)}
            />
            <FieldError>{fieldErrors.primaryEmail}</FieldError>
          </div>
          <div>
            <Label htmlFor="primaryPhone">Telefone</Label>
            <Input
              id="primaryPhone"
              value={v.primaryPhone ?? ''}
              onChange={(e) => upd('primaryPhone', e.target.value || null)}
              placeholder="+55 11 99999-8888"
            />
            <FieldError>{fieldErrors.primaryPhone}</FieldError>
          </div>
        </div>
      </section>

      {/* Preferências / observações */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
          Preferências e observações
        </h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="preferredLanguage">Idioma</Label>
            <Input
              id="preferredLanguage"
              value={v.preferredLanguage ?? ''}
              onChange={(e) => upd('preferredLanguage', e.target.value || null)}
              placeholder="pt-BR, en, es…"
            />
          </div>
          <div>
            <Label htmlFor="timezone">Fuso horário</Label>
            <Input
              id="timezone"
              value={v.timezone ?? ''}
              onChange={(e) => upd('timezone', e.target.value || null)}
              placeholder="America/Sao_Paulo"
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="shortNote">Observações rápidas</Label>
            <Textarea
              id="shortNote"
              maxLength={500}
              rows={3}
              value={v.shortNote ?? ''}
              onChange={(e) => upd('shortNote', e.target.value || null)}
            />
            <FieldHelp>Máx. 500 caracteres. Use para notas internas não-formais.</FieldHelp>
          </div>
        </div>
      </section>

      <footer className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancelar
          </Button>
        )}
        <Button type="submit" loading={submitting}>
          {isEdit ? 'Salvar alterações' : 'Criar cliente'}
        </Button>
      </footer>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Serialização do formulário para o payload do backend
// -----------------------------------------------------------------------------

function stripEmpty<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(obj)) {
    if (val === '' || val === undefined) continue;
    out[k] = val;
  }
  return out as T;
}

function buildTaxId(v: CustomerFormValues) {
  if (!v.taxIdType || !v.taxIdCountry || !v.taxIdValue) return undefined;
  // Para BR removemos máscara antes de enviar.
  const raw = ['CPF', 'CNPJ'].includes(v.taxIdType)
    ? v.taxIdValue.replace(/\D/g, '')
    : v.taxIdValue.trim();
  return {
    type: v.taxIdType,
    country: v.taxIdCountry,
    value: raw,
  };
}

function buildPayload(v: CustomerFormValues, isEdit: boolean): Record<string, unknown> {
  const taxId = buildTaxId(v);
  const common: Record<string, unknown> = stripEmpty({
    code: v.code,
    status: v.status,
    primaryEmail: v.primaryEmail,
    primaryPhone: v.primaryPhone,
    preferredLanguage: v.preferredLanguage,
    timezone: v.timezone,
    shortNote: v.shortNote,
  });
  if (taxId) common.taxId = taxId;

  if (v.type === 'INDIVIDUAL') {
    Object.assign(
      common,
      stripEmpty({
        firstName: v.firstName,
        lastName: v.lastName,
        birthDate: v.birthDate,
        gender: v.gender,
        motherName: v.motherName,
      }),
    );
  } else {
    Object.assign(
      common,
      stripEmpty({
        companyName: v.companyName,
        tradeName: v.tradeName,
        foundedAt: v.foundedAt,
        stateRegistration: v.stateRegistration,
        municipalRegistration: v.municipalRegistration,
      }),
    );
  }

  if (!isEdit) {
    // No create, discriminator é obrigatório.
    common.type = v.type;
  }

  return common;
}
