'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
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
import { FieldHelp, Input, Label } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/Modal';
import { PageLoader } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import { hasPermission } from '@/lib/session';
import { useTenantConfig } from '@/lib/tenant-config';
import {
  locationsApi,
  type CityResponse,
  type IbgeMunicipalityResponse,
} from '@/lib/locations-api';

import { CityDetailPanel, formatCep } from './CityDetailPanel';

function errMsg(e: unknown, t: (key: string) => string): string {
  return e instanceof ApiError ? e.friendlyMessage : t('errors.unexpected');
}

export default function LocationsSettingsPage() {
  const t = useTranslations('settingsLocations');
  const tCommon = useTranslations('common');
  const { tenant, isLoading: tenantLoading } = useTenantConfig();
  const canManage = hasPermission('locations.manage');

  const { data: cities, isLoading, mutate } = useSWR<CityResponse[]>(
    locationsApi.citiesPath(),
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<CityResponse | null>(null);

  if (tenantLoading) return <PageLoader />;

  // Gate de país: cadastro estruturado é só BR (PY segue endereço livre).
  if (tenant?.country !== 'BR') {
    return (
      <div className="rounded-md border border-border bg-surface p-10 text-center">
        <p className="text-sm text-text-muted">{t('list.brOnly')}</p>
      </div>
    );
  }

  if (isLoading || !cities) return <PageLoader label={t('list.loadingCities')} />;

  const selected = cities.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('list.title')}</h1>
          <p className="text-sm text-text-muted">{t('list.subtitle')}</p>
          <Link
            href="/settings/locations/backfill"
            className="mt-1 inline-block text-sm text-accent hover:underline"
          >
            {t('list.migrateLink')}
          </Link>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setImporting(true)}>
              {t('list.importByCep')}
            </Button>
            <Button onClick={() => setCreating(true)}>{t('list.newCity')}</Button>
          </div>
        )}
      </header>

      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-surface-muted text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <tr>
              <th className="px-3 py-2">{t('list.colCity')}</th>
              <th className="px-3 py-2">{t('list.colUf')}</th>
              <th className="px-3 py-2">{t('list.colIbgeCode')}</th>
              <th className="px-3 py-2">{tCommon('status')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {cities.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-text-muted">
                  {t('list.empty')}
                </td>
              </tr>
            ) : (
              cities.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
                  className={`cursor-pointer hover:bg-surface-hover ${
                    c.id === selectedId ? 'bg-surface-hover' : ''
                  }`}
                >
                  <td className="px-3 py-2 font-medium text-text">{c.name}</td>
                  <td className="px-3 py-2 text-text-muted">{c.uf}</td>
                  <td className="px-3 py-2 font-mono text-xs text-text-muted">{c.ibgeCode}</td>
                  <td className="px-3 py-2">
                    <Badge tone={c.active ? 'success' : 'neutral'}>
                      {c.active ? t('list.active') : t('list.inactive')}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    {canManage && (
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(c)}>
                        {tCommon('delete')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-text-muted">
            {t('list.detailHeading', { city: selected.name, uf: selected.uf })}
          </h2>
          <CityDetailPanel city={selected} canManage={canManage} />
        </div>
      )}

      {creating && (
        <CityFormDialog
          existing={cities}
          onClose={() => setCreating(false)}
          onSaved={async (city) => {
            setCreating(false);
            await mutate();
            setSelectedId(city.id);
          }}
        />
      )}

      {importing && (
        <CepImportDialog
          cities={cities}
          onClose={() => setImporting(false)}
          onImported={async (cityId) => {
            setImporting(false);
            await mutate();
            setSelectedId(cityId);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('list.deleteCityTitle')}
        message={t('list.deleteCityMessage', { name: deleting?.name ?? '' })}
        variant="danger"
        confirmLabel={tCommon('delete')}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await locationsApi.removeCity(deleting.id);
            toast.success(t('list.cityDeleted'));
            if (selectedId === deleting.id) setSelectedId(null);
            setDeleting(null);
            await mutate();
          } catch (e) {
            toast.error(errMsg(e, t));
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nova cidade — autocomplete na referência IBGE
// ---------------------------------------------------------------------------
function CityFormDialog({
  existing,
  onClose,
  onSaved,
}: {
  existing: CityResponse[];
  onClose: () => void;
  onSaved: (city: CityResponse) => void;
}) {
  const t = useTranslations('settingsLocations');
  const tCommon = useTranslations('common');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IbgeMunicipalityResponse[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<IbgeMunicipalityResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function search() {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      setResults(await locationsApi.searchIbge({ q, limit: 20 }));
    } catch (e) {
      toast.error(errMsg(e, t));
    } finally {
      setSearching(false);
    }
  }

  async function submit() {
    if (!picked) return;
    if (existing.some((c) => c.ibgeCode === picked.codigo)) {
      toast.error(t('city.alreadyRegistered'));
      return;
    }
    setSubmitting(true);
    try {
      const city = await locationsApi.createCity({
        ibgeCode: picked.codigo,
        name: picked.nome,
        uf: picked.uf,
        active: true,
      });
      toast.success(t('city.created'));
      onSaved(city);
    } catch (e) {
      toast.error(errMsg(e, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('list.newCity')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <div>
            <Label htmlFor="city-q">{t('city.searchLabel')}</Label>
            <div className="flex gap-2">
              <Input
                id="city-q"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void search();
                  }
                }}
                placeholder={t('city.searchPlaceholder')}
                autoFocus
              />
              <Button type="button" variant="secondary" onClick={() => void search()} loading={searching}>
                {tCommon('search')}
              </Button>
            </div>
            <FieldHelp>{t('city.searchHelp')}</FieldHelp>
          </div>

          {results.length > 0 && (
            <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {results.map((m) => {
                const already = existing.some((c) => c.ibgeCode === m.codigo);
                const isPicked = picked?.codigo === m.codigo;
                return (
                  <li key={m.codigo}>
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => setPicked(m)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-surface-hover disabled:opacity-40 ${
                        isPicked ? 'bg-surface-hover' : ''
                      }`}
                    >
                      <span>
                        {m.nome}/{m.uf}
                      </span>
                      <span className="font-mono text-xs text-text-muted">
                        {already ? t('city.alreadyRegisteredShort') : m.codigo}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {picked && (
            <p className="text-sm">
              {t('city.selected')} <strong>{picked.nome}/{picked.uf}</strong>{' '}
              <span className="font-mono text-xs text-text-muted">IBGE {picked.codigo}</span>
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={!picked} loading={submitting}>
            {t('city.submitRegister')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Importar por CEP (ViaCEP) — cria cidade + bairro + logradouro de uma vez
// ---------------------------------------------------------------------------
function CepImportDialog({
  cities,
  onClose,
  onImported,
}: {
  cities: CityResponse[];
  onClose: () => void;
  onImported: (cityId: string) => void;
}) {
  const t = useTranslations('settingsLocations');
  const tCommon = useTranslations('common');
  const [cep, setCep] = useState('');
  const [looking, setLooking] = useState(false);
  const [importingNow, setImportingNow] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof locationsApi.lookupCep>> | null>(null);

  async function lookup() {
    const digits = cep.replace(/\D/g, '');
    if (digits.length !== 8) {
      toast.error(t('import.cepInvalid'));
      return;
    }
    setLooking(true);
    setResult(null);
    try {
      setResult(await locationsApi.lookupCep(digits));
    } catch (e) {
      toast.error(errMsg(e, t));
    } finally {
      setLooking(false);
    }
  }

  async function doImport() {
    if (!result) return;
    if (!result.ibge || !result.localidade || !result.uf) {
      toast.error(t('import.noCityResolved'));
      return;
    }
    setImportingNow(true);
    try {
      // 1) Cidade (reaproveita se já existir pelo IBGE)
      let city = cities.find((c) => c.ibgeCode === result.ibge);
      if (!city) {
        city = await locationsApi.createCity({
          ibgeCode: result.ibge,
          name: result.localidade,
          uf: result.uf,
          active: true,
        });
      }

      // 2) Bairro (se o ViaCEP trouxe)
      let neighborhoodId: string | null = null;
      if (result.bairro) {
        const nbs = await locationsApi.listNeighborhoods(city.id);
        const found = nbs.find(
          (n) => n.name.toLowerCase() === result.bairro!.toLowerCase(),
        );
        neighborhoodId = found
          ? found.id
          : (await locationsApi.createNeighborhood({ cityId: city.id, name: result.bairro }))
              .id;
      }

      // 3) Logradouro (cidades de CEP único não trazem — fica pro cadastro manual)
      if (result.logradouro) {
        const streets = await locationsApi.listStreets(city.id, { cep: result.cep });
        const exists = streets.some(
          (s) => s.name.toLowerCase() === result.logradouro!.toLowerCase(),
        );
        if (!exists) {
          await locationsApi.createStreet({
            cityId: city.id,
            neighborhoodId,
            name: result.logradouro,
            postalCode: result.cep,
          });
        }
        toast.success(t('import.addressImported'));
      } else {
        toast.info(t('import.singleCepImported'));
      }

      onImported(city.id);
    } catch (e) {
      toast.error(errMsg(e, t));
    } finally {
      setImportingNow(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('list.importByCep')}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <div>
            <Label htmlFor="imp-cep">{t('import.cepLabel')}</Label>
            <div className="flex gap-2">
              <Input
                id="imp-cep"
                value={cep}
                onChange={(e) => setCep(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void lookup();
                  }
                }}
                placeholder="00000-000"
                inputMode="numeric"
                autoFocus
              />
              <Button type="button" variant="secondary" onClick={() => void lookup()} loading={looking}>
                {t('import.lookup')}
              </Button>
            </div>
            <FieldHelp>{t('import.cepHelp')}</FieldHelp>
          </div>

          {result && (
            <dl className="rounded-md border border-border bg-surface-muted p-3 text-sm">
              <Row label={t('import.cepLabel')} value={formatCep(result.cep)} />
              <Row label={t('import.rowCity')} value={result.localidade ? `${result.localidade}/${result.uf ?? ''}` : '—'} />
              <Row label="IBGE" value={result.ibge ?? '—'} mono />
              <Row label={t('import.rowNeighborhood')} value={result.bairro ?? '—'} />
              <Row label={t('import.rowStreet')} value={result.logradouro ?? t('import.streetManualFallback')} />
            </dl>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={importingNow}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" onClick={() => void doImport()} disabled={!result} loading={importingNow}>
            {t('import.submitImport')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <dt className="text-text-muted">{label}</dt>
      <dd className={mono ? 'font-mono text-xs' : ''}>{value}</dd>
    </div>
  );
}
