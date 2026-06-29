'use client';

/**
 * /tr069/profiles — modelos homologados + regras de conformidade.
 *
 * Cada profile casa com devices por (fabricante, modelo, firmware). O
 * reconciliador compara o snapshot do CPE com as regras e remedia (auto-enforce
 * / report-only). Criar aqui leva direto pro editor de regras.
 */
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { notify } from '@/lib/notify';
import { tr069Api, type Tr069ProfileSummary } from '@/lib/provisioning-api';

export default function Tr069ProfilesPage() {
  const t = useTranslations('tr069Profiles');
  const router = useRouter();
  const { data, isLoading, error } = useSWR<Tr069ProfileSummary[]>('tr069/profiles', () =>
    tr069Api.listProfiles(),
  );
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [manufacturer, setManufacturer] = useState('Huawei');
  const [productClass, setProductClass] = useState('');

  async function handleCreate() {
    if (!name.trim() || !manufacturer.trim()) {
      notify.error(t('list.errors.nameManufacturerRequired'));
      return;
    }
    setBusy(true);
    try {
      const p = await tr069Api.createProfile({
        name: name.trim(),
        manufacturer: manufacturer.trim(),
        productClass: productClass.trim() || null,
        rules: [],
      });
      notify.success(t('list.created'));
      router.push(`/tr069/profiles/${p.id}`);
    } catch (e) {
      notify.apiError(e);
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <PageLoader />;
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {t('list.loadError')}
      </div>
    );
  }
  const rows = data ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('list.title')}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('list.subtitle')}</p>
        </div>
        <Button size="sm" onClick={() => setCreating((v) => !v)}>
          <Plus className="mr-1 h-4 w-4" /> {t('list.newProfile')}
        </Button>
      </header>

      {creating && (
        <Card>
          <CardHeader>
            <CardTitle>{t('list.newProfile')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>{t('list.fields.name')}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('list.placeholders.name')}
              />
            </div>
            <div>
              <Label>{t('list.fields.manufacturer')}</Label>
              <Input
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                placeholder="Huawei"
              />
            </div>
            <div>
              <Label>{t('list.fields.modelOptional')}</Label>
              <Input
                value={productClass}
                onChange={(e) => setProductClass(e.target.value)}
                placeholder={t('list.placeholders.model')}
              />
            </div>
            <div className="sm:col-span-3">
              <Button size="sm" loading={busy} onClick={handleCreate}>
                {t('list.createAndEditRules')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          {t('list.empty')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t('list.columns.name')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('list.columns.manufacturer')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('list.columns.model')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('list.columns.version')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('list.columns.rules')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('list.columns.devices')}</th>
                <th className="px-3 py-2 text-left font-medium">{t('list.columns.active')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                  <td className="px-3 py-2">
                    <Link
                      href={`/tr069/profiles/${p.id}`}
                      className="font-medium text-sky-600 hover:underline dark:text-sky-400"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{p.manufacturer}</td>
                  <td className="px-3 py-2">{p.productClass ?? t('list.allModels')}</td>
                  <td className="px-3 py-2 text-right text-xs text-slate-500">v{p.version}</td>
                  <td className="px-3 py-2 text-right">{p.ruleCount}</td>
                  <td className="px-3 py-2 text-right">{p.deviceCount}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        p.active
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {p.active ? t('list.statusActive') : t('list.statusInactive')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
