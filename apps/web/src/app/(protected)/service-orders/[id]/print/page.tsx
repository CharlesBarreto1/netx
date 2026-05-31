'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
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
      const t = window.setTimeout(() => window.print(), 350);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [os, contract, customer, addresses]);

  if (osErr) {
    const msg =
      osErr instanceof ApiError ? osErr.friendlyMessage : 'Falha ao carregar O.S';
    return <p className="p-6 text-sm text-red-600">{msg}</p>;
  }
  if (!os || !contract || !customer || addresses === undefined) {
    return <PageLoader label="Carregando…" />;
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

  // Status em PT pra impressão (label fixo, não i18n — printout é
  // documento físico pro técnico/cliente, mantém consistência).
  const statusLabel: Record<typeof os.status, string> = {
    OPEN: 'Aberta',
    SCHEDULED: 'Agendada',
    EN_ROUTE: 'A caminho',
    IN_PROGRESS: 'Em Execução',
    COMPLETED: 'Finalizada',
    CANCELLED: 'Cancelada',
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
          Imprimir / salvar PDF
        </button>
        <button
          type="button"
          onClick={() => window.history.back()}
          className="text-sm text-slate-600 hover:underline"
        >
          ← Voltar
        </button>
      </div>

      {/* Cabeçalho */}
      <header className="border-b-2 border-slate-900 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Ordem de Serviço
            </h1>
            <p className="mt-0.5 text-sm font-semibold text-slate-700">
              {os.code ?? `#${os.id.slice(0, 8)}`}
            </p>
            <p className="text-xs text-slate-500">
              Aberta em {formatDateTime(os.openedAt)}
              {os.scheduledAt && ` · Agendada para ${formatDateTime(os.scheduledAt)}`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wider text-slate-500">
              Status
            </p>
            <p className="text-base font-semibold">{statusLabel[os.status]}</p>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-slate-500">
              Motivo
            </p>
            <p className="text-sm font-medium">{os.reason?.name ?? '—'}</p>
          </div>
        </div>
      </header>

      {/* Cliente */}
      <Section title="Dados do Cliente">
        <Grid>
          <Field label="Nome / Razão social" value={customer.displayName} colSpan={2} />
          <Field
            label="Documento"
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
            label="Tipo"
            value={customer.type === 'INDIVIDUAL' ? 'Pessoa Física' : 'Pessoa Jurídica'}
          />
          <Field label="Email" value={customer.primaryEmail ?? '—'} />
          <Field label="Telefone" value={customer.primaryPhone ?? '—'} />
        </Grid>
      </Section>

      {/* Endereço */}
      <Section title="Endereço de instalação">
        <p className="text-sm">{addressLine}</p>
        {contract.installationMapsUrl && (
          <p className="mt-1 text-xs text-slate-600">
            Localização: {contract.installationMapsUrl}
          </p>
        )}
        {primary?.latitude != null && primary?.longitude != null && (
          <p className="mt-1 text-xs text-slate-600">
            Coordenadas: {primary.latitude}, {primary.longitude}
          </p>
        )}
      </Section>

      {/* Contrato */}
      <Section title="Contrato e Plano">
        <Grid>
          <Field
            label="Contrato"
            value={contract.code ?? `#${contract.id.slice(0, 8)}`}
          />
          <Field label="Status do contrato" value={contract.status} />
          <Field
            label="PPPoE — usuário"
            value={contract.pppoeUsername ?? '—'}
            mono
          />
          <Field
            label="PPPoE — senha"
            value={contract.pppoePassword ?? '—'}
            mono
          />
          <Field label="Plano (banda)" value={`${contract.bandwidthMbps} Mbps`} />
          <Field label="Mensalidade" value={formatMoney(contract.monthlyValue)} />
          <Field label="Dia de vencimento" value={`${contract.dueDay}`} />
        </Grid>
      </Section>

      {/* Demanda */}
      <Section title="Descrição da abertura">
        <p className="whitespace-pre-wrap text-sm">{os.openDescription}</p>
        {os.assignedTo && (
          <p className="mt-2 text-xs text-slate-600">
            Técnico atribuído:{' '}
            <strong>
              {os.assignedTo.firstName} {os.assignedTo.lastName}
            </strong>
          </p>
        )}
      </Section>

      {/* CHECKLIST FTTH — campos pra preencher à mão */}
      <Section title="Checklist técnico (preencher em campo)">
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <BlankField label="Sinal óptico no ONU (dBm)" />
          <BlankField label="Sinal óptico no OLT (dBm)" />
          <BlankField label="Velocidade — Download (Mbps)" />
          <BlankField label="Velocidade — Upload (Mbps)" />
          <BlankField label="Latência (ms)" />
          <BlankField label="Atenuação do cabo (dB)" />
          <BlankField label="Modelo do ONU/Roteador" />
          <BlankField label="Serial do ONU/Roteador" />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
          <YesNo label="Conectores ópticos limpos / trocados" />
          <YesNo label="Cabo de fibra reaproveitado / íntegro" />
          <YesNo label="WiFi 2.4 GHz funcionando" />
          <YesNo label="WiFi 5 GHz funcionando" />
          <YesNo label="ONU substituída" />
          <YesNo label="Roteador substituído" />
          <YesNo label="Cliente assistiu ao teste de velocidade" />
          <YesNo label="Cliente satisfeito com o atendimento" />
        </div>
      </Section>

      {/* Observações do técnico (linhas pra escrever) */}
      <Section title="Observações do técnico">
        <BlankLines lines={4} />
      </Section>

      {/* Solução / fechamento — se já preenchido na O.S, mostra. Caso contrário,
          deixa linhas em branco. */}
      <Section title="Descrição do fechamento / Solução aplicada">
        {os.closeDescription ? (
          <p className="whitespace-pre-wrap text-sm">{os.closeDescription}</p>
        ) : (
          <BlankLines lines={4} />
        )}
      </Section>

      {/* Assinaturas */}
      <Section title="Atendimento e assinaturas">
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
          <BlankField label="Data e hora do atendimento" />
          <BlankField label="Duração do atendimento" />
        </div>
        <div className="mt-8 grid grid-cols-2 gap-x-8">
          <SignatureLine label="Assinatura do técnico" />
          <SignatureLine label="Assinatura do cliente" />
        </div>
      </Section>

      <footer className="mt-10 border-t border-slate-300 pt-3 text-[10px] text-slate-500">
        Documento de campo — uso interno do provedor. ID da O.S:{' '}
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
function YesNo({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm">{label}:</span>
      <span className="ml-auto whitespace-nowrap text-sm">
        ( ) Sim &nbsp; ( ) Não
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
