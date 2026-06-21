'use client';

import useSWR from 'swr';

import type { DocEmisor, DocLocale } from '@/components/finance/InvoiceDocument';

import type { SifenConfigResponse } from './sifen-api';
import { useTenantConfig } from './tenant-config';

/**
 * Resolve os dados do EMISOR pro cabeçalho dos documentos imprimíveis.
 *  - PY: usa a config SIFEN do tenant (/v1/sifen/config) — razón social,
 *        RUC, dirección, actividad, etc.
 *  - Demais países (BR): usa o Tenant (legalName/name/taxId).
 */
export function useDocEmisor(): {
  locale: DocLocale;
  emisor: DocEmisor;
  currencyLabel: string;
  decimals: number;
} {
  const cfg = useTenantConfig();
  const country = cfg?.tenant?.country ?? 'BR';
  const isPy = country === 'PY';

  const { data: sifen } = useSWR<SifenConfigResponse>(
    isPy ? '/v1/sifen/config' : null,
  );
  const e = sifen?.emisor ?? null;

  const emisor: DocEmisor =
    isPy && e
      ? {
          razonSocial: e.razonSocial,
          nombreFantasia: e.nombreFantasia ?? null,
          ruc: e.ruc,
          activity: e.actividadDescripcion ?? null,
          address: [e.direccion, e.ciudadDesc].filter(Boolean).join(', ') || null,
          phone: e.telefono ?? null,
          email: e.email ?? null,
        }
      : {
          razonSocial: cfg?.tenant?.legalName ?? cfg?.tenant?.name ?? '',
          nombreFantasia: cfg?.tenant?.name ?? null,
          ruc: cfg?.tenant?.taxId ?? null,
          activity: null,
          address: null,
          phone: null,
          email: null,
        };

  return {
    locale: isPy ? 'PY' : 'BR',
    emisor,
    currencyLabel: isPy ? 'Guaraníes (PYG)' : cfg?.currency ?? 'BRL',
    decimals: cfg?.currencyDecimals ?? (isPy ? 0 : 2),
  };
}
