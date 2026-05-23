'use client';

/**
 * /settings/sifen — configuração SIFEN do tenant (PY).
 *
 * Seções:
 *   1. Status — enabled toggle + ambiente test/prod + badge resumo
 *   2. Emisor — RUC, timbrado, razón social, etc.
 *   3. Establecimiento — código, ponto, endereço, geo SET
 *   4. Certificado + CSC — upload .p12 + senha + CSC
 *
 * Save: PUT /v1/sifen/config (campos comuns) + POST /certificate (upload).
 * Toggle enabled valida server-side que tem cert + CSC + emisor mínimo.
 */
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { FieldError, FieldHelp, Input, Label } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import {
  sifenApi,
  type SifenConfigResponse,
  type SifenEmisor,
  type UpdateSifenConfigInput,
} from '@/lib/sifen-api';

export default function SifenSettingsPage() {
  const canWrite = hasPermission('sifen.config.write');
  const { data: config, mutate, isLoading } = useSWR<SifenConfigResponse>(
    sifenApi.configPath(),
    () => sifenApi.getConfig(),
  );

  if (isLoading || !config) return <PageLoader />;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">SIFEN — Fatura Eletrônica</h1>
        <p className="mt-1 text-sm text-text-muted">
          Configure RUC, timbrado, certificado .p12 e ambiente para emitir DTEs
          (Documentos Tributários Electrónicos) à SET — Paraguai.
        </p>
      </header>

      <StatusCard config={config} canWrite={canWrite} onSaved={() => mutate()} />
      <EmisorCard config={config} canWrite={canWrite} onSaved={() => mutate()} />
      <EstablecimientoCard config={config} canWrite={canWrite} onSaved={() => mutate()} />
      <CertificateCscCard config={config} canWrite={canWrite} onSaved={() => mutate()} />
    </div>
  );
}

// =============================================================================
// Status (toggle + ambiente)
// =============================================================================
function StatusCard({
  config,
  canWrite,
  onSaved,
}: {
  config: SifenConfigResponse;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [environment, setEnvironment] = useState(config.environment);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(config.enabled);
    setEnvironment(config.environment);
  }, [config.enabled, config.environment]);

  async function save() {
    setSaving(true);
    try {
      await sifenApi.saveConfig({ enabled, environment });
      toast.success('Status atualizado');
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  const statusBadge = (() => {
    if (!config.certificate?.exists) {
      return <Badge tone="neutral">Sem certificado</Badge>;
    }
    if (!config.emisor) return <Badge tone="warning">Falta emisor</Badge>;
    if (!config.csc.hasValue) return <Badge tone="warning">Falta CSC</Badge>;
    if (config.enabled) {
      return (
        <Badge tone={config.environment === 'prod' ? 'success' : 'warning'}>
          Ativo · {config.environment === 'prod' ? 'Produção' : 'Homologação'}
        </Badge>
      );
    }
    return <Badge tone="neutral">Configurado, desativado</Badge>;
  })();

  return (
    <Section title="Status" rightSlot={statusBadge}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Habilitar SIFEN</Label>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={!canWrite}
              className="h-4 w-4"
              id="sifen-enabled"
            />
            <label htmlFor="sifen-enabled" className="text-sm text-text">
              Permitir emissão de DTEs por este tenant
            </label>
          </div>
          <FieldHelp>
            Ao habilitar, o sistema exige RUC, timbrado, certificado .p12 e CSC
            configurados. Tente salvar com algo faltando e veremos o que falta.
          </FieldHelp>
        </div>
        <div>
          <Label>Ambiente</Label>
          <div className="flex gap-2">
            <EnvRadio
              label="Homologação"
              description="Endpoint test do SET — usado em PSC + Plan Piloto"
              active={environment === 'test'}
              onClick={() => setEnvironment('test')}
              disabled={!canWrite}
            />
            <EnvRadio
              label="Produção"
              description="Endpoint real — só após homologação aprovada"
              active={environment === 'prod'}
              onClick={() => setEnvironment('prod')}
              disabled={!canWrite}
            />
          </div>
        </div>
      </div>
      {canWrite && (
        <div className="mt-4 flex justify-end">
          <Button onClick={save} loading={saving}>
            Salvar status
          </Button>
        </div>
      )}
    </Section>
  );
}

function EnvRadio({
  label,
  description,
  active,
  onClick,
  disabled,
}: {
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={
        'flex-1 rounded-md border px-3 py-2 text-left text-sm transition-colors ' +
        (active
          ? 'border-accent bg-accent-muted text-text'
          : 'border-border bg-surface text-text-muted hover:bg-surface-hover ' +
            'disabled:opacity-60 disabled:cursor-not-allowed')
      }
    >
      <div className="font-semibold">{label}</div>
      <div className="text-xs text-text-muted">{description}</div>
    </button>
  );
}

// =============================================================================
// Emisor (RUC, timbrado, razón social, etc)
// =============================================================================
function EmisorCard({
  config,
  canWrite,
  onSaved,
}: {
  config: SifenConfigResponse;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<SifenEmisor>>(config.emisor ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(config.emisor ?? {});
  }, [config.emisor]);

  function set<K extends keyof SifenEmisor>(k: K, v: SifenEmisor[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    const e: Record<string, string> = {};
    if (!form.ruc) e.ruc = 'Obrigatório';
    if (!form.timbrado || !/^\d{8}$/.test(form.timbrado)) e.timbrado = '8 dígitos';
    if (!form.timbradoFecha) e.timbradoFecha = 'Obrigatório';
    if (!form.razonSocial) e.razonSocial = 'Obrigatório';
    if (!form.actividadCodigo) e.actividadCodigo = 'Obrigatório';
    if (!form.actividadDescripcion) e.actividadDescripcion = 'Obrigatório';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSaving(true);
    try {
      await sifenApi.saveConfig({ emisor: form });
      toast.success('Emisor salvo');
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Emisor (identificação fiscal)">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label required>RUC (sem DV)</Label>
          <Input
            value={form.ruc ?? ''}
            onChange={(e) => set('ruc', e.target.value)}
            placeholder="80012345"
            disabled={!canWrite}
          />
          <FieldError>{errors.ruc}</FieldError>
          <FieldHelp>Sem o dígito verificador — calculado automaticamente.</FieldHelp>
        </div>
        <div>
          <Label required>Timbrado</Label>
          <Input
            value={form.timbrado ?? ''}
            onChange={(e) => set('timbrado', e.target.value)}
            placeholder="12345678"
            disabled={!canWrite}
            maxLength={8}
          />
          <FieldError>{errors.timbrado}</FieldError>
        </div>
        <div>
          <Label required>Data início do timbrado</Label>
          <Input
            type="date"
            value={form.timbradoFecha ?? ''}
            onChange={(e) => set('timbradoFecha', e.target.value)}
            disabled={!canWrite}
          />
          <FieldError>{errors.timbradoFecha}</FieldError>
        </div>
        <div>
          <Label required>Razón social</Label>
          <Input
            value={form.razonSocial ?? ''}
            onChange={(e) => set('razonSocial', e.target.value)}
            placeholder="EMPRESA SA"
            disabled={!canWrite}
          />
          <FieldError>{errors.razonSocial}</FieldError>
        </div>
        <div>
          <Label>Nombre fantasia</Label>
          <Input
            value={form.nombreFantasia ?? ''}
            onChange={(e) => set('nombreFantasia', e.target.value)}
            placeholder="EMPRESA"
            disabled={!canWrite}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Tipo contribuyente</Label>
            <select
              value={form.tipoContribuyente ?? 2}
              onChange={(e) => set('tipoContribuyente', Number(e.target.value) as 1 | 2)}
              disabled={!canWrite}
              className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            >
              <option value={1}>1 — Persona física</option>
              <option value={2}>2 — Persona jurídica</option>
            </select>
          </div>
          <div>
            <Label>Tipo régimen</Label>
            <Input
              type="number"
              min={1}
              max={8}
              value={form.tipoRegimen ?? 8}
              onChange={(e) => set('tipoRegimen', Number(e.target.value))}
              disabled={!canWrite}
            />
            <FieldHelp>8 = Pequeño; 4 = IRACIS</FieldHelp>
          </div>
        </div>
        <div>
          <Label required>Código actividad económica</Label>
          <Input
            value={form.actividadCodigo ?? ''}
            onChange={(e) => set('actividadCodigo', e.target.value)}
            placeholder="6110"
            disabled={!canWrite}
          />
          <FieldError>{errors.actividadCodigo}</FieldError>
          <FieldHelp>CIIU — telecom geralmente 6110.</FieldHelp>
        </div>
        <div>
          <Label required>Descripción actividad</Label>
          <Input
            value={form.actividadDescripcion ?? ''}
            onChange={(e) => set('actividadDescripcion', e.target.value)}
            placeholder="Servicios de telecomunicaciones por cable"
            disabled={!canWrite}
          />
          <FieldError>{errors.actividadDescripcion}</FieldError>
        </div>
      </div>
      {canWrite && (
        <div className="mt-4 flex justify-end">
          <Button onClick={save} loading={saving}>Salvar emisor</Button>
        </div>
      )}
    </Section>
  );
}

// =============================================================================
// Establecimiento (estab, ponto, endereço, geo)
// =============================================================================
function EstablecimientoCard({
  config,
  canWrite,
  onSaved,
}: {
  config: SifenConfigResponse;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<SifenEmisor>>(config.emisor ?? {});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(config.emisor ?? {});
  }, [config.emisor]);

  function set<K extends keyof SifenEmisor>(k: K, v: SifenEmisor[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    setSaving(true);
    try {
      // Envia só os campos de establecimiento (backend faz merge).
      await sifenApi.saveConfig({
        emisor: {
          establecimiento: form.establecimiento,
          puntoExpedicion: form.puntoExpedicion,
          direccion: form.direccion,
          departamento: form.departamento,
          departamentoDesc: form.departamentoDesc,
          distrito: form.distrito,
          distritoDesc: form.distritoDesc,
          ciudad: form.ciudad,
          ciudadDesc: form.ciudadDesc,
          telefono: form.telefono,
          email: form.email,
        },
      });
      toast.success('Establecimiento salvo');
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Establecimiento e ponto de expedição">
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label required>Establecimiento</Label>
          <Input
            value={form.establecimiento ?? '001'}
            onChange={(e) => set('establecimiento', e.target.value)}
            maxLength={3}
            disabled={!canWrite}
          />
          <FieldHelp>3 dígitos (ex.: 001)</FieldHelp>
        </div>
        <div>
          <Label required>Punto expedición</Label>
          <Input
            value={form.puntoExpedicion ?? '001'}
            onChange={(e) => set('puntoExpedicion', e.target.value)}
            maxLength={3}
            disabled={!canWrite}
          />
        </div>
        <div>
          <Label>Telefone</Label>
          <Input
            value={form.telefono ?? ''}
            onChange={(e) => set('telefono', e.target.value)}
            placeholder="+595 21 123 4567"
            disabled={!canWrite}
          />
        </div>
        <div className="md:col-span-3">
          <Label required>Dirección do establecimiento</Label>
          <Input
            value={form.direccion ?? ''}
            onChange={(e) => set('direccion', e.target.value)}
            placeholder="Avda. España 1234"
            disabled={!canWrite}
          />
        </div>
        <div>
          <Label>Email do estabelecimiento</Label>
          <Input
            type="email"
            value={form.email ?? ''}
            onChange={(e) => set('email', e.target.value)}
            placeholder="facturacion@empresa.com.py"
            disabled={!canWrite}
          />
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div>
          <Label>Cód. Departamento</Label>
          <Input
            type="number"
            value={form.departamento ?? 11}
            onChange={(e) => set('departamento', Number(e.target.value))}
            disabled={!canWrite}
          />
          <FieldHelp>11 = Capital (Anexo C Manual v150)</FieldHelp>
        </div>
        <div>
          <Label>Desc. Departamento</Label>
          <Input
            value={form.departamentoDesc ?? 'CAPITAL'}
            onChange={(e) => set('departamentoDesc', e.target.value)}
            disabled={!canWrite}
          />
        </div>
        <div></div>
        <div>
          <Label>Cód. Distrito</Label>
          <Input
            type="number"
            value={form.distrito ?? 143}
            onChange={(e) => set('distrito', Number(e.target.value))}
            disabled={!canWrite}
          />
          <FieldHelp>143 = Asunción</FieldHelp>
        </div>
        <div>
          <Label>Desc. Distrito</Label>
          <Input
            value={form.distritoDesc ?? 'ASUNCION'}
            onChange={(e) => set('distritoDesc', e.target.value)}
            disabled={!canWrite}
          />
        </div>
        <div></div>
        <div>
          <Label>Cód. Ciudad</Label>
          <Input
            type="number"
            value={form.ciudad ?? 3344}
            onChange={(e) => set('ciudad', Number(e.target.value))}
            disabled={!canWrite}
          />
          <FieldHelp>3344 = Asunción</FieldHelp>
        </div>
        <div>
          <Label>Desc. Ciudad</Label>
          <Input
            value={form.ciudadDesc ?? 'ASUNCION (DISTRITO)'}
            onChange={(e) => set('ciudadDesc', e.target.value)}
            disabled={!canWrite}
          />
        </div>
      </div>
      {canWrite && (
        <div className="mt-4 flex justify-end">
          <Button onClick={save} loading={saving}>Salvar establecimiento</Button>
        </div>
      )}
    </Section>
  );
}

// =============================================================================
// Certificate + CSC
// =============================================================================
function CertificateCscCard({
  config,
  canWrite,
  onSaved,
}: {
  config: SifenConfigResponse;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pwd, setPwd] = useState('');
  const [uploading, setUploading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [cscId, setCscId] = useState(config.csc.id ?? '');
  const [cscValue, setCscValue] = useState('');
  const [savingCsc, setSavingCsc] = useState(false);

  useEffect(() => {
    setCscId(config.csc.id ?? '');
  }, [config.csc.id]);

  async function upload() {
    const f = fileRef.current?.files?.[0];
    if (!f) {
      toast.error('Selecione o arquivo .p12');
      return;
    }
    if (!pwd) {
      toast.error('Informe a senha do .p12');
      return;
    }
    setUploading(true);
    try {
      await sifenApi.uploadCertificate(f, pwd);
      toast.success('Certificado salvo e validado');
      setPwd('');
      if (fileRef.current) fileRef.current.value = '';
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha: ${msg}`);
    } finally {
      setUploading(false);
    }
  }

  async function remove() {
    setRemoving(true);
    try {
      await sifenApi.deleteCertificate();
      toast.success('Certificado removido');
      setConfirmRemove(false);
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha: ${msg}`);
    } finally {
      setRemoving(false);
    }
  }

  async function saveCsc() {
    if (!cscId) {
      toast.error('Informe o ID do CSC (1, 2...)');
      return;
    }
    setSavingCsc(true);
    try {
      await sifenApi.saveConfig({
        csc: { id: cscId, value: cscValue || undefined },
      });
      toast.success('CSC salvo');
      setCscValue('');
      onSaved();
    } catch (err) {
      const msg = err instanceof ApiError ? err.friendlyMessage : (err as Error).message;
      toast.error(`Falha: ${msg}`);
    } finally {
      setSavingCsc(false);
    }
  }

  const cert = config.certificate;
  const expiring = cert?.daysUntilExpiry != null && cert.daysUntilExpiry < 30;
  const expired = cert?.daysUntilExpiry != null && cert.daysUntilExpiry < 0;

  return (
    <Section title="Certificado .p12 e CSC">
      {/* === Cert info === */}
      {cert?.exists ? (
        <div className="space-y-2 rounded-md border border-border bg-surface-muted p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <strong className="text-text">Certificado atual</strong>
            {expired ? (
              <Badge tone="danger">Expirado</Badge>
            ) : expiring ? (
              <Badge tone="warning">Expira em {cert.daysUntilExpiry} dia(s)</Badge>
            ) : (
              <Badge tone="success">Válido</Badge>
            )}
          </div>
          <Detail label="Common Name" value={cert.commonName ?? '—'} />
          <Detail label="Válido de" value={cert.validFrom?.slice(0, 10) ?? '—'} />
          <Detail label="Válido até" value={cert.validTo?.slice(0, 10) ?? '—'} />
          <Detail
            label="Fingerprint SHA-256"
            value={<span className="font-mono text-xs break-all">{cert.fingerprint}</span>}
          />
          <Detail label="Senha salva" value={cert.hasPassword ? 'Sim' : 'Não'} />
          {canWrite && (
            <div className="pt-2">
              <Button variant="danger" size="sm" onClick={() => setConfirmRemove(true)}>
                Remover certificado
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Nenhum certificado configurado. Suba o .p12 abaixo.
        </p>
      )}

      {canWrite && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <Label>Arquivo .p12</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".p12,application/x-pkcs12"
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent-muted file:px-3 file:py-1.5 file:text-text hover:file:bg-accent-muted/80"
            />
            <FieldHelp>PKCS#12 emitido por PSC certificado pelo MIC PY (máx 100KB)</FieldHelp>
          </div>
          <div>
            <Label>Senha do .p12</Label>
            <Input
              type="password"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
            <FieldHelp>Cifrada AES-256-GCM antes de salvar (KMS_MASTER_KEY)</FieldHelp>
          </div>
        </div>
      )}
      {canWrite && (
        <div className="mt-3 flex justify-end">
          <Button onClick={upload} loading={uploading} disabled={uploading}>
            Subir e validar certificado
          </Button>
        </div>
      )}

      {/* === CSC === */}
      <hr className="my-5 border-border" />
      <div>
        <h3 className="text-sm font-semibold text-text">CSC — Código de Seguridad do Contribuyente</h3>
        <p className="mt-1 text-xs text-text-muted">
          Obtido em <a href="https://ekuatia.set.gov.py" target="_blank" rel="noopener noreferrer" className="text-brand-500 hover:underline">ekuatia.set.gov.py</a>{' '}
          → seção "Códigos de Seguridad". O CSC gera o QR code do KuDE.
        </p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <Label>ID do CSC</Label>
            <Input
              value={cscId}
              onChange={(e) => setCscId(e.target.value)}
              placeholder="1"
              maxLength={2}
              disabled={!canWrite}
            />
          </div>
          <div>
            <Label>Valor do CSC {config.csc.hasValue && '(já configurado)'}</Label>
            <Input
              type="password"
              value={cscValue}
              onChange={(e) => setCscValue(e.target.value)}
              placeholder={config.csc.hasValue ? 'manter atual (deixe vazio)' : 'cole o CSC aqui'}
              disabled={!canWrite}
              autoComplete="new-password"
            />
            <FieldHelp>Cifrado AES-256-GCM. Para manter o atual, deixe vazio.</FieldHelp>
          </div>
        </div>
        {canWrite && (
          <div className="mt-3 flex justify-end">
            <Button onClick={saveCsc} loading={savingCsc}>Salvar CSC</Button>
          </div>
        )}
      </div>

      {confirmRemove && (
        <ConfirmDialog
          open
          onClose={() => setConfirmRemove(false)}
          onConfirm={remove}
          title="Remover certificado"
          message="O .p12 será apagado e o SIFEN ficará desativado até subir um novo. Continuar?"
          confirmLabel="Remover"
          variant="danger"
          loading={removing}
        />
      )}
    </Section>
  );
}

// =============================================================================
// UI primitives locais
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

function Detail({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-text-muted">{label}</span>
      <span className="text-text">{value}</span>
    </div>
  );
}
