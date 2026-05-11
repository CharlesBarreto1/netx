/**
 * DensityProvider — controle global de densidade visual (compact/cozy/comfortable).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Persiste no localStorage (`netx.density`) e seta `data-density` no <html>.
 * As variantes `compact:`/`cozy:`/`comfortable:` em Tailwind 4 (definidas via
 * @custom-variant em globals.css) leem esse atributo e aplicam estilos.
 *
 * Uso:
 *   const { density, setDensity } = useDensity();
 *   <button onClick={() => setDensity('compact')}>Compacto</button>
 *
 *   <tr className="h-9 compact:h-7 comfortable:h-11">...</tr>
 */
'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Density = 'compact' | 'cozy' | 'comfortable';

interface DensityCtx {
  density: Density;
  setDensity: (d: Density) => void;
  cycle: () => void; // compact → cozy → comfortable → compact
}

const Ctx = createContext<DensityCtx | null>(null);

const STORAGE_KEY = 'netx.density';
const DEFAULT_DENSITY: Density = 'cozy';
const ORDER: Density[] = ['compact', 'cozy', 'comfortable'];

function readInitial(): Density {
  if (typeof window === 'undefined') return DEFAULT_DENSITY;
  const stored = window.localStorage.getItem(STORAGE_KEY) as Density | null;
  return stored && ORDER.includes(stored) ? stored : DEFAULT_DENSITY;
}

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<Density>(DEFAULT_DENSITY);

  // Hidratação: lê localStorage só no client e ajusta o <html data-density>.
  useEffect(() => {
    const initial = readInitial();
    setDensityState(initial);
    document.documentElement.setAttribute('data-density', initial);
  }, []);

  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    document.documentElement.setAttribute('data-density', d);
    try {
      window.localStorage.setItem(STORAGE_KEY, d);
    } catch {
      /* localStorage indisponível (modo privado) — silently ignore */
    }
  }, []);

  const cycle = useCallback(() => {
    setDensity(ORDER[(ORDER.indexOf(density) + 1) % ORDER.length]);
  }, [density, setDensity]);

  const value = useMemo<DensityCtx>(
    () => ({ density, setDensity, cycle }),
    [density, setDensity, cycle],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDensity(): DensityCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useDensity must be used within a DensityProvider');
  }
  return ctx;
}
