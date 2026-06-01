'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import {
  contractsApi,
  type Contract,
} from '@/lib/contracts-api';
import type { Customer, CustomerAddress } from '@/lib/crm-types';
import {
  serviceOrdersApi,
  type ServiceOrderResponse,
} from '@/lib/service-orders-api';
import { formatDate, formatDateTime, formatMoney, formatTaxId } from '@/lib/format';

/**
 * /service-orders/[id]/print — versão printer-friendly da O.S.
 *
 * Carrega:
 *   - O.S (com motivo, descrições, status, datas)
 *   - Contrato (incluindo PPPoE password — só vem em GET /v1/contracts/:id)
 *   - Customer (com endereços primário)
 *
 * Depois dispara `window.print()` automaticamente. Botões "Imprimir/PDF" e
 * "Voltar" só aparecem na tela. CSS @media print força A4.
 *
 * Layout: campos vazios pro técnico preencher à mão (sinal, velocidade,
 * checklist) — pensado pra atendimento de FTTH.
 */
export default function ServiceOrderPrintPage() {
  const t = useTranslations('soPrint');
  const tc = useTranslations('common');
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const osKey = id ? serviceOrdersApi.getPath(id) : null;
  const { data: os, error: osErr } = useSWR<ServiceOrderResponse>(osKey);

  const contractKey = os ? `/v1/contracts/${os.contractId}` : null;
  const { data: contract } = useSWR<Contract>(contractKey);

  const customerKey = contract ? `/v1/customers/${contract.customerId}` : null;
  const { data: customer } = useSWR<Customer>(customerKey);

  const addressesKey = contract
    ? `/v1/customers/${contract.customerId}/addresses`
    : null;
  const { data: addresses } = useSWR<CustomerAddress[]>(addressesKey);

  // Auto-print quando todos os 4 SWRs resolvem.
  useEffect(() => {
    if (os && contract && customer && addresses !== undefined) {
      const timer = window.setTimeout(() => window.print(), 350);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [os, contract, customer, addresses]);

  if (osErr) {
    const msg =
      osErr instanceof ApiError ? osErr.friendlyMessage : t('failureLoading');
    return <p className="p-6 text-sm text-red-600">{msg}</p>;
  }
  if (!os || !contract || !customer || addresses === undefined) {
    return <PageLoader label={tc('loading')} />;
  }

  const primary = addresses.find((a) => a.isPrimary) ?? addresses[0];
  const addressLine = primary
    ? [
        primary.street,
        primary.number,
        primary.complement,
        primary.district,
        primary.city,
        primary.state,
        primary.postalCode,
      ]
        .filter(Boolean)
        .join(', ')
    : contract.installationAddress;

  const statusLabel: Record<typeof os.status, string> = {
    OPEN: t('status.OPEN'),
    SCHEDULED: t('status.SCHEDULED'),
    EN_ROUTE: t('status.EN_ROUTE'),
    IN_PROGRESS: t('status.IN_PROGRESS'),
    COMPLETED: t('status.COMPLETED'),
    CANCELLED: t('status.CANCELLED'),
  };

  return (
    <div className="mx-auto max-w-[820px] bg-white p-8 text-slate-900 print:p-0">
      {/* Botões só na tela */}
      <div className="mb-6 flex items-center justify-between print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          {t('printSavePdf')}
        </button>
        <button
          type="button"
          onClick={() => window.history.back()}
          className="text-sm text-slate-600 hover:underline"
        >
          ← {tc('back')}
        </button>
      </div>

      {/* Cabeçalho */}
      <header className="border-b-2 border-slate-900 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t('title')}
            </h1>
            <p className="mt-0.5 text-sm font-semibold text-slate-700">
              {os.code ?? `#${os.id.slice(0, 8)}`}
            </p>
            <p className="text-xs text-slate-500">
              {t('openedAt', { date: formatDateTime(os.openedAt) })}
              {os.scheduledAt &&
                ` · ${t('scheduledFor', { date: formatDateTime(os.scheduledAt) })}`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              {tc('status')}
            </p>
            <p className="text-base font-semibold">{statusLabel[os.status]}</p>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-slate-500">
              {t('reason')}
            </p>
            <p className="text-sm font-medium">{os.reason?.name ?? '—'}</p>
          </div>
        </div>
      </header>

      {/* Cliente */}
      <Section title={t('customerData')}>
        <Grid>
          <Field label={t('nameOrCompany')} value={customer.displayName} colSpan={2} />
          <Field
            label={t('document')}
            value={
              customer.taxId
                ? `${customer.taxIdType ?? ''} ${formatTaxId(
                    customer.taxIdType,
                    customer.taxId,
                  )}`
                : '—'
            }
          />
          <Field
            label={tc('type')}
            value={
              customer.type === 'INDIVIDUAL'
                ? t('individual')
                : t('company')
            }
          />
          <Field label={tc('email')} value={customer.primaryEmail ?? '—'} />
          <Field label={tc('phone')} value={customer.primaryPhone ?? '—'} />
        </Grid>
      </Section>

      {/* Endereço */}
      <Section title={t('installationAddress')}>
        <p className="text-sm">{addressLine}</p>
        {contract.installationMapsUrl && (
          <p className="mt-1 text-xs text-slate-600">
            {t('location')}: {contract.installationMapsUrl}
          </p>
        )}
        {primary?.latitude != null && primary?.longitude != null && (
          <p className="mt-1 text-xs text-slate-600">
            {t('coordinates')}: {primary.latitude}, {primary.longitude}
          </p>
        )}
      </Section>

      {/* Contrato */}
      <Section title={t('contractAndPlan')}>
        <Grid>
          <Field
            label={t('contract')}
            value={contract.code ?? `#${contract.id.slice(0, 8)}`}
          />
          <Field label={t('contractStatus')} value={contract.status} />
          <Field
            label={t('pppoeUser')}
            value={contract.pppoeUsername ?? '—'}
            mono
          />
          <Field
            label={t('pppoePassword')}
            value={contract.pppoePassword ?? '—'}
            mono
          />
          <Field label={t('planBandwidth')} value={`${contract.bandwidthMbps} Mbps`} />
          <Field label={t('monthlyValue')} value={formatMoney(contract.monthlyValue)} />
          <Field label={t('dueDay')} value={`${contract.dueDay}`} />
        </Grid>
      </Section>

      {/* Demanda */}
      <Section title={t('openDescription')}>
        <p className="whitespace-pre-wrap text-sm">{os.openDescription}</p>
        {os.assignedTo && (
          <p className="mt-2 text-xs text-slate-600">
            {t('assignedTechnician')}:{' '}
            <strong>
              {os.assignedTo.firstName} {os.assignedTo.lastName}
            </strong>
          </p>
        )}
      </Section>

      {/* CHECKLIST FTTH — campos pra preencher à mão */}
      <Section title={t('technicalChecklist')}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <BlankField label={t('opticalSignalOnu')} />
          <BlankField label={t('opticalSignalOlt')} />
          <BlankField label={t('speedDownload')} />
          <BlankField label={t('speedUpload')} />
          <BlankField label={t('latency')} />
          <BlankField label={t('cableAttenuation')} />
          <BlankField label={t('onuModel')} />
          <BlankField label={t('onuSerial')} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
          <YesNo label={t('opticalConnectorsClean')} yes={tc('yes')} no={tc('no')} />
          <YesNo label={t('fiberCableIntact')} yes={tc('yes')} no={tc('no')} />
          <YesNo label={t('wifi24Working')} yes={tc('yes')} no={tc('no')} />
          <YesNo label={t('wifi5Working')} yes={tc('yes')} no={tc('no')} />
          <YesNo label={t('onuReplaced')} yes={tc('yes')} no={tc('no')} />
          <YesNo label={t('routerReplaced')} yes={tc('yes')} no={tc('no')} />
          <YesNo label={t('customerWatchedSpeedTest')} yes={tc('yes')} no={tc('no')} />
          <YesNo label={t('customerSatisfied')} yes={tc('yes')} no={tc('no')} />
        </div>
      </Section>

      {/* Observações do técnico (linhas pra escrever) */}
      <Section title={t('technicianNotes')}>
        <BlankLines lines={4} />
      </Section>

      {/* Solução / fechamento — se já preenchido na O.S, mostra. Caso contrário,
          deixa linhas em branco. */}
      <Section title={t('closeDescription')}>
        {os.closeDescription ? (
          <p className="whitespace-pre-wrap text-sm">{os.closeDescription}</p>
        ) : (
          <BlankLines lines={4} />
        )}
      </Section>

      {/* Assinaturas */}
      <Section title={t('serviceAndSignatures')}>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
          <BlankField label={t('serviceDateTime')} />
          <BlankField label={t('serviceDuration')} />
        </div>
        <div className="mt-8 grid grid-cols-2 gap-x-8">
          <SignatureLine label={t('technicianSignature')} />
          <SignatureLine label={t('customerSignature')} />
        </div>
      </Section>

      <footer className="mt-10 border-t border-slate-300 pt-3 text-[10px] text-slate-500">
        {t('footerNote')}{' '}
        <span className="font-mono">{os.id}</span>
      </footer>

      {/* Substituído `<style jsx global>` por dangerouslySetInnerHTML —
          Next 16 não tipa a prop `jsx` da styled-jsx. CSS estático, seguro. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              @page { size: A4 portrait; margin: 14mm; }
              body { background: #fff !important; }
              /* Evita quebrar seções no meio. */
              section { break-inside: avoid; }
            }
          `,
        }}
      />
    </div>
  );
}

// =============================================================================
// PEÇAS DE LAYOUT (componentes locais)
// =============================================================================
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h2>
      <div className="rounded border border-slate-300 p-3">{children}</div>
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">{children}</div>
  );
}

function Field({
  label,
  value,
  colSpan,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  colSpan?: 1 | 2;
  mono?: boolean;
}) {
  return (
    <div className={colSpan === 2 ? 'col-span-2' : undefined}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className={mono ? 'font-mono text-sm' : 'text-sm'}>{value || '—'}</p>
    </div>
  );
}

/** Campo em branco pra preencher à mão. */
function BlankField({ label }: { label: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <div className="mt-2 border-b border-slate-400 pb-px">&nbsp;</div>
    </div>
  );
}

/** ( ) Sim    ( ) Não pra checklist. */
function YesNo({ label, yes, no }: { label: string; yes: string; no: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm">{label}:</span>
      <span className="ml-auto whitespace-nowrap text-sm">
        ( ) {yes} &nbsp; ( ) {no}
      </span>
    </div>
  );
}

/** Linhas em branco pra texto livre. */
function BlankLines({ lines }: { lines: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="border-b border-slate-400 pb-px">
          &nbsp;
        </div>
      ))}
    </div>
  );
}

function SignatureLine({ label }: { label: string }) {
  return (
    <div>
      <div className="mt-10 border-t border-slate-700 pt-1 text-center text-xs text-slate-700">
        {label}
      </div>
    </div>
  );
}
