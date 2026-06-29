'use client';

/**
 * /alarms/config — limiares de correlação por tenant (AlarmPolicy).
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import { alarmsApi, type UpdateAlarmPolicyInput } from '@/lib/alarms-api';

const NUM_FIELD_KEYS: (keyof UpdateAlarmPolicyInput)[] = [
  'ctoPctThreshold',
  'ctoMinCount',
  'ponPctThreshold',
  'ponMinCount',
  'cablePctThreshold',
  'cableMinCount',
  'oltMinCount',
  'geoMinCount',
  'debounceSeconds',
  'rxLowDbm',
  'rxHighDbm',
];

export default function AlarmConfigPage() {
  const t = useTranslations('alarms');
  const tCommon = useTranslations('common');
  const canAdmin = hasPermission('olts.admin');
  const { data, isLoading, mutate } = useSWR('alarm-policy', () => alarmsApi.getPolicy());
  const [form, setForm] = useState<UpdateAlarmPolicyInput>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      const { updatedAt: _updatedAt, severityMap: _sev, ...rest } = data;
      setForm(rest);
    }
  }, [data]);

  if (isLoading) return <PageLoader />;

  async function save() {
    setSaving(true);
    try {
      await alarmsApi.updatePolicy(form);
      toast.success(t('config.toast.saved'));
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : t('config.toast.saveError'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <header>
        <Link href="/alarms" className="text-sm text-blue-600 hover:underline">
          {t('config.back')}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{t('config.title')}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('config.subtitle')}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {NUM_FIELD_KEYS.map((key) => (
          <div key={key}>
            <Label htmlFor={key}>{t(`config.fields.${key}`)}</Label>
            <Input
              id={key}
              type="number"
              disabled={!canAdmin}
              value={(form[key] as number | undefined) ?? ''}
              onChange={(e) =>
                setForm((s) => ({ ...s, [key]: e.target.value === '' ? undefined : Number(e.target.value) }))
              }
            />
          </div>
        ))}
      </div>

      {canAdmin && (
        <div className="flex justify-end">
          <Button disabled={saving} onClick={save}>
            {saving ? tCommon('saving') : t('config.saveButton')}
          </Button>
        </div>
      )}
    </div>
  );
}
