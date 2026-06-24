'use client';

import { useState } from 'react';
import useSWR from 'swr';

import { Select } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { btgApi, type BrPaymentGateway } from '@/lib/finance-api';
import { hasPermission } from '@/lib/session';

import EfiSettingsPage from '../efi/page';
import BtgSettingsPage from '../btg/page';

/**
 * Configurações → Financeiro → APIs de Cobrança BR.
 *
 * Página única que reúne a configuração dos gateways BR (EFI e BTG) e o gateway
 * PADRÃO do tenant (pré-preenchido nos contratos novos). A escolha de qual
 * gateway cobra cada contrato é feita NO CONTRATO; aqui ficam só as credenciais
 * (por gateway) e o padrão sugerido.
 */
type Tab = 'default' | 'efi' | 'btg';

export default function BrBillingSettingsPage() {
  const [tab, setTab] = useState<Tab>('default');

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">APIs de Cobrança BR</h1>
        <p className="mt-1 text-sm text-text-muted">
          Credenciais dos gateways (EFI e BTG) e o gateway padrão do tenant. A
          forma de cobrança é escolhida por contrato.
        </p>
      </header>

      <div className="flex gap-1 border-b border-border">
        <TabButton active={tab === 'default'} onClick={() => setTab('default')}>
          Gateway padrão
        </TabButton>
        <TabButton active={tab === 'efi'} onClick={() => setTab('efi')}>
          EFI
        </TabButton>
        <TabButton active={tab === 'btg'} onClick={() => setTab('btg')}>
          BTG
        </TabButton>
      </div>

      {tab === 'default' && <DefaultGatewayCard />}
      {tab === 'efi' && <EfiSettingsPage />}
      {tab === 'btg' && <BtgSettingsPage />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-primary text-text'
          : 'border-transparent text-text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}

function DefaultGatewayCard() {
  const canWrite =
    hasPermission('efi.config.write') || hasPermission('btg.config.write');
  const { data, mutate, isLoading } = useSWR<{ gateway: BrPaymentGateway }>(
    '/v1/btg/gateway',
    () => btgApi.getGateway(),
  );
  const [saving, setSaving] = useState(false);

  if (isLoading || !data) return <PageLoader />;

  async function save(gateway: BrPaymentGateway) {
    setSaving(true);
    try {
      await btgApi.setGateway(gateway);
      toast.success('Gateway padrão atualizado');
      await mutate();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <h2 className="mb-1 text-base font-semibold text-text">Gateway padrão do tenant</h2>
      <p className="mb-3 text-xs text-text-muted">
        Valor pré-preenchido ao criar um contrato novo. Não muda contratos
        existentes — cada contrato carrega o seu próprio gateway.
      </p>
      <div className="flex items-center gap-3">
        <Select
          value={data.gateway}
          disabled={!canWrite || saving}
          onChange={(e) => void save(e.target.value as BrPaymentGateway)}
          className="max-w-xs"
        >
          <option value="MANUAL">Manual (sem gateway)</option>
          <option value="EFI">EFI (Pix/Boleto)</option>
          <option value="BTG">BTG (Pix/Boleto)</option>
        </Select>
        {saving && <span className="text-xs text-text-muted">salvando…</span>}
      </div>
      {!canWrite && (
        <p className="mt-2 text-xs text-text-muted">
          Sem permissão para alterar (efi.config.write ou btg.config.write).
        </p>
      )}
    </section>
  );
}
