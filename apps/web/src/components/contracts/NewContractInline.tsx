'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import {
  FieldError,
  FieldHelp,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui/Input';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  contractsApi,
  type Contract,
  type ContractAuthMethod,
  type CreateContractInput,
} from '@/lib/contracts-api';
import type { Customer, Paginated } from '@/lib/crm-types';
import { fibermapApi } from '@/lib/fibermap-api';
import { btgApi, type BrPaymentGateway } from '@/lib/finance-api';
import { plansApi, type Plan } from '@/lib/plans-api';
import { hasPermission } from '@/lib/session';
import { useTenantConfig } from '@/lib/tenant-config';
import { pppoeLoginCandidates } from '@netx/shared';
import { AddressPicker, EMPTY_ADDRESS, type AddressValue } from '@/components/contracts/AddressPicker';
import {
  SubscriberPortPicker,
  type SubscriberPortSelection,
} from '@/components/fibermap/SubscriberPortPicker';

/**
 * NewContractInline — formulário reusável de criação de contrato.
 *
 * Suporta os 2 métodos de autenticação: PPPoE (default) e IPoE.
 *
 *   PPPoE: usuário/senha (legado, default).
 *   IPoE : circuit-id (DHCP option 82) e/ou MAC, com IP fixo opcional e
 *          VLAN opcional. Pelo menos um identificador (circuit OU MAC).
 *
 * Compartilhado entre `/contracts/new`, fluxos de criar cliente + contrato e
 * conversão de deal.
 */
export interface NewContractInlineProps {
  /** Quando definido, esconde o seletor de cliente e usa esse customerId fixo. */
  lockedCustomerId?: string | null;
  /** Pré-preenchimento opcional. */
  initial?: Partial<{
    monthlyValue: number | string;
    bandwidthMbps: number | string;
    dueDay: number | string;
    notes: string;
    installationAddress: string;
    installationMapsUrl: string;
    authMethod: ContractAuthMethod;
    pppoeUsername: string;
    pppoePassword: string;
    firstDueDate: string;
  }>;
  submitLabel?: string;
  cancelLabel?: string;
  onCreated: (contract: Contract) => void;
  onCancel?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
}

/**
 * Senha PPPoE padrão da operação. Decisão do admin (2026-05-22): senha curta
 * fixa — a segurança real está na camada GPON/OLT, não na credencial PPPoE
 * (que ainda é injetada na ONT via TR-069, o cliente nunca a digita).
 */
const DEFAULT_PPPOE_PASSWORD = '1234';

/** Gera uma senha Wi-Fi de 10 chars sem ambíguos (0/O, 1/l) — fácil de ditar. */
function generateWifiPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const arr = new Uint8Array(10);
  crypto.getRandomValues(arr);
  let out = '';
  for (let i = 0; i < arr.length; i++) out += alphabet[arr[i] % alphabet.length];
  return out;
}

export function NewContractInline({
  lockedCustomerId,
  initial,
  submitLabel,
  cancelLabel,
  onCreated,
  onCancel,
  onSkip,
  skipLabel,
}: NewContractInlineProps) {
  const t = useTranslations('contractCards');
  const tc = useTranslations('common');
  const submitText = submitLabel ?? t('newContract.submit');
  const cancelText = cancelLabel ?? tc('cancel');
  const skipText = skipLabel ?? tc('skip');
  const { currency, currencySymbol, tenant } = useTenantConfig();
  const moneyLabel = `${currencySymbol ?? currency}`;

  const customersKey = lockedCustomerId ? null : '/v1/customers?pageSize=100';
  const { data: customersResp, isLoading: loadingCustomers } = useSWR<Paginated<Customer>>(
    customersKey,
  );
  const customers = useMemo(
    () =>
      (customersResp?.data ?? [])
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR')),
    [customersResp],
  );
  const lockedKey = lockedCustomerId ? `/v1/customers/${lockedCustomerId}` : null;
  const { data: lockedCustomer } = useSWR<Customer>(lockedKey);

  // Default PPPoE — decisão de engenharia (2026-05-22): ZTP determinístico,
  // sessão explícita, mais robusto pro cenário ONT-roteador + Mikrotik BNG.
  // IPoE continua disponível como opt-in.
  const [authMethod, setAuthMethod] = useState<ContractAuthMethod>(
    initial?.authMethod ?? 'PPPOE',
  );
  // Default 'PENDING_INSTALL' — fluxo ZTP padrão da operação: vendedor cria
  // o contrato, técnico instala em campo via /provisioning/install. O
  // contrato nasce na fila de instalações pendentes (sem fatura/RADIUS até
  // a ativação). 'ACTIVE' é a exceção — instalação já realizada antes do
  // cadastro.
  const [initialStatus, setInitialStatus] = useState<'ACTIVE' | 'PENDING_INSTALL'>(
    'PENDING_INSTALL',
  );
  // Modo de cobrança — default POSTPAID. PREPAID inverte: 1ª fatura na ativação,
  // ciclo ancorado em activatedAt, cancelamento sem cobrança final.
  const [paymentMode, setPaymentMode] = useState<'POSTPAID' | 'PREPAID'>('POSTPAID');
  // Forma de cobrança BR. Pré-preenchida com o padrão do tenant; o operador
  // pode trocar por contrato. MANUAL = sem gateway (carnê/dinheiro/baixa manual).
  const [brBillingGateway, setBrBillingGateway] = useState<BrPaymentGateway>('MANUAL');
  useEffect(() => {
    btgApi
      .getGateway()
      .then((r) => setBrBillingGateway(r.gateway))
      .catch(() => {
        /* sem padrão configurado → MANUAL */
      });
  }, []);
  // Operador editou o login à mão? Se sim, o auto-preenchimento (derivado do
  // nome do cliente) para de sobrescrever.
  const [pppoeUserEdited, setPppoeUserEdited] = useState(false);
  const [form, setForm] = useState({
    customerId: lockedCustomerId ?? '',
    // PPPoE — login é derivado do nome do cliente (preenchido pelo useEffect
    // quando o cliente é selecionado). Senha = padrão da operação.
    pppoeUsername: initial?.pppoeUsername ?? '',
    pppoePassword: initial?.pppoePassword ?? DEFAULT_PPPOE_PASSWORD,
    // IPoE
    circuitId: '',
    remoteId: '',
    macAddress: '',
    framedIpAddress: '',
    vlanId: '',
    // Comuns
    installationMapsUrl: initial?.installationMapsUrl ?? '',
    // Wi-Fi do cliente — capturado aqui (antes era na instalação, pelo técnico).
    ssid: '',
    wifiPassword: '',
    planId: '',
    monthlyValue:
      initial?.monthlyValue !== undefined ? String(initial.monthlyValue) : '',
    bandwidthMbps:
      initial?.bandwidthMbps !== undefined ? String(initial.bandwidthMbps) : '',
    uploadMbps: '',
    dueDay: initial?.dueDay !== undefined ? String(initial.dueDay) : '10',
    // Override per-contract dos dias até bloqueio. Vazio = usa do plano.
    blockAfterDays: '',
    notes: initial?.notes ?? '',
    firstDueDate: initial?.firstDueDate ?? '',
  });
  // Endereço de instalação — BR usa o cadastro estruturado (AddressPicker),
  // PY/legado segue texto livre. O installationAddress é denormalizado pelo
  // backend a partir do streetId quando BR.
  const [address, setAddress] = useState<AddressValue>({
    ...EMPTY_ADDRESS,
    installationAddress: initial?.installationAddress ?? '',
  });
  // CTO/porta do FiberMap (opcional). O create de contrato NÃO aceita
  // fibermapPortId — o vínculo é feito via assign-contract APÓS criar (vide
  // onSubmit). Nada é persistido enquanto o operador só navega no picker.
  const canFibermap = hasPermission('fibermap.read');
  const [fibermapSel, setFibermapSel] = useState<SubscriberPortSelection | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Seção técnica (auth, início, credenciais) fica recolhida por padrão — usa
  // os defaults (PPPoE · Agendar instalação · credenciais auto). Operador abre
  // só se precisar mexer.
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Catálogo de planos — opera ativos por padrão.
  const { data: plans } = useSWR<Plan[]>(plansApi.listPath(false), () =>
    plansApi.list(false),
  );

  const selectedPlan = (plans ?? []).find((p) => p.id === form.planId);
  // Diferença entre o valor cobrado e o preço do plano (mostra
  // "desconto" / "acréscimo" pra rastreabilidade visual).
  const planAdjustment = (() => {
    if (!selectedPlan) return null;
    const cobrado = Number(String(form.monthlyValue).replace(',', '.'));
    const base = Number(selectedPlan.monthlyPrice);
    if (!Number.isFinite(cobrado) || !Number.isFinite(base)) return null;
    const diff = cobrado - base;
    if (Math.abs(diff) < 0.005) return null;
    return diff;
  })();

  // Ao selecionar um plano, preenche valor + velocidades (operador pode
  // ajustar o monthlyValue depois — desconto/acréscimo).
  function selectPlan(planId: string) {
    setForm((s) => ({ ...s, planId }));
    const p = (plans ?? []).find((x) => x.id === planId);
    if (!p) return;
    setForm((s) => ({
      ...s,
      planId,
      monthlyValue: String(Number(p.monthlyPrice)),
      bandwidthMbps: String(p.downloadMbps),
      uploadMbps: String(p.uploadMbps),
    }));
  }

  useEffect(() => {
    if (lockedCustomerId) {
      setForm((s) => ({ ...s, customerId: lockedCustomerId }));
    }
  }, [lockedCustomerId]);

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  // Nome do cliente selecionado — usado pra derivar o login PPPoE.
  const selectedCustomerName = useMemo(() => {
    if (lockedCustomerId) return lockedCustomer?.displayName ?? '';
    return customers.find((c) => c.id === form.customerId)?.displayName ?? '';
  }, [lockedCustomerId, lockedCustomer, customers, form.customerId]);

  // Candidatos de login (charlesbarreto, charlesmacedo, barretomacedo…).
  // O backend resolve a unicidade final; aqui é só sugestão/preview.
  const loginCandidates = useMemo(
    () => pppoeLoginCandidates(selectedCustomerName),
    [selectedCustomerName],
  );

  // Auto-preenche o login com a 1ª opção quando o cliente é selecionado —
  // a menos que o operador já tenha editado o campo à mão.
  useEffect(() => {
    if (authMethod !== 'PPPOE' || pppoeUserEdited) return;
    if (loginCandidates.length > 0) {
      setForm((s) => ({ ...s, pppoeUsername: loginCandidates[0] }));
    }
  }, [authMethod, pppoeUserEdited, loginCandidates]);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.customerId) e.customerId = t('newContract.errors.selectCustomer');

    if (authMethod === 'PPPOE') {
      // Login e senha são opcionais no request — o backend gera (login do
      // nome do cliente, senha padrão). Só validamos FORMATO se preenchidos.
      if (form.pppoeUsername) {
        if (form.pppoeUsername.length < 3)
          e.pppoeUsername = t('newContract.errors.min3');
        else if (!/^[A-Za-z0-9._-]+$/.test(form.pppoeUsername))
          e.pppoeUsername = t('newContract.errors.usernameChars');
      }
      if (form.pppoePassword && form.pppoePassword.length < 4)
        e.pppoePassword = t('newContract.errors.min4');
    } else {
      // IPoE: pelo menos circuit OU MAC quando vai entrar ACTIVE direto.
      // Em PENDING_INSTALL o técnico vai vincular SN GPON em campo, então
      // os campos de identificação podem ficar vazios.
      if (
        initialStatus === 'ACTIVE' &&
        !form.circuitId.trim() &&
        !form.macAddress.trim()
      ) {
        e.circuitId = t('newContract.errors.circuitOrMacSchedule');
      }
      if (form.macAddress.trim()) {
        const cleaned = form.macAddress.replace(/[^0-9A-Fa-f]/gu, '');
        if (cleaned.length !== 12) e.macAddress = t('newContract.errors.macInvalidHex');
      }
      if (form.framedIpAddress.trim()) {
        // Validação leve — IPv4 ou IPv6 textual.
        if (
          !/^(\d{1,3}\.){3}\d{1,3}$/u.test(form.framedIpAddress.trim()) &&
          !/^[0-9a-fA-F:]+$/u.test(form.framedIpAddress.trim())
        ) {
          e.framedIpAddress = t('newContract.errors.ipInvalid');
        }
      }
      if (form.vlanId.trim()) {
        const v = Number(form.vlanId);
        if (!Number.isInteger(v) || v < 1 || v > 4094)
          e.vlanId = t('newContract.errors.vlanRange');
      }
    }

    // BR: endereço estruturado obrigatório (exige logradouro selecionado).
    // PY/legado: texto livre, mínimo 5 chars (comportamento histórico).
    if (tenant?.country === 'BR') {
      if (!address.streetId)
        e.installationAddress = 'Selecione o endereço de instalação (Cidade → Logradouro).';
    } else if (!address.installationAddress || address.installationAddress.length < 5) {
      e.installationAddress = t('newContract.errors.installationAddress');
    }

    // Wi-Fi obrigatório no cadastro (o técnico não digita mais em campo).
    const ssid = form.ssid.trim();
    if (!ssid) e.ssid = t('newContract.errors.ssidRequired');
    else if (ssid.length > 32 || !/^[\x20-\x7E]+$/u.test(ssid))
      e.ssid = t('newContract.errors.ssidInvalid');
    if (!form.wifiPassword) e.wifiPassword = t('newContract.errors.wifiPasswordRequired');
    else if (form.wifiPassword.length < 8 || form.wifiPassword.length > 63)
      e.wifiPassword = t('newContract.errors.wifiPasswordLen');
    if (form.installationMapsUrl) {
      const normalized = normalizeMapsUrl(form.installationMapsUrl);
      try {
        const u = new URL(normalized);
        if (!/^https?:$/.test(u.protocol)) e.installationMapsUrl = t('newContract.errors.useHttp');
      } catch {
        e.installationMapsUrl = t('newContract.errors.urlInvalid');
      }
    }
    const mv = Number(String(form.monthlyValue).replace(',', '.'));
    if (!Number.isFinite(mv) || mv <= 0) e.monthlyValue = t('newContract.errors.valueInvalid');
    const bw = Number(form.bandwidthMbps);
    if (!Number.isInteger(bw) || bw < 1) e.bandwidthMbps = t('newContract.errors.speedMbps');
    const dd = Number(form.dueDay);
    if (!Number.isInteger(dd) || dd < 1 || dd > 28) e.dueDay = t('newContract.errors.between1and28');
    if (form.blockAfterDays.trim()) {
      const bad = Number(form.blockAfterDays);
      if (!Number.isInteger(bad) || bad < 0 || bad > 60)
        e.blockAfterDays = t('newContract.errors.between0and60');
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (submitting) return;
    if (!validate()) {
      // Abre o avançado pra os erros de credenciais (escondidos) ficarem visíveis.
      setAdvancedOpen(true);
      return;
    }
    setSubmitting(true);

    const common = {
      customerId: form.customerId,
      installationAddress: address.installationAddress,
      streetId: address.streetId,
      addressNumber: address.addressNumber.trim() || null,
      addressComplement: address.addressComplement.trim() || null,
      installationMapsUrl: form.installationMapsUrl.trim()
        ? normalizeMapsUrl(form.installationMapsUrl)
        : null,
      planId: form.planId || null,
      monthlyValue: Number(String(form.monthlyValue).replace(',', '.')),
      bandwidthMbps: Number(form.bandwidthMbps),
      uploadMbps: form.uploadMbps.trim() ? Number(form.uploadMbps) : null,
      dueDay: Number(form.dueDay),
      paymentMode,
      brBillingGateway,
      blockAfterDays: form.blockAfterDays.trim() ? Number(form.blockAfterDays) : null,
      notes: form.notes || null,
      firstDueDate: form.firstDueDate || undefined,
      initialStatus,
      // Wi-Fi — o provisionamento aplica via TR-069 lendo do contrato.
      ssid: form.ssid.trim(),
      wifiPassword: form.wifiPassword,
    };

    const payload: CreateContractInput =
      authMethod === 'IPOE'
        ? {
            ...common,
            authMethod: 'IPOE',
            circuitId: form.circuitId.trim() || null,
            remoteId: form.remoteId.trim() || null,
            macAddress: form.macAddress.trim()
              ? normalizeMac(form.macAddress)
              : null,
            framedIpAddress: form.framedIpAddress.trim() || null,
            vlanId: form.vlanId.trim() ? Number(form.vlanId) : null,
          }
        : {
            ...common,
            authMethod: 'PPPOE',
            // Vazios viram undefined — o backend gera (login do nome do
            // cliente, senha padrão) e resolve unicidade.
            pppoeUsername: form.pppoeUsername.trim() || undefined,
            pppoePassword: form.pppoePassword.trim() || undefined,
          };

    try {
      const created = await contractsApi.create(payload);
      // Vínculo FiberMap pós-criação: o DTO de criação não tem fibermapPortId,
      // então o assign é uma chamada separada com o id retornado. Falha aqui
      // NÃO desfaz o contrato — aviso não-fatal; o operador vincula depois no
      // detalhe do contrato.
      if (fibermapSel) {
        try {
          await fibermapApi.assignPortToContract(fibermapSel.portId, created.id);
        } catch (assignErr) {
          const assignMsg =
            assignErr instanceof ApiError
              ? assignErr.friendlyMessage
              : (assignErr as Error).message;
          toast.warning(t('newContract.fibermapAssignFailed', { error: assignMsg }));
        }
      }
      toast.success(t('newContract.createdToast'));
      onCreated(created);
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(t('newContract.createFailed', { error: msg }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {/* Cliente */}
      {lockedCustomerId ? (
        <div>
          <Label>{t('newContract.customer')}</Label>
          <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-text">
            {lockedCustomer?.displayName ?? tc('loading')}
            {lockedCustomer?.code ? (
              <span className="ml-2 text-text-muted">· {lockedCustomer.code}</span>
            ) : null}
          </div>
          <FieldHelp>{t('newContract.customerLinked')}</FieldHelp>
        </div>
      ) : (
        <div>
          <Label htmlFor="contract-customerId" required>
            {t('newContract.customer')}
          </Label>
          <Select
            id="contract-customerId"
            value={form.customerId}
            onChange={(e) => update('customerId', e.target.value)}
            disabled={loadingCustomers}
          >
            <option value="">
              {loadingCustomers ? t('newContract.loadingCustomers') : t('newContract.selectCustomer')}
            </option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
                {c.code ? ` · ${c.code}` : ''}
              </option>
            ))}
          </Select>
          <FieldError>{errors.customerId}</FieldError>
        </div>
      )}

      {/* ─── Configurações avançadas (recolhível) ─────────────────────────
          Auth + início do serviço + credenciais. Fechado por padrão: usa os
          defaults (PPPoE · Agendar instalação · credenciais auto). O operador
          "nem vê" a menos que precise abrir. */}
      <div className="rounded-md border border-border">
        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          aria-expanded={advancedOpen}
          className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left hover:bg-surface-hover"
        >
          <span className="text-sm font-medium text-text">
            {t('newContract.advancedSettings')}
            <span className="ml-2 text-xs font-normal text-text-subtle">
              {authMethod === 'PPPOE' ? 'PPPoE' : 'IPoE'} ·{' '}
              {initialStatus === 'ACTIVE' ? t('newContract.activateNow') : t('newContract.scheduleInstall')}
            </span>
          </span>
          <span className="text-text-subtle">{advancedOpen ? '▾' : '▸'}</span>
        </button>
        {advancedOpen && (
          <div className="space-y-5 border-t border-border p-3">

      {/* ─── Tipo de autenticação ─────────────────────────────────────── */}
      <div>
        <Label>{t('newContract.authType')}</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <AuthMethodTab
            label="PPPoE"
            description={t('newContract.pppoeDesc')}
            active={authMethod === 'PPPOE'}
            onClick={() => setAuthMethod('PPPOE')}
          />
          <AuthMethodTab
            label="IPoE"
            description={t('newContract.ipoeDesc')}
            active={authMethod === 'IPOE'}
            onClick={() => setAuthMethod('IPOE')}
          />
        </div>
      </div>

      {/* ─── Status inicial — clássico vs ZTP ─────────────────────────── */}
      {/* Disponível pros DOIS métodos: com TR-069 ACS, o ZTP funciona tanto
          em PPPoE (NetX injeta user/senha na ONT) quanto em IPoE (MAC). */}
      <div>
        <Label>{t('newContract.serviceStart')}</Label>
        <div className="flex flex-col gap-2 md:flex-row">
          <AuthMethodTab
            label={t('newContract.activateNow')}
            description={t('newContract.activateNowDesc')}
            active={initialStatus === 'ACTIVE'}
            onClick={() => setInitialStatus('ACTIVE')}
          />
          <AuthMethodTab
            label={t('newContract.scheduleInstall')}
            description={t('newContract.scheduleInstallDesc')}
            active={initialStatus === 'PENDING_INSTALL'}
            onClick={() => setInitialStatus('PENDING_INSTALL')}
          />
        </div>
        {initialStatus === 'PENDING_INSTALL' && (
          <FieldHelp>
            {t('newContract.pendingInstallHelp')}
          </FieldHelp>
        )}
      </div>

      {authMethod === 'PPPOE' ? (
        <div className="space-y-3">
          <Label>{t('newContract.pppoeCredentials')}</Label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="contract-pppoeUsername" required>
                {t('newContract.pppoeUsername')}
              </Label>
              <Input
                id="contract-pppoeUsername"
                value={form.pppoeUsername}
                onChange={(e) => {
                  setPppoeUserEdited(true);
                  update('pppoeUsername', e.target.value);
                }}
                placeholder={
                  selectedCustomerName
                    ? t('newContract.usernameDerivedPlaceholder')
                    : t('newContract.selectCustomerFirstPlaceholder')
                }
                className="font-mono"
              />
              <FieldError>{errors.pppoeUsername}</FieldError>
              {/* Chips das variações do nome — clicar troca o login. */}
              {loginCandidates.length > 1 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {loginCandidates.map((cand) => (
                    <button
                      key={cand}
                      type="button"
                      onClick={() => update('pppoeUsername', cand)}
                      className={
                        'rounded-md border px-2 py-0.5 font-mono text-xs transition-colors ' +
                        (form.pppoeUsername === cand
                          ? 'border-accent bg-accent-muted text-text'
                          : 'border-border text-text-muted hover:bg-surface-hover')
                      }
                    >
                      {cand}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="contract-pppoePassword" required>
                {t('newContract.pppoePassword')}
              </Label>
              <Input
                id="contract-pppoePassword"
                value={form.pppoePassword}
                onChange={(e) => update('pppoePassword', e.target.value)}
                className="font-mono"
              />
              <FieldError>{errors.pppoePassword}</FieldError>
            </div>
          </div>
          <FieldHelp>
            {t('newContract.pppoeHelp')}
          </FieldHelp>
        </div>
      ) : (
        <div className="space-y-4 rounded-md border border-dashed border-border p-3">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="contract-circuitId">Circuit-ID</Label>
              <Input
                id="contract-circuitId"
                value={form.circuitId}
                onChange={(e) => update('circuitId', e.target.value)}
                placeholder={t('newContract.circuitIdPlaceholder')}
              />
              <FieldError>{errors.circuitId}</FieldError>
              <FieldHelp>
                {t('newContract.circuitIdHelp')}
              </FieldHelp>
            </div>
            <div>
              <Label htmlFor="contract-remoteId">{t('newContract.remoteIdLabel')}</Label>
              <Input
                id="contract-remoteId"
                value={form.remoteId}
                onChange={(e) => update('remoteId', e.target.value)}
                placeholder="ex. OLT-A"
              />
              <FieldHelp>{t('newContract.remoteIdHelp')}</FieldHelp>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label htmlFor="contract-macAddress">{t('newContract.macLabel')}</Label>
              <Input
                id="contract-macAddress"
                value={form.macAddress}
                onChange={(e) => update('macAddress', e.target.value)}
                placeholder="AA:BB:CC:DD:EE:FF"
              />
              <FieldError>{errors.macAddress}</FieldError>
              <FieldHelp>{t('newContract.macHelp')}</FieldHelp>
            </div>
            <div>
              <Label htmlFor="contract-framedIpAddress">{t('newContract.framedIpLabel')}</Label>
              <Input
                id="contract-framedIpAddress"
                value={form.framedIpAddress}
                onChange={(e) => update('framedIpAddress', e.target.value)}
                placeholder="ex. 200.100.50.10"
              />
              <FieldError>{errors.framedIpAddress}</FieldError>
              <FieldHelp>{t('newContract.framedIpHelp')}</FieldHelp>
            </div>
            <div>
              <Label htmlFor="contract-vlanId">{t('newContract.vlanLabel')}</Label>
              <Input
                id="contract-vlanId"
                type="number"
                min="1"
                max="4094"
                value={form.vlanId}
                onChange={(e) => update('vlanId', e.target.value)}
                placeholder="100"
              />
              <FieldError>{errors.vlanId}</FieldError>
            </div>
          </div>

          <p className="rounded bg-surface-muted px-2 py-1.5 text-xs text-text-muted">
            {t.rich('newContract.ipoeReminder', {
              strong: (chunks) => <strong>{chunks}</strong>,
              em: (chunks) => <em>{chunks}</em>,
            })}
          </p>
        </div>
      )}
          </div>
        )}
      </div>
      {/* ─── fim das configurações avançadas ─────────────────────────────── */}

      <AddressPicker
        country={tenant?.country}
        value={address}
        onChange={setAddress}
        error={errors.installationAddress}
        freeTextLabel={t('newContract.installationAddress')}
        freeTextPlaceholder={t('newContract.installationAddressPlaceholder')}
      />

      <div>
        <Label htmlFor="contract-installationMapsUrl">
          {t('newContract.mapsUrlLabel')}
        </Label>
        <Input
          id="contract-installationMapsUrl"
          type="url"
          value={form.installationMapsUrl}
          onChange={(e) => update('installationMapsUrl', e.target.value)}
          placeholder="https://maps.app.goo.gl/…"
        />
        <FieldError>{errors.installationMapsUrl}</FieldError>
        <FieldHelp>
          {t('newContract.mapsUrlHelp')}
        </FieldHelp>
      </div>

      {/* ─── CTO / Porta (FiberMap) — opcional ─────────────────────────── */}
      {/* O form não tem LocationPicker (coordenadas entram depois, na edição),
          então o picker busca só por nome — sem nearLat/nearLng. */}
      {canFibermap && (
        <div className="rounded-md border border-border p-3">
          <p className="text-sm font-semibold text-text">
            {t('newContract.fibermapHeading')}
          </p>
          <FieldHelp>{t('newContract.fibermapHelp')}</FieldHelp>
          <div className="mt-2">
            <SubscriberPortPicker
              value={
                fibermapSel
                  ? { portId: fibermapSel.portId, label: fibermapSel.label }
                  : null
              }
              onChange={setFibermapSel}
              disabled={submitting}
            />
          </div>
        </div>
      )}

      {/* ─── Wi-Fi do cliente ──────────────────────────────────────────── */}
      <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <p className="mb-2 text-sm font-semibold">{t('newContract.wifiHeading')}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="contract-ssid" required>
              {t('newContract.ssid')}
            </Label>
            <Input
              id="contract-ssid"
              value={form.ssid}
              onChange={(e) => update('ssid', e.target.value)}
              maxLength={32}
              placeholder={t('newContract.ssidPlaceholder')}
            />
            <FieldError>{errors.ssid}</FieldError>
          </div>
          <div>
            <Label htmlFor="contract-wifiPassword" required>
              {t('newContract.wifiPassword')}
            </Label>
            <div className="flex gap-2">
              <Input
                id="contract-wifiPassword"
                value={form.wifiPassword}
                onChange={(e) => update('wifiPassword', e.target.value)}
                minLength={8}
                maxLength={63}
                placeholder={t('newContract.wifiPasswordPlaceholder')}
                className="flex-1"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => update('wifiPassword', generateWifiPassword())}
              >
                {t('newContract.wifiGenerate')}
              </Button>
            </div>
            <FieldError>{errors.wifiPassword}</FieldError>
          </div>
        </div>
        <FieldHelp>{t('newContract.wifiHelp')}</FieldHelp>
      </div>

      {/* ─── Modo de cobrança ─────────────────────────────────────────── */}
      <div>
        <Label>{t('newContract.paymentMode')}</Label>
        <div className="flex flex-col gap-2 md:flex-row">
          <AuthMethodTab
            label={t('newContract.postpaid')}
            description={t('newContract.postpaidDesc')}
            active={paymentMode === 'POSTPAID'}
            onClick={() => setPaymentMode('POSTPAID')}
          />
          <AuthMethodTab
            label={t('newContract.prepaid')}
            description={t('newContract.prepaidDesc')}
            active={paymentMode === 'PREPAID'}
            onClick={() => setPaymentMode('PREPAID')}
          />
        </div>
        {paymentMode === 'PREPAID' && (
          <FieldHelp>
            {t('newContract.prepaidHelp')}
          </FieldHelp>
        )}
      </div>

      {/* ─── Forma de cobrança (gateway BR) ────────────────────────────── */}
      <div>
        <Label htmlFor="contract-brGateway">Forma de cobrança</Label>
        <Select
          id="contract-brGateway"
          value={brBillingGateway}
          onChange={(e) => setBrBillingGateway(e.target.value as BrPaymentGateway)}
        >
          <option value="MANUAL">Manual (sem gateway)</option>
          <option value="EFI">EFI (Pix/Boleto)</option>
          <option value="BTG">BTG (Pix/Boleto)</option>
        </Select>
        <FieldHelp>
          {brBillingGateway === 'MANUAL'
            ? 'As faturas não geram cobrança automática — baixa manual (carnê/dinheiro).'
            : `As faturas deste contrato nascem já no ${brBillingGateway} (Pix/boleto gerado automaticamente).`}
        </FieldHelp>
      </div>

      {/* ─── Plano de internet ─────────────────────────────────────────── */}
      {plans && plans.length > 0 && (
        <div>
          <Label htmlFor="contract-planId">{t('newContract.plan')}</Label>
          <Select
            id="contract-planId"
            value={form.planId}
            onChange={(e) => selectPlan(e.target.value)}
          >
            <option value="">{t('newContract.noPlanOption')}</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.downloadMbps}/{p.uploadMbps} Mbps ·{' '}
                {moneyLabel} {Number(p.monthlyPrice).toLocaleString('pt-BR')}
              </option>
            ))}
          </Select>
          <FieldHelp>
            {t('newContract.planHelp')}
            {planAdjustment !== null && (
              <span
                className={
                  planAdjustment < 0
                    ? ' font-medium text-emerald-600 dark:text-emerald-400'
                    : ' font-medium text-amber-600 dark:text-amber-400'
                }
              >
                {' · '}
                {planAdjustment < 0
                  ? t('newContract.discountVsPlan', {
                      amount: `${moneyLabel} ${Math.abs(planAdjustment).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                    })
                  : t('newContract.surchargeVsPlan', {
                      amount: `${moneyLabel} ${Math.abs(planAdjustment).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
                    })}
              </span>
            )}
          </FieldHelp>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor="contract-monthlyValue" required>
            {t('newContract.monthlyValue', { currency: moneyLabel })}
          </Label>
          <Input
            id="contract-monthlyValue"
            type="number"
            step="0.01"
            min="0"
            value={form.monthlyValue}
            onChange={(e) => update('monthlyValue', e.target.value)}
            placeholder="99.90"
          />
          <FieldError>{errors.monthlyValue}</FieldError>
        </div>
        <div>
          <Label htmlFor="contract-bandwidthMbps" required>
            {t('newContract.downloadMbps')}
          </Label>
          <Input
            id="contract-bandwidthMbps"
            type="number"
            min="1"
            value={form.bandwidthMbps}
            onChange={(e) => update('bandwidthMbps', e.target.value)}
            placeholder="500"
          />
          <FieldError>{errors.bandwidthMbps}</FieldError>
        </div>
        <div>
          <Label htmlFor="contract-uploadMbps">{t('newContract.uploadMbps')}</Label>
          <Input
            id="contract-uploadMbps"
            type="number"
            min="1"
            value={form.uploadMbps}
            onChange={(e) => update('uploadMbps', e.target.value)}
            placeholder={t('newContract.uploadPlaceholder')}
          />
          <FieldHelp>{t('newContract.uploadHelp')}</FieldHelp>
        </div>
        <div>
          <Label htmlFor="contract-dueDay" required>
            {t('newContract.dueDay')}
          </Label>
          <Input
            id="contract-dueDay"
            type="number"
            min="1"
            max="28"
            value={form.dueDay}
            onChange={(e) => update('dueDay', e.target.value)}
            disabled={paymentMode === 'PREPAID'}
          />
          <FieldError>{errors.dueDay}</FieldError>
          <FieldHelp>
            {paymentMode === 'PREPAID' ? t('newContract.dueDayPrepaid') : t('newContract.dueDayRange')}
          </FieldHelp>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="contract-blockAfterDays">{t('newContract.blockAfterDays')}</Label>
          <Input
            id="contract-blockAfterDays"
            type="number"
            min="0"
            max="60"
            value={form.blockAfterDays}
            onChange={(e) => update('blockAfterDays', e.target.value)}
            placeholder={
              selectedPlan
                ? t('newContract.blockAfterDaysPlanPlaceholder', { days: selectedPlan.blockAfterDays })
                : t('newContract.blockAfterDaysEmptyPlaceholder')
            }
          />
          <FieldError>{errors.blockAfterDays}</FieldError>
          <FieldHelp>
            {t('newContract.blockAfterDaysHelp')}
          </FieldHelp>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="contract-firstDueDate">{t('newContract.firstDueDate')}</Label>
          <Input
            id="contract-firstDueDate"
            type="date"
            value={form.firstDueDate}
            onChange={(e) => update('firstDueDate', e.target.value)}
          />
          <FieldHelp>{t('newContract.firstDueDateHelp')}</FieldHelp>
        </div>
      </div>

      <div>
        <Label htmlFor="contract-notes">{tc('notes')}</Label>
        <Textarea
          id="contract-notes"
          value={form.notes}
          onChange={(e) => update('notes', e.target.value)}
          rows={3}
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {onSkip && (
          <Button type="button" variant="ghost" onClick={onSkip} disabled={submitting}>
            {skipText}
          </Button>
        )}
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
            {cancelText}
          </Button>
        )}
        <Button type="submit" loading={submitting}>
          {submitText}
        </Button>
      </div>
    </form>
  );
}

/** Tab visual pra alternar PPPoE / IPoE — estilo segmented control. */
function AuthMethodTab({
  label,
  description,
  active,
  onClick,
}: {
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'flex-1 rounded-md border px-3 py-2 text-left transition-colors ' +
        (active
          ? 'border-accent bg-accent-muted text-text'
          : 'border-border bg-surface text-text-muted hover:bg-surface-hover')
      }
    >
      <div className="text-sm font-semibold">{label}</div>
      <div className="text-xs text-text-muted">{description}</div>
    </button>
  );
}

function normalizeMac(raw: string): string {
  const cleaned = raw.replace(/[^0-9A-Fa-f]/gu, '').toUpperCase();
  if (cleaned.length !== 12) return raw;
  return cleaned.match(/.{2}/gu)!.join(':');
}

function normalizeMapsUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}
