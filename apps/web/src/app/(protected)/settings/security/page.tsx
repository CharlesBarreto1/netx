'use client';

import { Check, Copy, ShieldCheck, ShieldOff } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSWRConfig } from 'swr';

import { PasswordChecklist } from '@/components/auth/PasswordChecklist';
import { Button } from '@/components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  FieldError,
  FieldHelp,
  Input,
  Label,
} from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { authApi, type SetupMfaResponse } from '@/lib/auth-api';
import { checkPassword } from '@/lib/password';
import { useTenantConfig } from '@/lib/tenant-config';

/**
 * /settings/security — perfil pessoal de segurança.
 *
 * Cards:
 *   1. Trocar senha (com PasswordChecklist exibindo regras em tempo real).
 *   2. 2FA (TOTP):
 *      - se mfaEnabled === false → botão "Ativar" abre setup (QR + secret)
 *        → confirma com 1 token → mostra backup codes UMA VEZ.
 *      - se mfaEnabled === true → botão "Regenerar backup codes" + "Desativar".
 *
 * Sem permissão custom: qualquer user autenticado mexe na própria segurança.
 */
export default function SecurityPage() {
  const t = useTranslations('security');
  const tCommon = useTranslations('common');
  const { user, isLoading } = useTenantConfig();
  const { mutate } = useSWRConfig();

  // -- Senha
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  // -- MFA setup
  const [setup, setSetup] = useState<SetupMfaResponse | null>(null);
  const [setupToken, setSetupToken] = useState('');
  const [setupSaving, setSetupSaving] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  // -- MFA disable
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableSaving, setDisableSaving] = useState(false);

  // -- Regenerar backup codes
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenSaving, setRegenSaving] = useState(false);

  if (isLoading || !user) return <PageLoader label={tCommon('loading')} />;

  const pwCheck = checkPassword(newPassword);
  const pwMatches = newPassword.length > 0 && newPassword === confirmPassword;
  const canSubmitPw =
    !pwSaving && pwCheck.ok && pwMatches && currentPassword.length > 0;

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwSaving(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      toast.success(t('password.successToast'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPwError(err instanceof ApiError ? err.friendlyMessage : (err as Error).message);
    } finally {
      setPwSaving(false);
    }
  }

  async function handleStartSetup() {
    setSetupSaving(true);
    try {
      const res = await authApi.setupMfa();
      setSetup(res);
      setSetupToken('');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setSetupSaving(false);
    }
  }

  async function handleVerifySetup() {
    if (setupToken.length < 6) return;
    setSetupSaving(true);
    try {
      const res = await authApi.verifyMfa(setupToken);
      setBackupCodes(res.codes);
      setSetup(null);
      setSetupToken('');
      // Atualiza /v1/users/me pra refletir mfaEnabled=true
      await mutate('/v1/users/me');
      toast.success(t('mfa.activatedToast'));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setSetupSaving(false);
    }
  }

  async function handleDisableConfirm() {
    if (!disablePassword) return;
    setDisableSaving(true);
    try {
      await authApi.disableMfa(disablePassword);
      await mutate('/v1/users/me');
      toast.success(t('mfa.disabledToast'));
      setDisableOpen(false);
      setDisablePassword('');
      setBackupCodes(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setDisableSaving(false);
    }
  }

  async function handleRegenConfirm() {
    setRegenSaving(true);
    try {
      const res = await authApi.regenerateBackupCodes();
      setBackupCodes(res.codes);
      toast.success(t('mfa.regeneratedToast'));
      setRegenOpen(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setRegenSaving(false);
    }
  }

  function handleCopyCodes() {
    if (!backupCodes) return;
    void navigator.clipboard?.writeText(backupCodes.join('\n'));
    toast.success(t('mfa.copiedToast'));
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-text-muted">{t('subtitle')}</p>
      </header>

      {/* ========== Trocar senha ========== */}
      <Card>
        <CardHeader>
          <CardTitle>{t('password.title')}</CardTitle>
          <CardDescription>{t('password.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleChangePassword}
            className="grid grid-cols-1 gap-3 md:grid-cols-2"
          >
            <div>
              <Label htmlFor="current-password" required>
                {t('password.current')}
              </Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div>{/* spacer */}</div>

            <div>
              <Label htmlFor="new-password" required>
                {t('password.new')}
              </Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
              <PasswordChecklist value={newPassword} />
            </div>
            <div>
              <Label htmlFor="confirm-password" required>
                {t('password.confirm')}
              </Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
              {confirmPassword.length > 0 && !pwMatches && (
                <FieldError>{t('password.mismatch')}</FieldError>
              )}
            </div>

            {pwError && (
              <div className="md:col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                {pwError}
              </div>
            )}

            <div className="md:col-span-2 flex justify-end">
              <Button type="submit" disabled={!canSubmitPw} loading={pwSaving}>
                {t('password.submit')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ========== 2FA ========== */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {user.mfaEnabled ? (
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
            ) : (
              <ShieldOff className="h-4 w-4 text-text-muted" />
            )}
            {t('mfa.title')}
          </CardTitle>
          <CardDescription>
            {user.mfaEnabled ? t('mfa.statusOn') : t('mfa.statusOff')}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Caso 1: MFA inativo + sem setup em andamento → botão Ativar */}
          {!user.mfaEnabled && !setup && !backupCodes && (
            <Button onClick={handleStartSetup} loading={setupSaving}>
              {t('mfa.enable')}
            </Button>
          )}

          {/* Caso 2: setup em andamento → mostra QR e pede token */}
          {setup && (
            <div className="space-y-3 rounded-md border border-border bg-surface-muted p-4">
              <p className="text-sm">{t('mfa.scanInstructions')}</p>
              <div className="flex flex-col items-center gap-3 md:flex-row md:items-start">
                {/* QR code é base64 inline; `next/image` não agrega aqui. */}
                <img
                  src={setup.qrCodeDataUrl}
                  alt="QR code"
                  className="h-44 w-44 rounded border border-border bg-white p-2"
                />
                <div className="space-y-2 text-sm">
                  <div>
                    <Label>{t('mfa.manualSecret')}</Label>
                    <code className="block break-all rounded bg-surface px-2 py-1 font-mono text-xs">
                      {setup.secret}
                    </code>
                    <FieldHelp>{t('mfa.manualSecretHelp')}</FieldHelp>
                  </div>
                  <div>
                    <Label htmlFor="setup-token" required>
                      {t('mfa.tokenLabel')}
                    </Label>
                    <Input
                      id="setup-token"
                      inputMode="numeric"
                      maxLength={6}
                      value={setupToken}
                      onChange={(e) =>
                        setSetupToken(e.target.value.replace(/\D/gu, ''))
                      }
                      placeholder="000000"
                      autoFocus
                      className="font-mono tracking-widest"
                    />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      onClick={handleVerifySetup}
                      disabled={setupToken.length < 6}
                      loading={setupSaving}
                    >
                      {t('mfa.confirm')}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setSetup(null);
                        setSetupToken('');
                      }}
                    >
                      {tCommon('cancel')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Caso 3: backup codes recém-gerados → mostra UMA vez */}
          {backupCodes && (
            <div className="space-y-3 rounded-md border-2 border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-600" />
                <p className="text-sm font-semibold">
                  {t('mfa.backupCodesTitle')}
                </p>
              </div>
              <p className="text-xs text-text-muted">
                {t('mfa.backupCodesHelp')}
              </p>
              <ul className="grid grid-cols-2 gap-1 font-mono text-sm md:grid-cols-5">
                {backupCodes.map((c) => (
                  <li
                    key={c}
                    className="rounded bg-white px-2 py-1 text-center dark:bg-slate-900"
                  >
                    {c}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleCopyCodes}>
                  <Copy className="mr-1 h-3.5 w-3.5" />
                  {t('mfa.copy')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setBackupCodes(null)}
                >
                  {t('mfa.dismissCodes')}
                </Button>
              </div>
            </div>
          )}

          {/* Caso 4: MFA ativo → ações de manutenção */}
          {user.mfaEnabled && !backupCodes && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => setRegenOpen(true)}
              >
                {t('mfa.regenerate')}
              </Button>
              <Button variant="danger" onClick={() => setDisableOpen(true)}>
                {t('mfa.disable')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ========== Confirm dialogs ========== */}
      <ConfirmDialog
        open={regenOpen}
        onClose={() => setRegenOpen(false)}
        onConfirm={handleRegenConfirm}
        title={t('mfa.regenerateTitle')}
        message={t('mfa.regenerateMessage')}
        confirmLabel={t('mfa.regenerate')}
        loading={regenSaving}
      />

      {disableOpen && (
        <DisableMfaDialog
          loading={disableSaving}
          password={disablePassword}
          onChangePassword={setDisablePassword}
          onClose={() => {
            setDisableOpen(false);
            setDisablePassword('');
          }}
          onConfirm={handleDisableConfirm}
        />
      )}
    </div>
  );
}

/**
 * Dialog específico de desativação — pede a senha pra confirmar identidade.
 * Inline pra evitar criar mais um arquivo de UI; segue o padrão visual de
 * <Modal>/<ConfirmDialog> mas com input.
 */
function DisableMfaDialog({
  loading,
  password,
  onChangePassword,
  onClose,
  onConfirm,
}: {
  loading: boolean;
  password: string;
  onChangePassword: (v: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations('security');
  const tCommon = useTranslations('common');
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">{t('mfa.disableTitle')}</h2>
        <p className="mt-1 text-sm text-text-muted">{t('mfa.disableMessage')}</p>
        <div className="mt-3">
          <Label htmlFor="disable-password" required>
            {t('mfa.disablePasswordLabel')}
          </Label>
          <Input
            id="disable-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => onChangePassword(e.target.value)}
            autoFocus
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={!password}
            loading={loading}
          >
            {t('mfa.disable')}
          </Button>
        </div>
      </div>
    </div>
  );
}
