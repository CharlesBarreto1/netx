'use client';

import { useCallback } from 'react';

import { formatMoney } from './format';
import { useTenantConfig } from './tenant-config';

/**
 * useFormatMoney — hook tenant-aware pra formatar dinheiro.
 *
 * Resolve o que faltava no `formatMoney` legado (que defaultava BRL):
 *   - moeda: vem do tenant atual
 *   - locale: vem do user/tenant
 *   - decimals: vem do preset do país (PYG=0, demais=2)
 *
 * Use sempre que o valor é da moeda da operação. Se o valor é em outra moeda
 * (ex.: deal com `currency: 'USD'`), passa explícito como segundo arg.
 *
 * Exemplo:
 *   const fmt = useFormatMoney();
 *   <td>{fmt(contract.monthlyValue)}</td>
 *   <td>{fmt(deal.value, deal.currency, { short: true })}</td>
 */
export function useFormatMoney() {
  const { currency: tenantCurrency, currencyDecimals, effectiveLocale } =
    useTenantConfig();

  return useCallback(
    (
      value: number | null | undefined,
      currency?: string,
      opts: { short?: boolean; decimals?: number } = {},
    ) =>
      formatMoney(value, currency ?? tenantCurrency, {
        locale: effectiveLocale,
        decimals: opts.decimals ?? (currency ? undefined : currencyDecimals),
        short: opts.short,
      }),
    [tenantCurrency, currencyDecimals, effectiveLocale],
  );
}
