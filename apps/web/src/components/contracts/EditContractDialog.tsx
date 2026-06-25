'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
import {
  FieldError,
  FieldHelp,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  contractsApi,
  type ChangePlanPreview,
  type Contract,
  type ContractAuthMethod,
  type UpdateContractInput,
} from '@/lib/contracts-api';
import type { BrPaymentGateway } from '@/lib/finance-api';
import { plansApi, type Plan } from '@/lib/plans-api';
import { useTenantConfig } from '@/lib/tenant-config';
import { useFormatMoney } from '@/lib/use-money';
import { AddressPicker, type AddressValue } from '@/components/contracts/AddressPicker';
import type { LatLng } from '@/components/mapping/LocationPicker';

// LocationPicker depende de Leaflet, que quebra no SSR (usa window).
// Dynamic import client-only — modal só renderiza quando aberto, então
// sem custo de carga inicial.
const LocationPicker = dynamic(
  () => import('@/components/mapping/LocationPicker').then((m) => m.LocationPicker),
  { ssr: false, loading: () => <div className="h-[320px] animate-pulse rounded-md bg-surface-muted" /> },
);

/**
 * EditContractDialog — modal pra atualizar campos do contrato.
 *
 * O que dá pra mexer aqui:
 *  - Método de autenticação (PPPoE ↔ IPoE) — dispara resync no RADIUS.
 *  - Credenciais PPPoE (usuário + senha) — útil pra rotacionar senha.
 *  - Identificadores IPoE: circuit-id, remote-id, MAC, IP fixo, VLAN.
 *  - Comerciais: mensalidade, velocidade, dia de vencimento.
 *  - Endereço de instalação + link de mapa.
 *  - Observações.
 *
 * Cliente, código e status são imutáveis aqui — outras telas cuidam disso.
 */
export interface EditContractDialogProps {
  open: boolean;
  contract: Contract;
  onClose: () => void;
  onUpdated: (next: Contract) => void;
}

export function EditContractDialog({
  open,
  contract,
  onClose,
  onUpdated,
}: EditContractDialogProps) {
  const t = useTranslations('contractCards');
  const tc = useTranslations('common');
  const { currency, currencySymbol, tenant } = useTenantConfig();
  const moneyLabel = currencySymbol ?? currency;
  const formatMoney = useFormatMoney();

  const [authMethod, setAuthMethod] = useState<ContractAuthMethod>(
    contract.authMethod,
  );
  const [form, setForm] = useState({
    pppoeUsername: contract.pppoeUsername ?? '',
    pppoePassword: contract.pppoePassword ?? '',
    circuitId: contract.circuitId ?? '',
    remoteId: contract.remoteId ?? '',
    macAddress: contract.macAddress ?? '',
    framedIpAddress: contract.framedIpAddress ?? '',
    vlanId: contract.vlanId !== null ? String(contract.vlanId) : '',
    monthlyValue: String(contract.monthlyValue),
    bandwidthMbps: String(contract.bandwidthMbps),
    uploadMbps: contract.uploadMbps != null ? String(contract.uploadMbps) : '',
    dueDay: String(contract.dueDay),
    blockAfterDays:
      contract.blockAfterDays != null ? String(contract.blockAfterDays) : '',
    brBillingGateway: contract.brBillingGateway,
    installationMapsUrl: contract.installationMapsUrl ?? '',
    notes: contract.notes ?? '',
  });
  // Endereço de instalação — BR estruturado (AddressPicker), PY texto livre.
  const [address, setAddress] = useState<AddressValue>({
    streetId: contract.streetId,
    addressNumber: contract.addressNumber ?? '',
    addressComplement: contract.addressComplement ?? '',
    installationAddress: contract.installationAddress,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Geolocalização (módulo Mapeamento). Salva no mesmo PATCH dos outros campos.
  const [location, setLocation] = useState<LatLng | null>(
    contract.latitude != null && contract.longitude != null
      ? { latitude: contract.latitude, longitude: contract.longitude }
      : null,
  );

  // --- Plano e troca de plano (endpoint dedicado /change-plan) ---
  // Plano é tratado separadamente do PATCH normal: backend rejeita planId
  // no PATCH genérico pra forçar passar pelo cálculo de prorate.
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>(contract.planId ?? '');
  const [planPreview, setPlanPreview] = useState<ChangePlanPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyProration, setApplyProration] = useState(true);
  const [changingPlan, setChangingPlan] = useState(false);

  // Reset state ao abrir/trocar de contrato.
  useEffect(() => {
    if (!open) return;
    setAuthMethod(contract.authMethod);
    setForm({
      pppoeUsername: contract.pppoeUsername ?? '',
      pppoePassword: contract.pppoePassword ?? '',
      circuitId: contract.circuitId ?? '',
      remoteId: contract.remoteId ?? '',
      macAddress: contract.macAddress ?? '',
      framedIpAddress: contract.framedIpAddress ?? '',
      vlanId: contract.vlanId !== null ? String(contract.vlanId) : '',
      monthlyValue: String(contract.monthlyValue),
      bandwidthMbps: String(contract.bandwidthMbps),
      uploadMbps: contract.uploadMbps != null ? String(contract.uploadMbps) : '',
      dueDay: String(contract.dueDay),
      blockAfterDays:
        contract.blockAfterDays != null ? String(contract.blockAfterDays) : '',
      brBillingGateway: contract.brBillingGateway,
      installationMapsUrl: contract.installationMapsUrl ?? '',
      notes: contract.notes ?? '',
    });
    setAddress({
      streetId: contract.streetId,
      addressNumber: contract.addressNumber ?? '',
      addressComplement: contract.addressComplement ?? '',
      installationAddress: contract.installationAddress,
    });
    setSelectedPlanId(contract.planId ?? '');
    setPlanPreview(null);
    setApplyProration(true);
    setLocation(
      contract.latitude != null && contract.longitude != null
        ? { latitude: contract.latitude, longitude: contract.longitude }
        : null,
    );
    setErrors({});
  }, [open, contract]);

  // Carrega planos ativos uma vez ao abrir.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    plansApi
      .list(false)
      .then((list) => {
        if (!cancelled) setPlans(list);
      })
      .catch(() => {
        // Plano é opcional — falha silenciosa, operador pode salvar o resto.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Preview do impacto da troca quando muda o plano selecionado. Debounce
  // implícito (efeito só dispara em mudança real). PENDING_INSTALL pula
  // preview — backend troca direto sem prorate.
  useEffect(() => {
    if (!open) return;
    if (!selectedPlanId || selectedPlanId === contract.planId) {
      setPlanPreview(null);
      return;
    }
    if (contract.status === 'PENDING_INSTALL') {
      setPlanPreview(null);
      return;
    }
    if (contract.paymentMode === 'PREPAID') {
      // Backend bloqueia changePlan em PREPAID — não vale chamar preview.
      setPlanPreview(null);
      return;
    }
    setPreviewLoading(true);
    let cancelled = false;
    contractsApi
      .previewChangePlan(contract.id, { planId: selectedPlanId, applyProration })
      .then((p) => {
        if (!cancelled) setPlanPreview(p);
      })
      .catch(() => {
        if (!cancelled) setPlanPreview(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedPlanId, applyProration, contract.id, contract.planId, contract.status, contract.paymentMode]);

  async function onApplyChangePlan() {
    if (!selectedPlanId || selectedPlanId === contract.planId) return;
    setChangingPlan(true);
    try {
      const updated = await contractsApi.changePlan(contract.id, {
        planId: selectedPlanId,
        applyProration,
      });
      toast.success(t('editContract.planChanged'));
      onUpdated(updated);
      // Atualiza form com os novos valores denormalizados pelo backend.
      setForm((s) => ({
        ...s,
        monthlyValue: String(updated.monthlyValue),
        bandwidthMbps: String(updated.bandwidthMbps),
        uploadMbps: updated.uploadMbps != null ? String(updated.uploadMbps) : '',
      }));
      setPlanPreview(null);
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(t('editContract.planChangeFailed', { error: msg }));
    } finally {
      setChangingPlan(false);
    }
  }

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (authMethod === 'PPPOE') {
      if (!form.pppoeUsername || form.pppoeUsername.length < 3)
        e.pppoeUsername = t('editContract.errors.min3');
      else if (!/^[A-Za-z0-9._-]+$/.test(form.pppoeUsername))
        e.pppoeUsername = t('editContract.errors.usernameChars');
      if (!form.pppoePassword || form.pppoePassword.length < 4)
        e.pppoePassword = t('editContract.errors.min4');
    } else {
      if (!form.circuitId.trim() && !form.macAddress.trim()) {
        e.circuitId = t('editContract.errors.circuitOrMac');
      }
      if (form.macAddress.trim()) {
        const cleaned = form.macAddress.replace(/[^0-9A-Fa-f]/gu, '');
        if (cleaned.length !== 12) e.macAddress = t('editContract.errors.macInvalid');
      }
      if (form.framedIpAddress.trim()) {
        const v = form.framedIpAddress.trim();
        if (!/^(\d{1,3}\.){3}\d{1,3}$/u.test(v) && !/^[0-9a-fA-F:]+$/u.test(v))
          e.framedIpAddress = t('editContract.errors.ipInvalid');
      }
      if (form.vlanId.trim()) {
        const v = Number(form.vlanId);
        if (!Number.isInteger(v) || v < 1 || v > 4094)
          e.vlanId = t('editContract.errors.vlanRange');
      }
    }

    // BR: endereço estruturado obrigatório; PY/legado: texto livre min 5.
    if (tenant?.country === 'BR') {
      if (!address.streetId)
        e.installationAddress = 'Selecione o endereço de instalação (Cidade → Logradouro).';
    } else if (!address.installationAddress || address.installationAddress.length < 5) {
      e.installationAddress = t('editContract.errors.installationAddress');
    }
    if (form.installationMapsUrl) {
      const norm = normalizeMapsUrl(form.installationMapsUrl);
      try {
        const u = new URL(norm);
        if (!/^https?:$/.test(u.protocol)) e.installationMapsUrl = t('editContract.errors.useHttp');
      } catch {
        e.installationMapsUrl = t('editContract.errors.urlInvalid');
      }
    }
    const mv = Number(String(form.monthlyValue).replace(',', '.'));
    if (!Number.isFinite(mv) || mv <= 0) e.monthlyValue = t('editContract.errors.valueInvalid');
    const bw = Number(form.bandwidthMbps);
    if (!Number.isInteger(bw) || bw < 1) e.bandwidthMbps = t('editContract.errors.speedMbps');
    if (form.uploadMbps.trim()) {
      const up = Number(form.uploadMbps);
      if (!Number.isInteger(up) || up < 1) e.uploadMbps = t('editContract.errors.uploadMbps');
    }
    const dd = Number(form.dueDay);
    if (!Number.isInteger(dd) || dd < 1 || dd > 28) e.dueDay = t('editContract.errors.between1and28');
    if (form.blockAfterDays.trim()) {
      const bad = Number(form.blockAfterDays);
      if (!Number.isInteger(bad) || bad < 0 || bad > 60)
        e.blockAfterDays = t('editContract.errors.between0and60');
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onSubmit() {
    if (!validate() || submitting) return;
    setSubmitting(true);

    // Monta só os campos que diferem do estado atual — backend aceita patch
    // parcial e isso evita disparar resync RADIUS desnecessário.
    const patch: UpdateContractInput = {
      monthlyValue: Number(String(form.monthlyValue).replace(',', '.')),
      bandwidthMbps: Number(form.bandwidthMbps),
      // uploadMbps: vazio = null (limpa); número = setado.
      uploadMbps: form.uploadMbps.trim() ? Number(form.uploadMbps) : null,
      dueDay: Number(form.dueDay),
      // blockAfterDays: vazio = null (volta a usar o do plano); número = override.
      blockAfterDays: form.blockAfterDays.trim()
        ? Number(form.blockAfterDays)
        : null,
      brBillingGateway: form.brBillingGateway,
      installationAddress: address.installationAddress,
      streetId: address.streetId,
      addressNumber: address.addressNumber.trim() || null,
      addressComplement: address.addressComplement.trim() || null,
      installationMapsUrl: form.installationMapsUrl.trim()
        ? normalizeMapsUrl(form.installationMapsUrl)
        : null,
      // Geolocalização — null explícito limpa o pino no mapa.
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      notes: form.notes || null,
    };

    if (authMethod !== contract.authMethod) {
      patch.authMethod = authMethod;
    }
    if (authMethod === 'PPPOE') {
      patch.pppoeUsername = form.pppoeUsername;
      patch.pppoePassword = form.pppoePassword;
      // Se mudou pra PPPoE, limpa identificadores IPoE no backend.
      if (contract.authMethod === 'IPOE') {
        patch.circuitId = null;
        patch.remoteId = null;
        patch.macAddress = null;
        patch.framedIpAddress = null;
        patch.vlanId = null;
      }
    } else {
      patch.circuitId = form.circuitId.trim() || null;
      patch.remoteId = form.remoteId.trim() || null;
      patch.macAddress = form.macAddress.trim()
        ? normalizeMac(form.macAddress)
        : null;
      patch.framedIpAddress = form.framedIpAddress.trim() || null;
      patch.vlanId = form.vlanId.trim() ? Number(form.vlanId) : null;
      // Mudou pra IPoE: limpa creds PPPoE.
      if (contract.authMethod === 'PPPOE') {
        patch.pppoeUsername = '';
        patch.pppoePassword = '';
      }
    }

    try {
      const updated = await contractsApi.update(contract.id, patch);
      toast.success(t('editContract.updatedToast'));
      onUpdated(updated);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(t('editContract.updateFailed', { error: msg }));
    } finally {
      setSubmitting(false);
    }
  }

  const willChangeMethod = authMethod !== contract.authMethod;

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={t('editContract.title')}
      description={
        contract.code
          ? `${contract.code} — ${contract.customer?.displayName ?? ''}`
          : (contract.customer?.displayName ?? '')
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button onClick={onSubmit} loading={submitting}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/* Auth method toggle */}
        <div>
          <Label>{t('editContract.authType')}</Label>
          <div className="flex gap-2">
            <AuthTab
              label="IPoE"
              description={t('editContract.ipoeDesc')}
              active={authMethod === 'IPOE'}
              onClick={() => setAuthMethod('IPOE')}
            />
            <AuthTab
              label="PPPoE"
              description={t('editContract.pppoeDesc')}
              active={authMethod === 'PPPOE'}
              onClick={() => setAuthMethod('PPPOE')}
            />
          </div>
          {willChangeMethod && (
            <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              ⚠ {t('editContract.methodChangeWarning')}
            </p>
          )}
        </div>

        {authMethod === 'PPPOE' ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="edit-pppoeUsername" required>
                {t('editContract.pppoeUsername')}
              </Label>
              <Input
                id="edit-pppoeUsername"
                value={form.pppoeUsername}
                onChange={(e) => update('pppoeUsername', e.target.value)}
              />
              <FieldError>{errors.pppoeUsername}</FieldError>
            </div>
            <div>
              <Label htmlFor="edit-pppoePassword" required>
                {t('editContract.pppoePassword')}
              </Label>
              <Input
                id="edit-pppoePassword"
                value={form.pppoePassword}
                onChange={(e) => update('pppoePassword', e.target.value)}
              />
              <FieldError>{errors.pppoePassword}</FieldError>
              <FieldHelp>
                {t('editContract.pppoePasswordHelp')}
              </FieldHelp>
            </div>
          </div>
        ) : (
          <div className="space-y-4 rounded-md border border-dashed border-border p-3">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="edit-circuitId">Circuit-ID</Label>
                <Input
                  id="edit-circuitId"
                  value={form.circuitId}
                  onChange={(e) => update('circuitId', e.target.value)}
                  placeholder="ex. 0/1/2:1.1"
                />
                <FieldError>{errors.circuitId}</FieldError>
              </div>
              <div>
                <Label htmlFor="edit-remoteId">Remote-ID</Label>
                <Input
                  id="edit-remoteId"
                  value={form.remoteId}
                  onChange={(e) => update('remoteId', e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label htmlFor="edit-mac">MAC</Label>
                <Input
                  id="edit-mac"
                  value={form.macAddress}
                  onChange={(e) => update('macAddress', e.target.value)}
                  placeholder="AA:BB:CC:DD:EE:FF"
                />
                <FieldError>{errors.macAddress}</FieldError>
              </div>
              <div>
                <Label htmlFor="edit-framedIp">{t('editContract.framedIp')}</Label>
                <Input
                  id="edit-framedIp"
                  value={form.framedIpAddress}
                  onChange={(e) => update('framedIpAddress', e.target.value)}
                />
                <FieldError>{errors.framedIpAddress}</FieldError>
              </div>
              <div>
                <Label htmlFor="edit-vlan">VLAN</Label>
                <Input
                  id="edit-vlan"
                  type="number"
                  min="1"
                  max="4094"
                  value={form.vlanId}
                  onChange={(e) => update('vlanId', e.target.value)}
                />
                <FieldError>{errors.vlanId}</FieldError>
              </div>
            </div>
          </div>
        )}

        {/* Plano e cobrança — troca de plano é endpoint separado (prorate) */}
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-text">{t('editContract.planAndBilling')}</div>
            <span
              className={
                'rounded-full px-2 py-0.5 text-xs font-medium ' +
                (contract.paymentMode === 'PREPAID'
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300')
              }
            >
              {contract.paymentMode === 'PREPAID' ? t('editContract.prepaid') : t('editContract.postpaid')}
            </span>
          </div>

          <div>
            <Label htmlFor="edit-plan">{t('editContract.plan')}</Label>
            <select
              id="edit-plan"
              value={selectedPlanId}
              onChange={(e) => setSelectedPlanId(e.target.value)}
              className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent"
              disabled={changingPlan}
            >
              <option value="">{t('editContract.noPlanOption')}</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.downloadMbps}/{p.uploadMbps} Mbps ·{' '}
                  {formatMoney(Number(p.monthlyPrice))}
                </option>
              ))}
            </select>
            {contract.paymentMode === 'PREPAID' && selectedPlanId !== contract.planId && (
              <FieldHelp>
                {t('editContract.prepaidPlanChangeHelp')}
              </FieldHelp>
            )}
          </div>

          {/* Preview do delta + botão Aplicar (só pra contratos ACTIVE pós-pagos) */}
          {selectedPlanId !== contract.planId &&
            contract.status === 'ACTIVE' &&
            contract.paymentMode === 'POSTPAID' && (
              <div className="space-y-2 rounded-md bg-surface-hover p-3 text-xs">
                <div className="flex items-center gap-2">
                  <input
                    id="edit-apply-proration"
                    type="checkbox"
                    checked={applyProration}
                    onChange={(e) => setApplyProration(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <label htmlFor="edit-apply-proration" className="text-text">
                    {t('editContract.applyProrationLabel')}
                  </label>
                </div>

                {previewLoading && (
                  <div className="text-text-muted">{t('editContract.calculating')}</div>
                )}

                {!previewLoading && planPreview && (
                  <div className="space-y-1 rounded bg-surface p-2">
                    <div className="text-text">
                      {t.rich('editContract.cycleSummary', {
                        start: planPreview.cycleStart,
                        end: planPreview.cycleEnd,
                        totalDays: planPreview.totalDays,
                        remainDays: planPreview.remainDays,
                        strong: (chunks) => <strong>{chunks}</strong>,
                      })}
                    </div>
                    <div className="text-text-muted">
                      {t('editContract.creditChargeLine', {
                        credit: formatMoney(planPreview.creditOld),
                        charge: formatMoney(planPreview.chargeNew),
                      })}
                    </div>
                    <div className="text-text">
                      {planPreview.delta > 0 && (
                        t.rich('editContract.prorationInvoice', {
                          amount: formatMoney(planPreview.delta),
                          due: planPreview.cycleEnd,
                          strong: (chunks) => <strong>{chunks}</strong>,
                        })
                      )}
                      {planPreview.delta < 0 && (
                        t.rich('editContract.creditNote', {
                          amount: formatMoney(Math.abs(planPreview.delta)),
                          strong: (chunks) => <strong>{chunks}</strong>,
                        })
                      )}
                      {planPreview.delta === 0 && (
                        <em className="text-text-muted">
                          {t('editContract.noExtraCharge')}
                        </em>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button
                    onClick={onApplyChangePlan}
                    loading={changingPlan}
                    disabled={changingPlan || !selectedPlanId}
                  >
                    {t('editContract.applyPlanChange')}
                  </Button>
                </div>
              </div>
            )}

          {selectedPlanId !== contract.planId &&
            contract.status === 'PENDING_INSTALL' && (
              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                {t.rich('editContract.pendingInstallPlanChange', {
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}
                <div className="mt-2 flex justify-end">
                  <Button
                    onClick={onApplyChangePlan}
                    loading={changingPlan}
                    disabled={changingPlan || !selectedPlanId}
                  >
                    {t('editContract.applyPlanChange')}
                  </Button>
                </div>
              </div>
            )}
        </div>

        {/* Comerciais */}
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label htmlFor="edit-monthlyValue" required>
              {t('editContract.monthlyValue', { currency: moneyLabel })}
            </Label>
            <Input
              id="edit-monthlyValue"
              type="number"
              step="0.01"
              min="0"
              value={form.monthlyValue}
              onChange={(e) => update('monthlyValue', e.target.value)}
            />
            <FieldError>{errors.monthlyValue}</FieldError>
            <FieldHelp>
              {t('editContract.monthlyValueHelp')}
            </FieldHelp>
          </div>
          <div>
            <Label htmlFor="edit-bandwidthMbps" required>
              {t('editContract.downloadMbps')}
            </Label>
            <Input
              id="edit-bandwidthMbps"
              type="number"
              min="1"
              value={form.bandwidthMbps}
              onChange={(e) => update('bandwidthMbps', e.target.value)}
            />
            <FieldError>{errors.bandwidthMbps}</FieldError>
          </div>
          <div>
            <Label htmlFor="edit-uploadMbps">{t('editContract.uploadMbps')}</Label>
            <Input
              id="edit-uploadMbps"
              type="number"
              min="1"
              value={form.uploadMbps}
              onChange={(e) => update('uploadMbps', e.target.value)}
              placeholder={tc('optional')}
            />
            <FieldError>{errors.uploadMbps}</FieldError>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="edit-dueDay" required>
              {t('editContract.dueDay')}
            </Label>
            <Input
              id="edit-dueDay"
              type="number"
              min="1"
              max="28"
              value={form.dueDay}
              onChange={(e) => update('dueDay', e.target.value)}
              disabled={contract.paymentMode === 'PREPAID'}
            />
            <FieldError>{errors.dueDay}</FieldError>
            {contract.paymentMode === 'PREPAID' && (
              <FieldHelp>{t('editContract.dueDayPrepaidHelp')}</FieldHelp>
            )}
          </div>
          <div>
            <Label htmlFor="edit-blockAfterDays">{t('editContract.blockAfterDays')}</Label>
            <Input
              id="edit-blockAfterDays"
              type="number"
              min="0"
              max="60"
              value={form.blockAfterDays}
              onChange={(e) => update('blockAfterDays', e.target.value)}
              placeholder={t('editContract.blockAfterDaysPlaceholder', { days: contract.effectiveBlockAfterDays })}
            />
            <FieldError>{errors.blockAfterDays}</FieldError>
            <FieldHelp>
              {t('editContract.blockAfterDaysHelp', { days: contract.effectiveBlockAfterDays })}
            </FieldHelp>
          </div>
        </div>

        {/* Forma de cobrança (gateway BR) */}
        <div>
          <Label htmlFor="edit-brGateway">Forma de cobrança</Label>
          <Select
            id="edit-brGateway"
            value={form.brBillingGateway}
            onChange={(e) =>
              setForm((s) => ({ ...s, brBillingGateway: e.target.value as BrPaymentGateway }))
            }
          >
            <option value="MANUAL">Manual (sem gateway)</option>
            <option value="EFI">EFI (Pix/Boleto)</option>
            <option value="BTG">BTG (Pix/Boleto)</option>
          </Select>
          <FieldHelp>
            {form.brBillingGateway === 'MANUAL'
              ? 'Faturas sem cobrança automática (baixa manual). Vale para faturas futuras.'
              : `Faturas futuras nascem já no ${form.brBillingGateway} (Pix/boleto automático).`}
          </FieldHelp>
        </div>

        {/* Endereço */}
        <AddressPicker
          country={tenant?.country}
          value={address}
          onChange={setAddress}
          error={errors.installationAddress}
          freeTextLabel={t('editContract.installationAddress')}
        />
        <div>
          <Label htmlFor="edit-installationMapsUrl">
            {t('editContract.mapsUrlLabel')}
          </Label>
          <Input
            id="edit-installationMapsUrl"
            type="url"
            value={form.installationMapsUrl}
            onChange={(e) => update('installationMapsUrl', e.target.value)}
            placeholder="https://maps.app.goo.gl/…"
          />
          <FieldError>{errors.installationMapsUrl}</FieldError>
        </div>

        {/* Geolocalização — pino no módulo Mapeamento */}
        <div>
          <Label>{t('editContract.locationLabel')}</Label>
          <LocationPicker value={location} onChange={setLocation} height="280px" />
          <FieldHelp>
            {t('editContract.locationHelp')}
          </FieldHelp>
        </div>

        <div>
          <Label htmlFor="edit-notes">{tc('notes')}</Label>
          <Textarea
            id="edit-notes"
            rows={3}
            value={form.notes}
            onChange={(e) => update('notes', e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

function AuthTab({
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
