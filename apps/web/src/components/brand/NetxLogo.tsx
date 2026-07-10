import { cn } from '@/lib/cn';

/**
 * NetxLogo — logotipo oficial da NetX (wordmark "NET" + o "X" com gradiente
 * azul). Dois assets em `/public`, com o "X" idêntico e o "NET" em duas cores:
 *
 *   • `netx-logo-white.png` — "NET" branco, para fundos ESCUROS
 *   • `netx-logo-black.png` — "NET" preto,  para fundos CLAROS
 *
 * `variant`:
 *   • `onDark`  → sempre o branco (ex.: painel de marca escuro)
 *   • `onLight` → sempre o preto
 *   • `auto`    → troca pelo tema do app (branco no `.dark`, preto no claro)
 *
 * Dimensione pela ALTURA via `className` (ex.: `h-8`); a largura sai por
 * proporção (`w-auto`). Os PNGs já vêm aparados (sem margem transparente).
 */
const RATIO = { width: 687, height: 201 } as const;

export function NetxLogo({
  className,
  variant = 'auto',
  alt = 'NetX',
}: {
  className?: string;
  variant?: 'auto' | 'onDark' | 'onLight';
  alt?: string;
}) {
  if (variant !== 'auto') {
    const src = variant === 'onDark' ? '/netx-logo-white.png' : '/netx-logo-black.png';
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        width={RATIO.width}
        height={RATIO.height}
        className={cn('w-auto select-none', className)}
        draggable={false}
      />
    );
  }
  // auto — deixa as duas no DOM e alterna via variante `dark:`. Assim o troca
  // de tema é instantâneo (CSS puro), sem depender de JS/hidratação.
  return (
    <span className={cn('inline-flex', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/netx-logo-white.png"
        alt={alt}
        width={RATIO.width}
        height={RATIO.height}
        className="hidden h-full w-auto select-none dark:block"
        draggable={false}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/netx-logo-black.png"
        alt=""
        aria-hidden
        width={RATIO.width}
        height={RATIO.height}
        className="block h-full w-auto select-none dark:hidden"
        draggable={false}
      />
    </span>
  );
}
