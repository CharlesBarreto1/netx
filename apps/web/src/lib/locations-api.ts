import { api } from './api';
import type {
  AddressBackfillItem,
  CepLookupResponse,
  CityResponse,
  CreateCityRequest,
  CreateNeighborhoodRequest,
  CreateStreetRequest,
  IbgeMunicipalityResponse,
  NeighborhoodResponse,
  Paginated,
  StreetResponse,
  UpdateCityRequest,
  UpdateNeighborhoodRequest,
  UpdateStreetRequest,
} from '@netx/shared';

export type {
  AddressBackfillItem,
  CepLookupResponse,
  CityResponse,
  IbgeMunicipalityResponse,
  NeighborhoodResponse,
  StreetResponse,
} from '@netx/shared';

function qs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join('&');
}

/**
 * Cadastro-mestre de endereços (BR): cidades (com IBGE), bairros, logradouros
 * (com CEP) + helpers de geocodificação (busca IBGE e lookup ViaCEP).
 */
export const locationsApi = {
  // ---- Cidades ----
  citiesPath: (q?: { q?: string; uf?: string; active?: boolean }) =>
    `/v1/locations/cities${qs({
      q: q?.q,
      uf: q?.uf,
      active: q?.active == null ? undefined : String(q.active),
    })}`,
  listCities(q?: { q?: string; uf?: string; active?: boolean }) {
    return api.get<CityResponse[]>(this.citiesPath(q));
  },
  createCity(input: CreateCityRequest) {
    return api.post<CityResponse>('/v1/locations/cities', input);
  },
  updateCity(id: string, input: UpdateCityRequest) {
    return api.patch<CityResponse>(`/v1/locations/cities/${id}`, input);
  },
  removeCity(id: string) {
    return api.delete<void>(`/v1/locations/cities/${id}`);
  },

  // ---- Bairros ----
  neighborhoodsPath: (cityId: string) =>
    `/v1/locations/neighborhoods${qs({ cityId })}`,
  listNeighborhoods(cityId: string) {
    return api.get<NeighborhoodResponse[]>(this.neighborhoodsPath(cityId));
  },
  createNeighborhood(input: CreateNeighborhoodRequest) {
    return api.post<NeighborhoodResponse>('/v1/locations/neighborhoods', input);
  },
  updateNeighborhood(id: string, input: UpdateNeighborhoodRequest) {
    return api.patch<NeighborhoodResponse>(
      `/v1/locations/neighborhoods/${id}`,
      input,
    );
  },
  removeNeighborhood(id: string) {
    return api.delete<void>(`/v1/locations/neighborhoods/${id}`);
  },

  // ---- Logradouros ----
  streetsPath: (cityId: string, opts?: { q?: string; cep?: string }) =>
    `/v1/locations/streets${qs({ cityId, q: opts?.q, cep: opts?.cep })}`,
  listStreets(cityId: string, opts?: { q?: string; cep?: string }) {
    return api.get<StreetResponse[]>(this.streetsPath(cityId, opts));
  },
  getStreet(id: string) {
    return api.get<StreetResponse>(`/v1/locations/streets/${id}`);
  },
  createStreet(input: CreateStreetRequest) {
    return api.post<StreetResponse>('/v1/locations/streets', input);
  },
  updateStreet(id: string, input: UpdateStreetRequest) {
    return api.patch<StreetResponse>(`/v1/locations/streets/${id}`, input);
  },
  removeStreet(id: string) {
    return api.delete<void>(`/v1/locations/streets/${id}`);
  },

  // ---- Geo ----
  searchIbge(q: { q?: string; uf?: string; limit?: number }) {
    return api.get<IbgeMunicipalityResponse[]>(
      `/v1/locations/geo/ibge${qs({
        q: q.q,
        uf: q.uf,
        limit: q.limit == null ? undefined : String(q.limit),
      })}`,
    );
  },
  lookupCep(cep: string) {
    const digits = cep.replace(/\D/g, '');
    return api.get<CepLookupResponse>(`/v1/locations/geo/cep/${digits}`);
  },

  // ---- Backfill (migração de contratos BR em texto livre) ----
  backfillPath: (page = 1, pageSize = 20) =>
    `/v1/locations/backfill/contracts${qs({ page: String(page), pageSize: String(pageSize) })}`,
  backfillPending(page = 1, pageSize = 20) {
    return api.get<Paginated<AddressBackfillItem>>(this.backfillPath(page, pageSize));
  },
};
