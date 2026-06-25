'use client';

import { useEffect, useState } from 'react';
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
import { FieldError, FieldHelp, Input, Label, Select, Textarea } from '@/components/ui/Input';
import { toast } from '@/components/ui/sonner';
import { ApiError } from '@/lib/api';
import {
  locationsApi,
  type CityResponse,
  type NeighborhoodResponse,
  type StreetResponse,
} from '@/lib/locations-api';

/** Valor controlado do endereço de instalação. */
export interface AddressValue {
  /** FK do logradouro (BR estruturado). Null = texto livre (PY/legado). */
  streetId: string | null;
  addressNumber: string;
  addressComplement: string;
  /** Denormalizado (BR) ou texto livre (PY). É o que vai pro contrato. */
  installationAddress: string;
}

export const EMPTY_ADDRESS: AddressValue = {
  streetId: null,
  addressNumber: '',
  addressComplement: '',
  installationAddress: '',
};

const STREET_KINDS = ['Rua', 'Avenida', 'Travessa', 'Rodovia', 'Estrada', 'Alameda', 'Praça', 'Outro'];

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.friendlyMessage : 'Erro inesperado';
}

function fmtCep(cep: string | null): string {
  if (!cep) return '';
  return cep.replace(/^(\d{5})(\d{3})$/, '$1-$2');
}

/** String denormalizada — espelha buildInstallationAddress do backend. */
export function buildPreview(
  street: StreetResponse,
  city: CityResponse | undefined,
  neighborhood: NeighborhoodResponse | undefined,
  number: string,
  complement: string,
): string {
  const logradouro = [street.kind, street.name].filter(Boolean).join(' ');
  const head = number.trim() ? `${logradouro}, ${number.trim()}` : logradouro;
  const cep = street.postalCode ? `CEP ${fmtCep(street.postalCode)}` : null;
  return [
    head,
    complement.trim() || null,
    neighborhood?.name ?? null,
    city ? `${city.name}/${city.uf}` : null,
    cep,
  ]
    .filter(Boolean)
    .join(' - ');
}

export function AddressPicker({
  country,
  value,
  onChange,
  error,
  freeTextLabel,
  freeTextPlaceholder,
  disabled,
  initialCep,
}: {
  country: string | null | undefined;
  value: AddressValue;
  onChange: (v: AddressValue) => void;
  error?: string;
  /** Rótulo/placeholder do textarea livre (PY) — localizados pelo pai. */
  freeTextLabel: string;
  freeTextPlaceholder?: string;
  disabled?: boolean;
  /** CEP sugerido (backfill) — pré-preenche o diálogo de cadastrar logradouro. */
  initialCep?: string;
}) {
  const isBr = country === 'BR';

  // ---- PY / legado: texto livre, igual ao comportamento histórico ----
  if (!isBr) {
    return (
      <div>
        <Label htmlFor="addr-free" required>
          {freeTextLabel}
        </Label>
        <Textarea
          id="addr-free"
          value={value.installationAddress}
          onChange={(e) =>
            onChange({ ...EMPTY_ADDRESS, installationAddress: e.target.value })
          }
          placeholder={freeTextPlaceholder}
          rows={2}
          disabled={disabled}
        />
        <FieldError>{error}</FieldError>
      </div>
    );
  }

  return (
    <BrAddressPicker
      value={value}
      onChange={onChange}
      error={error}
      disabled={disabled}
      initialCep={initialCep}
    />
  );
}

function BrAddressPicker({
  value,
  onChange,
  error,
  disabled,
  initialCep,
}: {
  value: AddressValue;
  onChange: (v: AddressValue) => void;
  error?: string;
  disabled?: boolean;
  initialCep?: string;
}) {
  const [cityId, setCityId] = useState('');
  const [neighborhoodId, setNeighborhoodId] = useState('');
  const [streetQuery, setStreetQuery] = useState('');
  const [pickedStreet, setPickedStreet] = useState<StreetResponse | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: cities } = useSWR<CityResponse[]>(locationsApi.citiesPath({ active: true }));
  const { data: neighborhoods } = useSWR<NeighborhoodResponse[]>(
    cityId ? locationsApi.neighborhoodsPath(cityId) : null,
  );
  const { data: streets, mutate: mutateStreets } = useSWR<StreetResponse[]>(
    cityId ? locationsApi.streetsPath(cityId, { q: streetQuery.trim() || undefined }) : null,
  );

  const selectedCity = cities?.find((c) => c.id === cityId);

  // Modo edição: chega com streetId mas sem cityId — resolve a cidade/bairro.
  useEffect(() => {
    if (!value.streetId || pickedStreet) return;
    locationsApi
      .getStreet(value.streetId)
      .then((s) => {
        setPickedStreet(s);
        setCityId(s.cityId);
        if (s.neighborhoodId) setNeighborhoodId(s.neighborhoodId);
      })
      .catch(() => {
        /* rua sumiu — operador re-seleciona */
      });
  }, [value.streetId, pickedStreet]);

  const nbOf = (id: string | null) => neighborhoods?.find((n) => n.id === id);

  function recompute(street: StreetResponse | null, number: string, complement: string) {
    const preview = street
      ? buildPreview(street, selectedCity, nbOf(street.neighborhoodId), number, complement)
      : '';
    onChange({
      streetId: street?.id ?? null,
      addressNumber: number,
      addressComplement: complement,
      installationAddress: preview,
    });
  }

  function pickStreet(id: string) {
    const s = streets?.find((x) => x.id === id) ?? null;
    setPickedStreet(s);
    if (s?.neighborhoodId) setNeighborhoodId(s.neighborhoodId);
    recompute(s, value.addressNumber, value.addressComplement);
  }

  function changeCity(id: string) {
    setCityId(id);
    setNeighborhoodId('');
    setStreetQuery('');
    setPickedStreet(null);
    onChange({ ...EMPTY_ADDRESS });
  }

  const visibleStreets = (streets ?? []).filter(
    (s) => !neighborhoodId || s.neighborhoodId === neighborhoodId,
  );

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <p className="text-sm font-semibold">Endereço de instalação</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="addr-city" required>
            Cidade
          </Label>
          <Select
            id="addr-city"
            value={cityId}
            onChange={(e) => changeCity(e.target.value)}
            disabled={disabled}
          >
            <option value="">Selecione…</option>
            {(cities ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}/{c.uf}
              </option>
            ))}
          </Select>
          {(!cities || cities.length === 0) && (
            <FieldHelp>
              Nenhuma cidade cadastrada — cadastre em Configurações → Endereços.
            </FieldHelp>
          )}
        </div>
        <div>
          <Label htmlFor="addr-nb">Bairro (filtro)</Label>
          <Select
            id="addr-nb"
            value={neighborhoodId}
            onChange={(e) => setNeighborhoodId(e.target.value)}
            disabled={disabled || !cityId}
          >
            <option value="">Todos</option>
            {(neighborhoods ?? []).map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {cityId && (
        <div>
          <Label htmlFor="addr-street" required>
            Logradouro
          </Label>
          <Input
            placeholder="Buscar rua…"
            value={streetQuery}
            onChange={(e) => setStreetQuery(e.target.value)}
            disabled={disabled}
            className="mb-1.5"
          />
          <Select
            id="addr-street"
            value={value.streetId ?? ''}
            onChange={(e) => pickStreet(e.target.value)}
            disabled={disabled}
          >
            <option value="">Selecione o logradouro…</option>
            {/* garante que a rua escolhida apareça mesmo fora do filtro/busca */}
            {pickedStreet && !visibleStreets.some((s) => s.id === pickedStreet.id) && (
              <option value={pickedStreet.id}>
                {[pickedStreet.kind, pickedStreet.name].filter(Boolean).join(' ')}
                {pickedStreet.postalCode ? ` · ${fmtCep(pickedStreet.postalCode)}` : ''}
              </option>
            )}
            {visibleStreets.map((s) => (
              <option key={s.id} value={s.id}>
                {[s.kind, s.name].filter(Boolean).join(' ')}
                {s.postalCode ? ` · ${fmtCep(s.postalCode)}` : ''}
              </option>
            ))}
          </Select>
          <button
            type="button"
            className="mt-1 text-xs text-accent hover:underline disabled:opacity-50"
            onClick={() => setCreating(true)}
            disabled={disabled}
          >
            Não encontrou? Cadastrar logradouro
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="addr-number" required>
            Número
          </Label>
          <Input
            id="addr-number"
            value={value.addressNumber}
            onChange={(e) => recompute(pickedStreet, e.target.value, value.addressComplement)}
            placeholder="123 ou S/N"
            disabled={disabled || !value.streetId}
          />
        </div>
        <div>
          <Label htmlFor="addr-complement">Complemento</Label>
          <Input
            id="addr-complement"
            value={value.addressComplement}
            onChange={(e) => recompute(pickedStreet, value.addressNumber, e.target.value)}
            placeholder="Apto 4, Bloco B…"
            disabled={disabled || !value.streetId}
          />
        </div>
      </div>

      {value.installationAddress && (
        <p className="rounded bg-surface-muted px-2 py-1.5 text-xs text-text-muted">
          {value.installationAddress}
        </p>
      )}
      <FieldError>{error}</FieldError>

      {creating && cityId && (
        <CreateStreetDialog
          cityId={cityId}
          neighborhoods={neighborhoods ?? []}
          initialCep={initialCep}
          onClose={() => setCreating(false)}
          onCreated={async (street) => {
            setCreating(false);
            await mutateStreets();
            setPickedStreet(street);
            if (street.neighborhoodId) setNeighborhoodId(street.neighborhoodId);
            recompute(street, value.addressNumber, value.addressComplement);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Escape: cadastrar logradouro na hora (ViaCEP ou manual)
// ---------------------------------------------------------------------------
function CreateStreetDialog({
  cityId,
  neighborhoods,
  initialCep,
  onClose,
  onCreated,
}: {
  cityId: string;
  neighborhoods: NeighborhoodResponse[];
  initialCep?: string;
  onClose: () => void;
  onCreated: (street: StreetResponse) => void;
}) {
  const [cep, setCep] = useState(initialCep ?? '');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [neighborhoodId, setNeighborhoodId] = useState('');
  const [bairroFromCep, setBairroFromCep] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);

  async function lookup() {
    const digits = cep.replace(/\D/g, '');
    if (digits.length !== 8) {
      toast.error('CEP deve ter 8 dígitos');
      return;
    }
    setLooking(true);
    try {
      const r = await locationsApi.lookupCep(digits);
      if (r.logradouro) setName(r.logradouro);
      setBairroFromCep(r.bairro);
      const match = neighborhoods.find(
        (n) => r.bairro && n.name.toLowerCase() === r.bairro.toLowerCase(),
      );
      if (match) setNeighborhoodId(match.id);
      if (!r.logradouro) toast.info('CEP único: informe o nome da rua manualmente');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLooking(false);
    }
  }

  async function save() {
    if (!name.trim()) {
      toast.error('Informe o nome do logradouro');
      return;
    }
    setSaving(true);
    try {
      // Bairro novo do ViaCEP que ainda não existe → cria antes.
      let nbId: string | null = neighborhoodId || null;
      if (!nbId && bairroFromCep) {
        const created = await locationsApi.createNeighborhood({ cityId, name: bairroFromCep });
        nbId = created.id;
      }
      const street = await locationsApi.createStreet({
        cityId,
        neighborhoodId: nbId,
        name: name.trim(),
        kind: kind || null,
        postalCode: cep.replace(/\D/g, '') || null,
      });
      toast.success('Logradouro cadastrado');
      onCreated(street);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Cadastrar logradouro</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <div>
            <Label htmlFor="cs-cep">CEP</Label>
            <div className="flex gap-2">
              <Input
                id="cs-cep"
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
                Buscar CEP
              </Button>
            </div>
            <FieldHelp>Preenche a rua pelo ViaCEP. Em CEP único, digite a rua à mão.</FieldHelp>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="cs-kind">Tipo</Label>
              <Select id="cs-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">—</option>
                {STREET_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-2">
              <Label htmlFor="cs-name" required>
                Nome
              </Label>
              <Input id="cs-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="cs-nb">Bairro</Label>
            <Select id="cs-nb" value={neighborhoodId} onChange={(e) => setNeighborhoodId(e.target.value)}>
              <option value="">{bairroFromCep ? `${bairroFromCep} (novo, do CEP)` : '—'}</option>
              {neighborhoods.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </Select>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void save()} loading={saving}>
            Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
