'use client';

/**
 * NewUserClient — conteúdo client da rota `/settings/users/new`.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Padrão server-wrapper: ver `page.tsx`.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { UserForm } from '@/components/users/UserForm';
import { toast } from '@/components/ui/sonner';

export default function NewUserClient() {
  const router = useRouter();
  const tCommon = useTranslations('common');
  const tUsers = useTranslations('users');
  const tForm = useTranslations('users.form');

  return (
    <div className="space-y-5">
      <header>
        <nav className="text-xs text-slate-500 dark:text-slate-400">
          <Link href="/settings/users" className="hover:underline">
            {tUsers('title')}
          </Link>{' '}
          › {tCommon('new')}
        </nav>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{tUsers('new')}</h1>
        <p className="text-sm text-text-muted">{tForm('newSubtitle')}</p>
      </header>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <UserForm
          mode="create"
          onSuccess={(u) => {
            toast.success(tCommon('success'));
            router.replace(`/settings/users/${u.id}`);
          }}
          onCancel={() => router.push('/settings/users')}
        />
      </div>
    </div>
  );
}
