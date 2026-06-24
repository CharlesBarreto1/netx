'use client';

/**
 * /settings/nfcom — configuração NFCom do tenant (BR, modelo 62).
 *
 * Seções:
 *   1. Status        — habilitar + ambiente + transmissor (agregador)
 *   2. Emitente      — CNPJ, IE, razão social, UF, série, etc.
 *   3. Tributação    — defaults ICMS (CST/alíquota/CFOP/cClass/tpServ)
 *   4. Credenciais   — API key do agregador (write-only) + certificado .pfx
 *
 * Save: PUT /v1/nfcom/config + POST/DELETE /v1/nfcom/config/certificate.
 * Habilitar valida server-side a identidade mínima (CNPJ + razão social + UF).
 */
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { FieldHelp, Input, Label } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  nfcomApi,
  type NfcomConfigResponse,
  type NfcomEmitente,
  type NfcomTaxDefaults,
} from '@/lib/nfcom-api';

const selectClass =
  'block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm';

export default function NfcomSettingsPage() {
  const canWrite = hasPermission('nfcom.config');
  const { data: config, mutate, isLoading } = useSWR<NfcomConfigResponse>(
    '/v1/nfcom/config',
    () => nfcomApi.getConfig(),
  );

  if (isLoading || !config) return <PageLoader />;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">NFCom (Brasil)</h1>
        <p className="mt-1 text-sm text-text-muted">
          Nota Fiscal Fatura de Serviço de Comunicação Eletrônica (modelo 62),
          autorizada pelo SVRS. Emissão via transmissor plugável.
        </p>
      </header>

      <StatusCard config={config} canWrite={canWrite} onSaved={() => mutate()} />
      <EmitenteCard config={config} canWrite={canWrite} onSaved={() => mutate()} />
      <TaxCard config={config} canWrite={canWrite} onSaved={() => mutate()} />
      <CredentialsCard config={config} canWrite={canWrite} onSaved={() => mutate()} />
    </div>
  );
}

// =============================================================================
// Status
// =============================================================================
function StatusCard({
  config,
  canWrite,
  onSaved,
}: {
  config: NfcomConfigResponse;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [environment, setEnvironment] = useState(config.environment);
  const [transmitter, setTransmitter] = useState(config.transmitter);
  const [autoGenerate, setAutoGenerate] = useState(config.autoGenerate);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(config.enabled);
    setEnvironment(config.environment);
    setTransmitter(config.transmitter);
    setAutoGenerate(config.autoGenerate);
  }, [config.enabled, config.environment, config.transmitter, config.autoGenerate]);

  async function save() {
    setSaving(true);
    try {
      await nfcomApi.saveConfig({ enabled, environment, transmitter, autoGenerate });
      toast.success('Configuração salva.');
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Erro: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  const badge = (() => {
    if (!config.emitente) return <Badge tone="neutral">Sem emitente</Badge>;
    if (!config.credentials.hasValue)
      return <Badge tone="warning">Sem credenciais</Badge>;
    if (config.enabled)
      return (
        <Badge tone={config.environment === 'PRODUCAO' ? 'success' : 'warning'}>
          {config.environment === 'PRODUCAO' ? 'Ativo · Produção' : 'Ativo · Homologação'}
        </Badge>
      );
    return <Badge tone="neutral">Configurado · desligado</Badge>;
  })();

  return (
    <Section title="Status" rightSlot={badge}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Habilitar emissão de NFCom</Label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={!canWrite}
            />
            <span className="text-sm text-text-muted">
              Quando ligado, a operação pode emitir NFCom a partir das faturas.
            </span>
          </label>
        </div>
        <div>
          <Label>Ambiente</Label>
          <select
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as NfcomConfigResponse['environment'])}
            disabled={!canWrite}
            className={selectClass}
          >
            <option value="HOMOLOGACAO">Homologação (testes)</option>
            <option value="PRODUCAO">Produção (válido fiscalmente)</option>
          </select>
        </div>
        <div>
          <Label>Transmissor</Label>
          <select
            value={transmitter}
            onChange={(e) => setTransmitter(e.target.value as NfcomConfigResponse['transmitter'])}
            disabled={!canWrite}
            className={selectClass}
          >
            <option value="NUVEM_FISCAL">Nuvem Fiscal (agregador REST)</option>
            <option value="FOCUS_NFE">Focus NFe (agregador REST)</option>
            <option value="SVRS_DIRECT">SVRS direto (em breve)</option>
          </select>
          <FieldHelp>O agregador gera, assina e transmite o XML ao SVRS.</FieldHelp>
        </div>
        <div>
          <Label>Emissão automática</Label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={autoGenerate}
              onChange={(e) => setAutoGenerate(e.target.checked)}
              disabled={!canWrite}
            />
            <span className="text-sm text-text-muted">
              Emitir NFCom automaticamente a partir da fatura (cron).
            </span>
          </label>
        </div>
      </div>
      {canWrite && (
        <div className="mt-4 flex justify-end">
          <Button onClick={save} loading={saving}>Salvar</Button>
        </div>
      )}
    </Section>
  );
}

// =============================================================================
// Emitente
// =============================================================================
function EmitenteCard({
  config,
  canWrite,
  onSaved,
}: {
  config: NfcomConfigResponse;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<NfcomEmitente>>(config.emitente ?? {});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(config.emitente ?? {});
  }, [config.emitente]);

  function set<K extends keyof NfcomEmitente>(k: K, v: NfcomEmitente[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      await nfcomApi.saveConfig({ emitente: form });
      toast.success('Emitente salvo.');
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Erro: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Emitente">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label required>CNPJ</Label>
          <Input
            value={form.cnpj ?? ''}
            onChange={(e) => set('cnpj', e.target.value.replace(/\D/g, ''))}
            placeholder="12345678000190"
            maxLength={14}
            disabled={!canWrite}
          />
          <FieldHelp>Só dígitos (14).</FieldHelp>
        </div>
        <div>
          <Label>Inscrição Estadual</Label>
          <Input
            value={form.inscricaoEstadual ?? ''}
            onChange={(e) => set('inscricaoEstadual', e.target.value)}
            disabled={!canWrite}
          />
        </div>
        <div>
          <Label required>Razão social</Label>
          <Input
            value={form.razaoSocial ?? ''}
            onChange={(e) => set('razaoSocial', e.target.value)}
            disabled={!canWrite}
          />
        </div>
        <div>
          <Label>Nome fantasia</Label>
          <Input
            value={form.nomeFantasia ?? ''}
            onChange={(e) => set('nomeFantasia', e.target.value)}
            disabled={!canWrite}
          />
        </div>
        <div>
          <Label required>UF</Label>
          <Input
            value={form.uf ?? ''}
            onChange={(e) => set('uf', e.target.value.toUpperCase().slice(0, 2))}
            placeholder="SP"
            maxLength={2}
            disabled={!canWrite}
          />
        </div>
        <div>
          <Label>Código do município (IBGE)</Label>
          <Input
            value={form.codMunicipio ?? ''}
            onChange={(e) => set('codMunicipio', e.target.value.replace(/\D/g, '').slice(0, 7))}
            placeholder="3550308"
            maxLength={7}
            disabled={!canWrite}
          />
        </div>
        <div>
          <Label>Regime tributário (CRT)</Label>
          <select
            value={form.crt ?? ''}
            onChange={(e) => set('crt', (e.target.value || undefined) as NfcomEmitente['crt'])}
            disabled={!canWrite}
            className={selectClass}
          >
            <option value="">—</option>
            <option value="1">1 · Simples Nacional</option>
            <option value="2">2 · Simples Nacional (excesso)</option>
            <option value="3">3 · Regime Normal</option>
          </select>
        </div>
        <div>
          <Label>Série</Label>
          <Input
            value={form.serie ?? '1'}
            onChange={(e) => set('serie', e.target.value.replace(/\D/g, '').slice(0, 3))}
            placeholder="1"
            maxLength={3}
            disabled={!canWrite}
          />
        </div>
      </div>

      <h3 className="mt-5 mb-2 text-sm font-semibold text-text">Endereço do emitente</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label required>Logradouro</Label>
          <Input value={form.endLogradouro ?? ''} onChange={(e) => set('endLogradouro', e.target.value)} disabled={!canWrite} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label required>Número</Label>
            <Input value={form.endNumero ?? ''} onChange={(e) => set('endNumero', e.target.value)} disabled={!canWrite} />
          </div>
          <div>
            <Label>Complemento</Label>
            <Input value={form.endComplemento ?? ''} onChange={(e) => set('endComplemento', e.target.value)} disabled={!canWrite} />
          </div>
        </div>
        <div>
          <Label required>Bairro</Label>
          <Input value={form.endBairro ?? ''} onChange={(e) => set('endBairro', e.target.value)} disabled={!canWrite} />
        </div>
        <div>
          <Label required>Município (nome)</Label>
          <Input value={form.endMunicipioNome ?? ''} onChange={(e) => set('endMunicipioNome', e.target.value)} placeholder="São Paulo" disabled={!canWrite} />
        </div>
        <div>
          <Label required>CEP</Label>
          <Input
            value={form.endCep ?? ''}
            onChange={(e) => set('endCep', e.target.value.replace(/\D/g, '').slice(0, 8))}
            placeholder="01310100"
            maxLength={8}
            disabled={!canWrite}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Telefone</Label>
            <Input value={form.fone ?? ''} onChange={(e) => set('fone', e.target.value.replace(/\D/g, '').slice(0, 12))} disabled={!canWrite} />
          </div>
          <div>
            <Label>E-mail</Label>
            <Input value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} disabled={!canWrite} />
          </div>
        </div>
      </div>

      {canWrite && (
        <div className="mt-4 flex justify-end">
          <Button onClick={save} loading={saving}>Salvar</Button>
        </div>
      )}
    </Section>
  );
}

// =============================================================================
// Tributação (defaults)
// =============================================================================
function TaxCard({
  config,
  canWrite,
  onSaved,
}: {
  config: NfcomConfigResponse;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<NfcomTaxDefaults>(config.taxDefaults ?? {});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(config.taxDefaults ?? {});
  }, [config.taxDefaults]);

  function set<K extends keyof NfcomTaxDefaults>(k: K, v: NfcomTaxDefaults[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      await nfcomApi.saveConfig({ taxDefaults: form });
      toast.success('Tributação salva.');
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Erro: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Tributação (padrões ICMS)">
      <p className="mb-3 text-xs text-text-muted">
        Valores padrão aplicados na emissão. São copiados (denormalizados) em cada
        NFCom no momento da emissão.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label>CST ICMS</Label>
          <Input
            value={form.cstIcms ?? ''}
            onChange={(e) => set('cstIcms', e.target.value)}
            placeholder="00"
            maxLength={3}
            disabled={!canWrite}
          />
        </div>
        <div>
          <Label>Alíquota ICMS (%)</Label>
          <Input
            type="number"
            step="0.01"
            min={0}
            max={100}
            value={form.aliquotaIcms ?? ''}
            onChange={(e) =>
              set('aliquotaIcms', e.target.value === '' ? undefined : Number(e.target.value))
            }
            placeholder="25.00"
            disabled={!canWrite}
          />
        </div>
        <div>
          <Label>CFOP</Label>
          <Input
            value={form.cfop ?? ''}
            onChange={(e) => set('cfop', e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="5307"
            maxLength={4}
            disabled={!canWrite}
          />
        </div>
        <div>
          <Label>cClass (classificação)</Label>
          <Input
            value={form.cClass ?? ''}
            onChange={(e) => set('cClass', e.target.value)}
            placeholder="0100101"
            maxLength={7}
            disabled={!canWrite}
          />
        </div>
        <div>
          <Label>tpServ</Label>
          <Input
            value={form.tpServ ?? ''}
            onChange={(e) => set('tpServ', e.target.value)}
            placeholder="1"
            maxLength={2}
            disabled={!canWrite}
          />
        </div>
      </div>
      {canWrite && (
        <div className="mt-4 flex justify-end">
          <Button onClick={save} loading={saving}>Salvar</Button>
        </div>
      )}
    </Section>
  );
}

// =============================================================================
// Credenciais + Certificado
// =============================================================================
function CredentialsCard({
  config,
  canWrite,
  onSaved,
}: {
  config: NfcomConfigResponse;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);

  const [certPassword, setCertPassword] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [diagnosing, setDiagnosing] = useState(false);

  async function diagnose() {
    setDiagnosing(true);
    try {
      const r = await nfcomApi.diagnose();
      if (r.ok) {
        toast.success(`SVRS em operação (cStat ${r.cStat}). ${r.motivo ?? ''}`);
      } else {
        toast.error(`Falha no handshake SVRS: ${r.error ?? r.motivo ?? `cStat ${r.cStat}`}`);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Erro: ${msg}`);
    } finally {
      setDiagnosing(false);
    }
  }

  async function saveKey() {
    if (!apiKey.trim()) return;
    setSavingKey(true);
    try {
      await nfcomApi.saveConfig({ credentials: { apiKey: apiKey.trim() } });
      setApiKey('');
      toast.success('Credencial salva.');
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Erro: ${msg}`);
    } finally {
      setSavingKey(false);
    }
  }

  async function uploadCert() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error('Selecione o arquivo .pfx.');
      return;
    }
    if (!certPassword) {
      toast.error('Informe a senha do certificado.');
      return;
    }
    setUploading(true);
    try {
      await nfcomApi.uploadCertificate(file, certPassword);
      setCertPassword('');
      if (fileRef.current) fileRef.current.value = '';
      toast.success('Certificado enviado.');
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Erro: ${msg}`);
    } finally {
      setUploading(false);
    }
  }

  async function removeCert() {
    setUploading(true);
    try {
      await nfcomApi.deleteCertificate();
      toast.success('Certificado removido.');
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Erro: ${msg}`);
    } finally {
      setUploading(false);
    }
  }

  const cert = config.certificate;

  return (
    <Section
      title="Credenciais & Certificado"
      rightSlot={
        config.credentials.hasValue ? (
          <Badge tone="success">API key salva</Badge>
        ) : (
          <Badge tone="neutral">Sem API key</Badge>
        )
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label>API key do agregador ({config.transmitter})</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={config.credentials.hasValue ? '•••••••• (já salva)' : 'cole a chave'}
            disabled={!canWrite}
          />
          <FieldHelp>Guardada cifrada (AES-256-GCM). Nunca exibida de volta.</FieldHelp>
          {canWrite && (
            <Button onClick={saveKey} loading={savingKey} disabled={!apiKey.trim()}>
              Salvar credencial
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <Label>Certificado A1 (.pfx)</Label>
          {cert?.exists ? (
            <div className="rounded-md border border-border bg-bg p-3 text-xs">
              <Detail label="Titular" value={cert.commonName ?? '—'} />
              <Detail
                label="Validade"
                value={cert.validTo ? new Date(cert.validTo).toLocaleDateString('pt-BR') : '—'}
              />
              <Detail
                label="Dias p/ expirar"
                value={
                  cert.daysUntilExpiry != null ? (
                    <span className={cert.daysUntilExpiry < 30 ? 'text-danger' : 'text-text'}>
                      {cert.daysUntilExpiry}
                    </span>
                  ) : (
                    '—'
                  )
                }
              />
            </div>
          ) : (
            <p className="text-xs text-text-muted">
              Necessário apenas para SVRS direto ou agregadores que assinam com o
              certificado do cliente.
            </p>
          )}
          {canWrite && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".pfx,.p12"
                className="block w-full text-xs"
              />
              <Input
                type="password"
                value={certPassword}
                onChange={(e) => setCertPassword(e.target.value)}
                placeholder="senha do .pfx"
              />
              <div className="flex gap-2">
                <Button onClick={uploadCert} loading={uploading}>
                  Enviar certificado
                </Button>
                {cert?.exists && (
                  <Button variant="ghost" onClick={removeCert} disabled={uploading}>
                    Remover
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-xs text-text-muted">
          Testa o handshake mTLS com o SVRS (NFComStatusServico) usando o
          certificado e o ambiente configurados — não emite documento.
        </p>
        {canWrite && (
          <Button variant="secondary" onClick={diagnose} loading={diagnosing}>
            Testar conexão SVRS
          </Button>
        )}
      </div>
    </Section>
  );
}

// =============================================================================
// UI helpers (espelham o page do SIFEN)
// =============================================================================
function Section({
  title,
  rightSlot,
  children,
}: {
  title: string;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-text">{title}</h2>
        {rightSlot}
      </div>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-text-muted">{label}</span>
      <span className="text-text">{value}</span>
    </div>
  );
}
