'use client';

import Link from 'next/link';
import { Plus, Trash2, Users as UsersIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldHelp, Input, Label, Select, Textarea } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  cashRegistersApi,
  type CashRegister,
  type CashRegisterRole,
  type CashRegisterType,
} from '@/lib/finance-api';
import { hasPermission } from '@/lib/session';
import { usersApi, type UserResponse } from '@/lib/users-api';
import type { Paginated } from '@/lib/crm-types';

const TYPE_OPTIONS: CashRegisterType[] = ['CASH', 'BANK', 'PIX', 'CARD', 'OTHER'];

/**
 * /settings/cash-registers — gestão de caixas + memberships.
 * Permissão: cash_registers.manage.
 */
export default function CashRegistersPage() {
  const tCR = useTranslations('cashRegisters');
  const tType = useTranslations('cashRegisters.typeLabel');
  const tCommon = useTranslations('common');
  const canManage = hasPermission('cash_registers.manage');

  const { data, isLoading, mutate } = useSWR<CashRegister[]>(
    cashRegistersApi.listPath(true),
  );

  const [editing, setEditing] = useState<CashRegister | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CashRegister | null>(null);
  const [managingMembers, setManagingMembers] = useState<CashRegister | null>(
    null,
  );

  if (isLoading || !data) return <PageLoader label={tCommon('loading')} />;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{tCR('title')}</h1>
          <p className="text-sm text-text-muted">{tCR('subtitle')}</p>
        </div>
        {canManage && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            {tCR('new')}
          </Button>
        )}
      </header>

      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              <th className="px-3 py-2">{tCR('fields.name')}</th>
              <th className="px-3 py-2">{tCR('fields.type')}</th>
              <th className="px-3 py-2">{tCR('fields.currency')}</th>
              <th className="px-3 py-2 text-right">{tCR('fields.openingBalance')}</th>
              <th className="px-3 py-2">{tCommon('status')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-text-muted">
                  {tCommon('nothingHere')}
                </td>
              </tr>
            ) : (
              data.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-medium">
                    <Link
                      href={`/settings/cash-registers/${r.id}`}
                      className="text-brand-600 hover:underline dark:text-brand-300"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-text-muted">
                    {tType(r.type)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-text-muted">
                    {r.currency}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-muted">
                    {r.openingBalance.toFixed(2)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={r.isActive ? 'success' : 'neutral'}>
                      {r.isActive ? tCR('fields.isActive') : 'Inativo'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canManage && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setManagingMembers(r)}
                        >
                          <UsersIcon className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(r)}
                        >
                          {tCommon('edit')}
                        </Button>
                        {r.isActive && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleting(r)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {(creating || editing) && (
        <CashRegisterFormDialog
          open
          initial={editing ?? undefined}
          onOpenChange={(v) => {
            if (!v) {
              setCreating(false);
              setEditing(null);
            }
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await mutate();
          }}
        />
      )}

      {managingMembers && (
        <MembersDialog
          cashRegister={managingMembers}
          onClose={() => {
            setManagingMembers(null);
            mutate();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await cashRegistersApi.remove(deleting.id);
            toast.success(tCommon('success'));
            setDeleting(null);
            await mutate();
          } catch (err) {
            toast.error(
              err instanceof ApiError ? err.friendlyMessage : 'Erro',
            );
          }
        }}
        title="Desativar caixa?"
        message={`O caixa "${deleting?.name ?? ''}" não aparecerá mais para novos pagamentos. Históricos ficam preservados.`}
        confirmLabel={tCommon('confirm')}
        variant="danger"
      />
    </div>
  );
}

// =============================================================================
// FORM DIALOG (create/edit caixa)
// =============================================================================
function CashRegisterFormDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: CashRegister;
  onSaved: () => void;
}) {
  const tCR = useTranslations('cashRegisters');
  const tType = useTranslations('cashRegisters.typeLabel');
  const tCommon = useTranslations('common');
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState<CashRegisterType>(initial?.type ?? 'CASH');
  const [color, setColor] = useState(initial?.color ?? '#2563eb');
  const [currency, setCurrency] = useState(initial?.currency ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [openingBalance, setOpeningBalance] = useState(
    String(initial?.openingBalance ?? 0),
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const body = {
        name: name.trim(),
        type,
        color: color || null,
        currency: currency || undefined,
        description: description.trim() || null,
        isActive,
        openingBalance: Number(openingBalance.replace(',', '.')) || 0,
      };
      if (isEdit && initial) {
        await cashRegistersApi.update(initial.id, body);
      } else {
        await cashRegistersApi.create({ ...body, operatorUserIds: [] });
      }
      toast.success(tCommon('success'));
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? tCommon('edit') : tCR('new')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <div>
              <Label htmlFor="cr-name" required>
                {tCR('fields.name')}
              </Label>
              <Input
                id="cr-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cr-type">{tCR('fields.type')}</Label>
                <Select
                  id="cr-type"
                  value={type}
                  onChange={(e) => setType(e.target.value as CashRegisterType)}
                >
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t} value={t}>
                      {tType(t)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="cr-currency">{tCR('fields.currency')}</Label>
                <Input
                  id="cr-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  maxLength={3}
                  placeholder="(default tenant)"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cr-color">{tCR('fields.color')}</Label>
                <Input
                  id="cr-color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="cr-balance">
                  {tCR('fields.openingBalance')}
                </Label>
                <Input
                  id="cr-balance"
                  inputMode="decimal"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="cr-desc">{tCR('fields.description')}</Label>
              <Textarea
                id="cr-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600"
              />
              {tCR('fields.isActive')}
            </label>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {tCommon('cancel')}
            </Button>
            <Button type="submit" loading={submitting}>
              {isEdit ? tCommon('save') : tCommon('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// MEMBERS DIALOG (gerenciar quem opera o caixa)
// =============================================================================
function MembersDialog({
  cashRegister,
  onClose,
}: {
  cashRegister: CashRegister;
  onClose: () => void;
}) {
  const tCR = useTranslations('cashRegisters');
  const tRole = useTranslations('cashRegisters.roleLabel');
  const tCommon = useTranslations('common');

  const { data: detail, mutate } = useSWR<CashRegister>(
    cashRegistersApi.getPath(cashRegister.id),
  );
  const { data: usersResp } = useSWR<Paginated<UserResponse>>(
    usersApi.listPath({ pageSize: 200 }),
  );

  const [pickedUserId, setPickedUserId] = useState('');
  const [pickedRole, setPickedRole] = useState<CashRegisterRole>('OPERATOR');
  const [busy, setBusy] = useState(false);

  async function addMember() {
    if (!pickedUserId) return;
    setBusy(true);
    try {
      await cashRegistersApi.addMember(cashRegister.id, pickedUserId, pickedRole);
      setPickedUserId('');
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(userId: string) {
    setBusy(true);
    try {
      await cashRegistersApi.removeMember(cashRegister.id, userId);
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  const memberIds = new Set((detail?.members ?? []).map((m) => m.userId));
  const availableUsers = (usersResp?.data ?? []).filter(
    (u) => !memberIds.has(u.id),
  );

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {tCR('members')} · {cashRegister.name}
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {/* Adicionar */}
          <div className="rounded-md border border-border bg-surface-muted p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              {tCR('addMember')}
            </div>
            <div className="mt-2 grid grid-cols-[1fr,140px,auto] gap-2">
              <Select
                value={pickedUserId}
                onChange={(e) => setPickedUserId(e.target.value)}
              >
                <option value="">{tCommon('select')}</option>
                {availableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.firstName} {u.lastName} ({u.email})
                  </option>
                ))}
              </Select>
              <Select
                value={pickedRole}
                onChange={(e) =>
                  setPickedRole(e.target.value as CashRegisterRole)
                }
              >
                <option value="OPERATOR">{tRole('OPERATOR')}</option>
                <option value="VIEWER">{tRole('VIEWER')}</option>
              </Select>
              <Button
                type="button"
                onClick={addMember}
                loading={busy}
                disabled={!pickedUserId}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <FieldHelp>
              Operadores podem dar baixa de pagamentos neste caixa.
            </FieldHelp>
          </div>

          {/* Lista */}
          <div className="rounded-md border border-border">
            {(detail?.members ?? []).length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-text-muted">
                {tCommon('nothingHere')}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {detail?.members?.map((m) => (
                  <li
                    key={m.userId}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <div>
                      <div className="font-medium text-text">
                        {m.user.firstName} {m.user.lastName}
                      </div>
                      <div className="text-xs text-text-muted">{m.user.email}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={m.role === 'OPERATOR' ? 'info' : 'neutral'}>
                        {tRole(m.role)}
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeMember(m.userId)}
                        disabled={busy}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {tCommon('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
