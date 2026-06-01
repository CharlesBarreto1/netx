'use client';

import dynamic from 'next/dynamic';
import { Plus, Server } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import type { LatLng } from '@/components/mapping/LocationPicker';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { FieldHelp, Input, Label, Textarea } from '@/components/ui/Input';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  networkApi,
  type NetworkPop,
  type CreatePopInput,
} from '@/lib/network-api';
import { hasPermission } from '@/lib/session';

// LocationPicker (Leaflet) só client-side — SSR quebra (depende de window).
const LocationPicker = dynamic(
  () =>
    import('@/components/mapping/LocationPicker').then((m) => m.LocationPicker),
  {
    ssr: false,
    loading: () => (
      <div className="h-[320px] animate-pulse rounded-md bg-surface-muted" />
    ),
  },
);

export default function PopsPage() {
  const t = useTranslations('network.pops');
  const tc = useTranslations('common');
  const canWrite = hasPermission('network.write');
  const canDelete = hasPermission('network.delete');

  const { data, isLoading, mutate } = useSWR<NetworkPop[]>(
    networkApi.popsListPath(),
  );
  const [editing, setEditing] = useState<NetworkPop | 'new' | null>(null);
  const [deleting, setDeleting] = useState<NetworkPop | null>(null);

  if (isLoading && !data) return <PageLoader />;
  const pops = data ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-text-muted">{t('subtitle')}</p>
        </div>
        {canWrite && (
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-3.5 w-3.5" />
            {t('new')}
          </Button>
        )}
      </header>

      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              <th className="px-3 py-2">{tc('name')}</th>
              <th className="px-3 py-2">{tc('code')}</th>
              <th className="px-3 py-2">{t('city')}</th>
              <th className="px-3 py-2 text-right">{t('equipment')}</th>
              <th className="px-3 py-2">{tc('status')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pops.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-text-muted">
                  {t('empty')}
                </td>
              </tr>
            ) : (
              pops.map((p) => (
                <tr key={p.id} className="hover:bg-surface-hover">
                  <td className="px-3 py-2 font-medium">
                    <Server className="mr-1 inline h-3.5 w-3.5 text-text-muted" />
                    {p.name}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{p.code ?? '—'}</td>
                  <td className="px-3 py-2 text-text-muted">
                    {p.city ?? '—'}{p.state ? ` / ${p.state}` : ''}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {p._count?.equipment ?? 0}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={p.isActive ? 'success' : 'neutral'}>
                      {p.isActive ? t('active') : t('inactive')}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canWrite && (
                      <Button size="xs" variant="ghost" onClick={() => setEditing(p)}>
                        {tc('edit')}
                      </Button>
                    )}
                    {canDelete && (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setDeleting(p)}
                      >
                        {tc('delete')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <PopFormDialog
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void mutate();
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await networkApi.deletePop(deleting.id);
            toast.success(t('toast.deleted'));
            setDeleting(null);
            await mutate();
          } catch (err) {
            toast.error(
              err instanceof ApiError ? err.friendlyMessage : tc('error'),
            );
          }
        }}
        title={t('deleteTitle')}
        message={t('deleteMessage', { name: deleting?.name ?? '' })}
        confirmLabel={tc('delete')}
        variant="danger"
      />
    </div>
  );
}

function PopFormDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: NetworkPop | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('network.pops');
  const tc = useTranslations('common');
  const isNew = !initial;
  const [form, setForm] = useState<CreatePopInput>({
    name: initial?.name ?? '',
    code: initial?.code ?? '',
    city: initial?.city ?? '',
    state: initial?.state ?? '',
    address: initial?.address ?? '',
    notes: initial?.notes ?? '',
    isActive: initial?.isActive ?? true,
  });
  // Geolocalização do POP (módulo Rede). null = sem coord ainda.
  const [location, setLocation] = useState<LatLng | null>(
    initial?.latitude != null && initial?.longitude != null
      ? { latitude: initial.latitude, longitude: initial.longitude }
      : null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setError(t('errors.nameRequired'));
    setSubmitting(true);
    try {
      const payload: CreatePopInput = {
        ...form,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
      };
      if (isNew) {
        await networkApi.createPop(payload);
      } else {
        await networkApi.updatePop(initial!.id, payload);
      }
      toast.success(isNew ? t('toast.created') : t('toast.updated'));
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.friendlyMessage : tc('error'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? t('new') : t('editTitle', { name: initial!.name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {tc('cancel')}
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {tc('save')}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label required>{tc('name')}</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder={t('namePlaceholder')}
              autoFocus
            />
          </div>
          <div>
            <Label>{tc('code')}</Label>
            <Input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="POP-001"
            />
          </div>
          <div>
            <Label>{t('city')}</Label>
            <Input
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </div>
          <div>
            <Label>{t('state')}</Label>
            <Input
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
            />
          </div>
        </div>
        <div>
          <Label>{t('address')}</Label>
          <Input
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </div>
        <div>
          <Label>{t('mapLocation')}</Label>
          <FieldHelp>{t('mapHelp')}</FieldHelp>
          <LocationPicker value={location} onChange={setLocation} />
        </div>
        <div>
          <Label>{tc('notes')}</Label>
          <Textarea
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive ?? true}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            {t('active')}
          </label>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}
