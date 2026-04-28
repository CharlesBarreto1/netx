'use client';

import { createContext, useContext, useMemo, useCallback } from 'react';
import useSWR, { useSWRConfig } from 'swr';

import {
  getCountryPreset,
  resolveEffectiveLocale,
  type CountryPreset,
  type CustomerKindForDoc,
} from '@netx/shared';

import { resolveAppLocale, type AppLocale } from '@/i18n';
import { api } from './api';

/**
 * TenantConfig — parametrização efetiva da operação atual + user logado.
 *
 * Carrega `/v1/tenants/me` e `/v1/users/me` via SWR (cacheados pela app
 * inteira). Expõe utilitários derivados: locale efetivo (user > tenant >
 * preset), moeda, casas decimais, tipos de documento aceitos.
 *
 * Use via hook `useTenantConfig()` em qualquer client component sob o
 * ProtectedLayout.
 */

export interface TenantMe {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  country: string;
  locale: string;
  timezone: string;
  currency: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL' | 'CHURNED';
}

export interface UserMe {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  locale: string | null;
  timezone: string | null;
}

export interface TenantConfigValue {
  tenant: TenantMe | null;
  user: UserMe | null;
  /** Preset do país (BR/PY/...) com taxIdTypes, currency, etc. */
  preset: CountryPreset;
  /** Locale efetivo: user.locale > tenant.locale > preset.locale > pt-BR. */
  effectiveLocale: AppLocale;
  /** Moeda efetiva (vem do tenant; admin pode sobrescrever o preset). */
  currency: string;
  /** Casas decimais da moeda (PYG=0, outros=2). */
  currencyDecimals: number;
  /** Símbolo opcional (R$, ₲, $). */
  currencySymbol: string | undefined;
  /** Carrega/atualiza após save. */
  isLoading: boolean;
  /**
   * Atualiza locale do user atual e re-revalida.
   * Passar `null` reseta pro default do tenant.
   */
  setUserLocale: (locale: AppLocale | null) => Promise<void>;
}

const TENANT_KEY = '/v1/tenants/me';
const USER_KEY = '/v1/users/me';

const Ctx = createContext<TenantConfigValue | null>(null);

export function TenantConfigProvider({ children }: { children: React.ReactNode }) {
  const { mutate } = useSWRConfig();
  const { data: tenant, isLoading: tenantLoading } = useSWR<TenantMe>(TENANT_KEY);
  const { data: user, isLoading: userLoading } = useSWR<UserMe>(USER_KEY);

  const value = useMemo<TenantConfigValue>(() => {
    const country = tenant?.country ?? 'BR';
    const preset = getCountryPreset(country);
    const effectiveLocale = resolveAppLocale(
      resolveEffectiveLocale({
        userLocale: user?.locale,
        tenantLocale: tenant?.locale,
        tenantCountry: country,
      }),
    );
    return {
      tenant: tenant ?? null,
      user: user ?? null,
      preset,
      effectiveLocale,
      currency: tenant?.currency ?? preset.currency,
      currencyDecimals: preset.currencyDecimals,
      currencySymbol: preset.currencySymbol,
      isLoading: tenantLoading || userLoading,
      // Definido abaixo para capturar `mutate` corretamente.
      setUserLocale: async () => {},
    };
  }, [tenant, user, tenantLoading, userLoading]);

  // setUserLocale precisa de acesso a mutate; injeta agora.
  const setUserLocale = useCallback(
    async (locale: AppLocale | null) => {
      await api.patch(USER_KEY, { locale });
      await Promise.all([mutate(USER_KEY), mutate(TENANT_KEY)]);
    },
    [mutate],
  );

  const finalValue: TenantConfigValue = { ...value, setUserLocale };

  return <Ctx.Provider value={finalValue}>{children}</Ctx.Provider>;
}

export function useTenantConfig(): TenantConfigValue {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error('useTenantConfig deve ser usado dentro de <TenantConfigProvider>');
  }
  return v;
}

/**
 * Helper específico de form: dado o tipo de cliente PF/PJ, devolve o documento
 * default desse país. Usado pra inicializar o `CustomerForm`.
 */
export function useDefaultTaxIdForCustomer(kind: CustomerKindForDoc): {
  taxIdType: string;
  taxIdCountry: string;
  allowed: string[];
} {
  const { preset } = useTenantConfig();
  return {
    taxIdType: preset.defaultTaxIdType[kind],
    taxIdCountry: preset.defaultTaxIdCountry,
    allowed: preset.taxIdTypes,
  };
}
