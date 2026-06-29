'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldHelp, Input, Label, Select } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/Modal';
import { InlineLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  locationsApi,
  type CityResponse,
  type NeighborhoodResponse,
  type StreetResponse,
} from '@/lib/locations-api';

const STREET_KINDS = ['Rua', 'Avenida', 'Travessa', 'Rodovia', 'Estrada', 'Alameda', 'Praça', 'Outro'];

function errMsg(e: unknown, t: (key: string) => string): string {
  return e instanceof ApiError ? e.friendlyMessage : t('errors.unexpected');
}

export function CityDetailPanel({
  city,
  canManage,
}: {
  city: CityResponse;
  canManage: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <NeighborhoodsSection cityId={city.id} canManage={canManage} />
      <StreetsSection cityId={city.id} canManage={canManage} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bairros
// ---------------------------------------------------------------------------
function NeighborhoodsSection({ cityId, canManage }: { cityId: string; canManage: boolean }) {
  const t = useTranslations('settingsLocations');
  const tCommon = useTranslations('common');
  const { data, isLoading, mutate } = useSWR<NeighborhoodResponse[]>(
    locationsApi.neighborhoodsPath(cityId),
  );
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<NeighborhoodResponse | null>(null);
  const [deleting, setDeleting] = useState<NeighborhoodResponse | null>(null);

  return (
    <section className="rounded-md border border-border bg-surface">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-sm font-semibold">{t('neighborhood.sectionTitle')}</h3>
        {canManage && (
          <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
            {t('neighborhood.add')}
          </Button>
        )}
      </header>

      {isLoading ? (
        <div className="p-4">
          <InlineLoader label={t('neighborhood.loading')} />
        </div>
      ) : !data || data.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-text-muted">{t('neighborhood.empty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {data.map((n) => (
            <li key={n.id} className="flex items-center justify-between px-3 py-2 text-sm hover:bg-surface-hover">
              <span className="font-medium text-text">{n.name}</span>
              {canManage && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(n)}>
                    {tCommon('edit')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(n)}>
                    {tCommon('delete')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <NeighborhoodFormDialog
          cityId={cityId}
          initial={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await mutate();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('neighborhood.deleteTitle')}
        message={t('neighborhood.deleteMessage', { name: deleting?.name ?? '' })}
        variant="danger"
        confirmLabel={tCommon('delete')}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await locationsApi.removeNeighborhood(deleting.id);
            toast.success(t('neighborhood.deleted'));
            setDeleting(null);
            await mutate();
          } catch (e) {
            toast.error(errMsg(e, t));
          }
        }}
      />
    </section>
  );
}

function NeighborhoodFormDialog({
  cityId,
  initial,
  onClose,
  onSaved,
}: {
  cityId: string;
  initial?: NeighborhoodResponse;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('settingsLocations');
  const tCommon = useTranslations('common');
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      if (isEdit && initial) {
        await locationsApi.updateNeighborhood(initial.id, { name: name.trim() });
      } else {
        await locationsApi.createNeighborhood({ cityId, name: name.trim() });
      }
      toast.success(t('neighborhood.saved'));
      onSaved();
    } catch (e) {
      toast.error(errMsg(e, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? t('neighborhood.editTitle') : t('neighborhood.newTitle')}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Label htmlFor="nb-name" required>
              {tCommon('name')}
            </Label>
            <Input id="nb-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" loading={submitting}>
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Logradouros
// ---------------------------------------------------------------------------
function StreetsSection({ cityId, canManage }: { cityId: string; canManage: boolean }) {
  const t = useTranslations('settingsLocations');
  const tCommon = useTranslations('common');
  const [search, setSearch] = useState('');
  const { data, isLoading, mutate } = useSWR<StreetResponse[]>(
    locationsApi.streetsPath(cityId, { q: search.trim() || undefined }),
  );
  const { data: neighborhoods } = useSWR<NeighborhoodResponse[]>(
    locationsApi.neighborhoodsPath(cityId),
  );
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StreetResponse | null>(null);
  const [deleting, setDeleting] = useState<StreetResponse | null>(null);

  const nbName = (id: string | null) =>
    id ? (neighborhoods?.find((n) => n.id === id)?.name ?? '—') : '—';

  return (
    <section className="rounded-md border border-border bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h3 className="text-sm font-semibold">{t('street.sectionTitle')}</h3>
        {canManage && (
          <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
            {t('street.add')}
          </Button>
        )}
      </header>

      <div className="px-3 py-2">
        <Input
          placeholder={t('street.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="p-4">
          <InlineLoader label={t('street.loading')} />
        </div>
      ) : !data || data.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-text-muted">
          {search ? t('street.emptySearch') : t('street.empty')}
        </p>
      ) : (
        <ul className="max-h-96 divide-y divide-border overflow-y-auto">
          {data.map((s) => (
            <li key={s.id} className="flex items-center justify-between px-3 py-2 text-sm hover:bg-surface-hover">
              <div className="min-w-0">
                <p className="truncate font-medium text-text">
                  {s.kind ? `${STREET_KINDS.includes(s.kind) ? t(`street.kind.${s.kind}`) : s.kind} ` : ''}
                  {s.name}
                </p>
                <p className="text-xs text-text-muted">
                  {s.postalCode ? formatCep(s.postalCode) : t('street.noCep')} · {nbName(s.neighborhoodId)}
                </p>
              </div>
              {canManage && (
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                    {tCommon('edit')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(s)}>
                    {tCommon('delete')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <StreetFormDialog
          cityId={cityId}
          neighborhoods={neighborhoods ?? []}
          initial={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await mutate();
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('street.deleteTitle')}
        message={t('street.deleteMessage', { name: deleting?.name ?? '' })}
        variant="danger"
        confirmLabel={tCommon('delete')}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await locationsApi.removeStreet(deleting.id);
            toast.success(t('street.deleted'));
            setDeleting(null);
            await mutate();
          } catch (e) {
            toast.error(errMsg(e, t));
          }
        }}
      />
    </section>
  );
}

function StreetFormDialog({
  cityId,
  neighborhoods,
  initial,
  onClose,
  onSaved,
}: {
  cityId: string;
  neighborhoods: NeighborhoodResponse[];
  initial?: StreetResponse;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('settingsLocations');
  const tCommon = useTranslations('common');
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState(initial?.kind ?? '');
  const [cep, setCep] = useState(initial?.postalCode ?? '');
  const [neighborhoodId, setNeighborhoodId] = useState(initial?.neighborhoodId ?? '');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    const payload = {
      name: name.trim(),
      kind: kind || null,
      postalCode: cep.replace(/\D/g, '') || null,
      neighborhoodId: neighborhoodId || null,
    };
    try {
      if (isEdit && initial) {
        await locationsApi.updateStreet(initial.id, payload);
      } else {
        await locationsApi.createStreet({ cityId, ...payload });
      }
      toast.success(t('street.saved'));
      onSaved();
    } catch (e) {
      toast.error(errMsg(e, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? t('street.editTitle') : t('street.newTitle')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="st-kind">{tCommon('type')}</Label>
                <Select id="st-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="">—</option>
                  {STREET_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`street.kind.${k}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-2">
                <Label htmlFor="st-name" required>
                  {tCommon('name')}
                </Label>
                <Input id="st-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="st-cep">{t('import.cepLabel')}</Label>
                <Input
                  id="st-cep"
                  value={cep}
                  onChange={(e) => setCep(e.target.value)}
                  placeholder="00000-000"
                  inputMode="numeric"
                />
                <FieldHelp>{t('street.cepHelp')}</FieldHelp>
              </div>
              <div>
                <Label htmlFor="st-nb">{t('neighborhood.label')}</Label>
                <Select
                  id="st-nb"
                  value={neighborhoodId}
                  onChange={(e) => setNeighborhoodId(e.target.value)}
                >
                  <option value="">—</option>
                  {neighborhoods.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" loading={submitting}>
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function formatCep(cep: string): string {
  const d = cep.replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : cep;
}
