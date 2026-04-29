'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import {
  FieldError,
  FieldHelp,
  Input,
  Label,
  Select,
} from '@/components/ui/Input';
import { ApiError } from '@/lib/api';
import { MENU_CATALOG } from '@/lib/menus';
import {
  rolesApi,
  usersApi,
  type CreateUserInput,
  type RoleResponse,
  type UpdateUserInput,
  type UserResponse,
  type UserStatus,
} from '@/lib/users-api';

/**
 * UserForm — formulário compartilhado entre criar e editar usuário.
 *
 * Decisões:
 *   - Modo `create`: pede email/nome/sobrenome + role + checklist de menus.
 *     Email vira `INVITED` por default (backend manda email/senha temporária).
 *   - Modo `edit`: edita nome/sobrenome/telefone/status, role e menus. Email
 *     é read-only (alterar email exige fluxo de verificação separado).
 *   - **Role picker** é single-select pra simplicidade (Operador/Administrador
 *     /Visualizador). Pelo schema já dava pra ter múltiplos roles, mas a UI
 *     fica mais clara assim. Se precisar de combinação, basta trocar `select`
 *     por `multi-select`.
 *   - **Menu checklist**: lista todos os menus do `MENU_CATALOG`. Marcar/
 *     desmarcar atualiza `menuAccess`. Se TODOS estão marcados, salvamos
 *     `null` (sem override) — assim o user passa a herdar visibilidade
 *     futura caso adicionemos menus novos.
 */
export interface UserFormProps {
  mode: 'create' | 'edit';
  initial?: UserResponse;
  onSuccess: (user: UserResponse) => void;
  onCancel?: () => void;
}

export function UserForm({ mode, initial, onSuccess, onCancel }: UserFormProps) {
  const tCommon = useTranslations('common');
  const tForm = useTranslations('users.form');
  const tRoles = useTranslations('users.roles');
  const tStatus = useTranslations('users.statusLabel');
  const isEdit = mode === 'edit';

  // Roles disponíveis no tenant (pra montar o select).
  const { data: roles } = useSWR<RoleResponse[]>(rolesApi.path());

  const [email, setEmail] = useState(initial?.email ?? '');
  const [firstName, setFirstName] = useState(initial?.firstName ?? '');
  const [lastName, setLastName] = useState(initial?.lastName ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [status, setStatus] = useState<UserStatus>(initial?.status ?? 'INVITED');
  const [roleId, setRoleId] = useState<string>(initial?.roles?.[0]?.id ?? '');
  // Em create, default: tudo liberado. Em edit: o que o user já tem (null = todos).
  const [menuKeys, setMenuKeys] = useState<Set<string>>(() => {
    const all = new Set(MENU_CATALOG.map((m) => m.key));
    if (!initial || initial.menuAccess === null || initial.menuAccess === undefined) {
      return all;
    }
    return new Set(initial.menuAccess);
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Quando os roles carregam e ainda não temos roleId selecionado, default
  // pra "operator" (mais comum de criar, e dá pra elevar depois).
  useEffect(() => {
    if (!roleId && roles && roles.length > 0) {
      const operator = roles.find((r) => r.name === 'operator');
      setRoleId((operator ?? roles[0]).id);
    }
  }, [roles, roleId]);

  const sortedRoles = useMemo(() => {
    if (!roles) return [];
    // Esconde superadmin do select por default — é cross-tenant, raramente
    // atribuído pela tela. Se um dia precisar, removemos esse filtro.
    return roles
      .filter((r) => r.name !== 'superadmin')
      .slice()
      .sort((a, b) => a.priority - b.priority);
  }, [roles]);

  function toggleMenu(key: string) {
    setMenuKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAll() {
    setMenuKeys(new Set(MENU_CATALOG.map((m) => m.key)));
  }
  function selectNone() {
    setMenuKeys(new Set());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    if (!isEdit && !email.trim()) {
      setError('Email é obrigatório');
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      setError('Nome e sobrenome são obrigatórios');
      return;
    }
    if (!roleId) {
      setError('Selecione um papel');
      return;
    }

    // Se TODOS os menus estão marcados, manda null (= sem override; herda novos
    // menus automaticamente). Se tem subset, manda o array.
    const allKeys = MENU_CATALOG.map((m) => m.key);
    const allChecked =
      allKeys.length > 0 && allKeys.every((k) => menuKeys.has(k));
    const menuAccess: string[] | null = allChecked ? null : Array.from(menuKeys);

    setSubmitting(true);
    try {
      let saved: UserResponse;
      if (isEdit && initial) {
        const body: UpdateUserInput = {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim() || null,
          roleIds: [roleId],
          menuAccess,
          status,
        };
        saved = await usersApi.update(initial.id, body);
      } else {
        const body: CreateUserInput = {
          email: email.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim() || undefined,
          roleIds: [roleId],
          menuAccess,
          sendInvite: true,
        };
        saved = await usersApi.create(body);
      }
      onSuccess(saved);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.friendlyMessage);
        if (err.problem.errors) {
          const map: Record<string, string> = {};
          for (const fe of err.problem.errors) {
            if (fe.path) map[fe.path] = fe.message;
          }
          setFieldErrors(map);
        }
      } else {
        setError((err as Error).message ?? 'Erro inesperado');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Identificação */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label htmlFor="u-email" required={!isEdit}>
            Email
          </Label>
          <Input
            id="u-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isEdit}
          />
          <FieldError>{fieldErrors.email}</FieldError>
          {isEdit && <FieldHelp>{tForm('emailHelp')}</FieldHelp>}
        </div>
        <div>
          <Label htmlFor="u-firstName" required>
            {tCommon('name')}
          </Label>
          <Input
            id="u-firstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
          <FieldError>{fieldErrors.firstName}</FieldError>
        </div>
        <div>
          <Label htmlFor="u-lastName" required>
            Sobrenome
          </Label>
          <Input
            id="u-lastName"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
          <FieldError>{fieldErrors.lastName}</FieldError>
        </div>
        <div>
          <Label htmlFor="u-phone">{tCommon('phone')}</Label>
          <Input
            id="u-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        {isEdit && (
          <div>
            <Label htmlFor="u-status">{tCommon('status')}</Label>
            <Select
              id="u-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as UserStatus)}
            >
              <option value="ACTIVE">{tStatus('ACTIVE')}</option>
              <option value="INVITED">{tStatus('INVITED')}</option>
              <option value="SUSPENDED">{tStatus('SUSPENDED')}</option>
              <option value="DISABLED">{tStatus('DISABLED')}</option>
            </Select>
          </div>
        )}
      </section>

      {/* Papel */}
      <section>
        <h3 className="text-sm font-semibold text-text">{tForm('roleTitle')}</h3>
        <p className="text-xs text-text-muted">{tForm('roleSubtitle')}</p>
        <div className="mt-2">
          <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {sortedRoles.length === 0 && (
              <option value="">{tCommon('loading')}</option>
            )}
            {sortedRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {translateRoleName(tRoles, r.name)}
                {r.description ? ` — ${r.description}` : ''}
              </option>
            ))}
          </Select>
        </div>
      </section>

      {/* Checklist de menus */}
      <section>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-text">{tForm('menusTitle')}</h3>
            <p className="text-xs text-text-muted">{tForm('menusSubtitle')}</p>
          </div>
          <div className="flex gap-1 text-xs">
            <button
              type="button"
              onClick={selectAll}
              className="rounded px-2 py-1 text-brand-600 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10"
            >
              {tForm('checkAll')}
            </button>
            <button
              type="button"
              onClick={selectNone}
              className="rounded px-2 py-1 text-text-muted hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {tForm('uncheckAll')}
            </button>
          </div>
        </div>

        <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          {MENU_CATALOG.map((m) => (
            <li key={m.key}>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-900/40">
                <input
                  type="checkbox"
                  checked={menuKeys.has(m.key)}
                  onChange={() => toggleMenu(m.key)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="flex-1 capitalize">{m.key}</span>
                <code className="text-2xs text-text-muted">{m.href}</code>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <footer className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            {tCommon('cancel')}
          </Button>
        )}
        <Button type="submit" loading={submitting}>
          {isEdit ? tCommon('save') : tCommon('create')}
        </Button>
      </footer>
    </form>
  );
}

/**
 * Tenta traduzir o nome do role (admin/operator/viewer/superadmin). Se vier
 * um role custom criado pelo tenant que não existe no dict, devolve o nome
 * original — assim a UI nunca quebra.
 */
function translateRoleName(
  t: (key: 'admin' | 'operator' | 'viewer' | 'superadmin') => string,
  roleName: string,
): string {
  if (
    roleName === 'admin' ||
    roleName === 'operator' ||
    roleName === 'viewer' ||
    roleName === 'superadmin'
  ) {
    return t(roleName);
  }
  return roleName;
}
