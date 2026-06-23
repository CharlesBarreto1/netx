'use client';

/**
 * /alarms/config — limiares de correlação por tenant (AlarmPolicy).
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import { alarmsApi, type UpdateAlarmPolicyInput } from '@/lib/alarms-api';

const NUM_FIELDS: { key: keyof UpdateAlarmPolicyInput; label: string; hint?: string }[] = [
  { key: 'ctoPctThreshold', label: 'CTO — % de clientes p/ alarmar' },
  { key: 'ctoMinCount', label: 'CTO — mínimo de clientes' },
  { key: 'ponPctThreshold', label: 'PON — % p/ alarmar' },
  { key: 'ponMinCount', label: 'PON — mínimo' },
  { key: 'cablePctThreshold', label: 'Cabo — % p/ alarmar' },
  { key: 'cableMinCount', label: 'Cabo — mínimo' },
  { key: 'oltMinCount', label: 'OLT — mínimo de clientes' },
  { key: 'geoMinCount', label: 'Bairro (geo) — mínimo' },
  { key: 'debounceSeconds', label: 'Janela de agregação (s)' },
  { key: 'rxLowDbm', label: 'Sinal ruim abaixo de (dBm)' },
  { key: 'rxHighDbm', label: 'Sinal saturado acima de (dBm)' },
];

export default function AlarmConfigPage() {
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
      toast.success('Limiares salvos');
      await mutate();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.friendlyMessage : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <header>
        <Link href="/alarms" className="text-sm text-blue-600 hover:underline">
          ← Voltar aos alarmes
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Limiares de alarme</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Alarma um escopo quando ≥ % E ≥ mínimo de clientes caem juntos.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {NUM_FIELDS.map((f) => (
          <div key={f.key}>
            <Label htmlFor={f.key}>{f.label}</Label>
            <Input
              id={f.key}
              type="number"
              disabled={!canAdmin}
              value={(form[f.key] as number | undefined) ?? ''}
              onChange={(e) =>
                setForm((s) => ({ ...s, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) }))
              }
            />
          </div>
        ))}
      </div>

      {canAdmin && (
        <div className="flex justify-end">
          <Button disabled={saving} onClick={save}>
            {saving ? 'Salvando…' : 'Salvar limiares'}
          </Button>
        </div>
      )}
    </div>
  );
}
