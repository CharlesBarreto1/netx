'use client';

/**
 * Combobox assíncrono com busca server-side, debounce e navegação por teclado.
 *
 * Criado pra seleção de CTO na execução de O.S — listas com centenas/milhares
 * de itens onde rolar um <select> nativo é inviável. Genérico o bastante pra
 * qualquer "escolher 1 de muitos via busca": recebe um `loadOptions(query)`
 * que consulta o backend e devolve as opções já filtradas.
 *
 * Controlado: o pai guarda o `value` (id) e a `selectedOption` (pra exibir o
 * label quando fechado sem precisar re-buscar).
 *
 * @provenance Y2hhcmxlc2JhcnJldG86MDg0NzI5Njg5MDE=
 */
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Linha secundária (ex.: localização da CTO). */
  sublabel?: string;
}

interface ComboboxProps {
  id?: string;
  value: string;
  /** Opção atualmente selecionada — exibida no trigger quando fechado. */
  selectedOption?: ComboboxOption | null;
  onChange: (value: string, option: ComboboxOption | null) => void;
  /** Carrega opções pro termo de busca. Chamado com '' ao abrir. */
  loadOptions: (query: string) => Promise<ComboboxOption[]>;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  loadingText?: string;
  disabled?: boolean;
  /**
   * Quando muda, limpa o cache de opções e o termo (ex.: trocou a OLT, então
   * as CTOs anteriores não valem mais).
   */
  resetKey?: string | number;
}

const triggerBase =
  'flex w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm ' +
  'shadow-sm transition-colors focus:border-brand-500 focus:outline-hidden focus:ring-1 focus:ring-brand-500 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ' +
  'dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800';

export function Combobox({
  id,
  value,
  selectedOption,
  onChange,
  loadOptions,
  placeholder = 'Selecionar…',
  searchPlaceholder = 'Buscar…',
  emptyText = 'Nada encontrado',
  loadingText = 'Buscando…',
  disabled,
  resetKey,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ComboboxOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  // loadOptions é uma closure do pai (muda a cada render) — guardamos em ref
  // pra não re-disparar o effect de busca a cada render.
  const loadRef = useRef(loadOptions);
  loadRef.current = loadOptions;
  // Descarta respostas fora de ordem (digitação rápida).
  const reqIdRef = useRef(0);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Reset quando a fonte muda (ex.: trocou a OLT).
  useEffect(() => {
    setQuery('');
    setOptions([]);
    setOpen(false);
  }, [resetKey]);

  // Busca com debounce sempre que abre ou o termo muda.
  useEffect(() => {
    if (!open) return;
    const myReq = ++reqIdRef.current;
    setLoading(true);
    const handle = setTimeout(() => {
      loadRef
        .current(query)
        .then((opts) => {
          if (reqIdRef.current !== myReq) return;
          setOptions(opts);
          setActiveIndex(0);
        })
        .catch(() => {
          if (reqIdRef.current !== myReq) return;
          setOptions([]);
        })
        .finally(() => {
          if (reqIdRef.current === myReq) setLoading(false);
        });
    }, 250);
    return () => clearTimeout(handle);
  }, [open, query, resetKey]);

  function select(opt: ComboboxOption) {
    onChange(opt.value, opt);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = options[activeIndex];
      if (opt) select(opt);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const triggerLabel = selectedOption?.label ?? '';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={triggerBase}
      >
        <span className={cn('truncate', !selectedOption && 'text-slate-400')}>
          {selectedOption ? (
            <>
              {triggerLabel}
              {selectedOption.sublabel ? (
                <span className="text-slate-400"> · {selectedOption.sublabel}</span>
              ) : null}
            </>
          ) : (
            placeholder
          )}
        </span>
        <svg
          className="h-4 w-4 shrink-0 text-slate-400"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-200 p-2 dark:border-slate-700">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              className="block w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-hidden focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
          <ul className="max-h-60 overflow-y-auto py-1">
            {loading ? (
              <li className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                {loadingText}
              </li>
            ) : options.length === 0 ? (
              <li className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                {emptyText}
              </li>
            ) : (
              options.map((opt, i) => (
                <li key={opt.value}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => select(opt)}
                    className={cn(
                      'flex w-full flex-col px-3 py-2 text-left text-sm',
                      i === activeIndex && 'bg-brand-50 dark:bg-slate-800',
                      opt.value === value && 'font-semibold',
                    )}
                  >
                    <span className="truncate text-slate-800 dark:text-slate-100">
                      {opt.label}
                    </span>
                    {opt.sublabel ? (
                      <span className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {opt.sublabel}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
