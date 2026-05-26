'use client';

/**
 * FiberPicker — seletor de fibra com swatch da cor TIA-598.
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Em campo o técnico identifica fibra pela cor (azul, laranja, verde, marrom,
 * cinza, branco, vermelho, preto, amarelo, violeta, rosa, aqua). Em cabos
 * loose-tube com >12 fibras, o ciclo se repete em "tubos" diferentes.
 * Mostrar a cor + número + tubo elimina erros de digitação na fusão.
 */
import { fiberColorClient } from '@/lib/fiber-api';

interface Props {
  value: number;
  onChange: (n: number) => void;
  fiberCount: number;
  id?: string;
  disabled?: boolean;
}

export function FiberPicker({
  value,
  onChange,
  fiberCount,
  id,
  disabled,
}: Props) {
  const color = fiberColorClient(value);
  // Determina se a cor é clara o suficiente pra precisar de borda extra
  // (branco/amarelo/cinza ficam invisíveis num fundo escuro sem borda).
  const isLight = ['#f3f4f6', '#facc15', '#06b6d4'].includes(color.hex);

  return (
    <div className="flex items-center gap-2">
      <div
        className="h-5 w-5 rounded-full shrink-0"
        style={{
          backgroundColor: color.hex,
          border: isLight ? '1.5px solid #94a3b8' : '1.5px solid rgba(0,0,0,0.2)',
        }}
        title={color.name}
      />
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="block w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
      >
        {Array.from({ length: fiberCount }, (_, i) => i + 1).map((n) => {
          const c = fiberColorClient(n);
          return (
            <option key={n} value={n}>
              Fibra {n} ({c.name}
              {c.tube ? ` · tubo ${c.tube}` : ''})
            </option>
          );
        })}
      </select>
    </div>
  );
}

/** Versão "read-only chip" pra exibir a fibra em tabelas/popups. */
export function FiberChip({
  index,
  showName = true,
}: {
  index: number;
  showName?: boolean;
}) {
  const c = fiberColorClient(index);
  const isLight = ['#f3f4f6', '#facc15', '#06b6d4'].includes(c.hex);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2 py-0.5 text-xs">
      <span
        className="inline-block h-3 w-3 rounded-full"
        style={{
          backgroundColor: c.hex,
          border: isLight ? '1px solid #94a3b8' : '1px solid rgba(0,0,0,0.2)',
        }}
      />
      <span className="font-mono">f{index}</span>
      {showName && (
        <span className="text-text-muted">
          {c.name}
          {c.tube ? ` t${c.tube}` : ''}
        </span>
      )}
    </span>
  );
}
