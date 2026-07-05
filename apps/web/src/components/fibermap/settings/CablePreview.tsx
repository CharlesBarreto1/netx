'use client';

/**
 * CablePreview — corte transversal do cabo (SVG puro), preview VIVO do form
 * de modelo de cabo (spec §10). Renderiza exatamente a estrutura que o editor
 * de emendas exibirá:
 *
 *   • casca externa (jaqueta) neutra;
 *   • tubos distribuídos radialmente na cor real (previewTubeColors), com o
 *     NÚMERO do tubo sempre visível — tubos brancos do esquema
 *     piloto/direcional são indistinguíveis por cor (spec §2);
 *   • fibras dentro de cada tubo seguindo o ciclo do padrão de cores do
 *     modelo, truncado em fibras/tubo (fibermapColorCycle).
 *
 * Branca/Natural renderiza com contorno (stroke border-strong) pra não sumir
 * no fundo claro. Tokens semânticos (`fill-surface`, `stroke-border-strong`)
 * cuidam do dark mode sozinhos.
 */
import { cn } from '@/lib/cn';
import {
  FIBERMAP_COLOR_HEX,
  fibermapColorCycle,
  type FibermapColorCode,
  type FibermapColorStandard,
} from '@/lib/fibermap-api';

export interface CablePreviewProps {
  tubeCount: number;
  fibersPerTube: number;
  /** Cores dos tubos, na ordem 1..N — vindas de `previewTubeColors()`. */
  tubeColors: FibermapColorCode[];
  /** Padrão do modelo — define o ciclo de cores das fibras. */
  colorStandard: FibermapColorStandard;
  className?: string;
}

const VIEW = 260;
const CX = VIEW / 2;
const CY = VIEW / 2;
/** Raio interno útil da casca. */
const SHEATH_R = 116;

function polar(cx: number, cy: number, r: number, angleRad: number) {
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

/** Contorno sutil pra cores escuras/médias; Branca usa token border-strong. */
const DARK_STROKE = 'rgba(15, 23, 42, 0.35)';

export function CablePreview({
  tubeCount,
  fibersPerTube,
  tubeColors,
  colorStandard,
  className,
}: CablePreviewProps) {
  const cycle = fibermapColorCycle(colorStandard);
  const fiberColors: FibermapColorCode[] = Array.from(
    { length: fibersPerTube },
    (_, i) => cycle[i % cycle.length],
  );

  const single = tubeCount === 1;
  const ringR = single ? 0 : SHEATH_R * 0.55;
  const tubeR = single
    ? SHEATH_R * 0.72
    : Math.min(
        46,
        SHEATH_R - ringR - 8,
        ringR * Math.sin(Math.PI / tubeCount) * 0.92,
      );

  const tubes = Array.from({ length: tubeCount }, (_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / tubeCount;
    const center = single ? { x: CX, y: CY } : polar(CX, CY, ringR, angle);
    return {
      n: i + 1,
      x: center.x,
      y: center.y,
      color: tubeColors[i] ?? ('BRANCA' as FibermapColorCode),
    };
  });

  return (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      role="img"
      aria-hidden
      className={cn('block h-auto w-full', className)}
    >
      {/* Jaqueta externa + miolo da casca */}
      <circle cx={CX} cy={CY} r={SHEATH_R + 6} className="fill-border-strong/25" />
      <circle
        cx={CX}
        cy={CY}
        r={SHEATH_R}
        className="fill-surface-muted stroke-border-strong"
        strokeWidth={2}
      />
      {/* Elemento de tração central (estético, só em cabos multi-tubo) */}
      {!single && (
        <circle cx={CX} cy={CY} r={9} className="fill-border-strong/50" />
      )}

      {tubes.map((tube) => {
        const whiteTube = tube.color === 'BRANCA';
        const multiFiber = fibersPerTube > 1;
        const fiberRingR = multiFiber ? tubeR * 0.58 : 0;
        const fiberR = multiFiber
          ? Math.max(
              1.4,
              Math.min(
                tubeR * 0.3,
                fiberRingR * Math.sin(Math.PI / fibersPerTube) * 0.9,
              ),
            )
          : tubeR * 0.34;
        // Com 1 fibra ela ocupa o centro; o crachá do número sobe pra não
        // esconder a cor da fibra.
        const fiberCY = multiFiber ? tube.y : tube.y + tubeR * 0.24;
        const badgeY = multiFiber ? tube.y : tube.y - tubeR * 0.5;
        const badgeR = Math.max(4.5, Math.min(10, tubeR * 0.3));

        return (
          <g key={tube.n}>
            <circle
              cx={tube.x}
              cy={tube.y}
              r={tubeR}
              fill={FIBERMAP_COLOR_HEX[tube.color]}
              className={whiteTube ? 'stroke-border-strong' : undefined}
              stroke={whiteTube ? undefined : DARK_STROKE}
              strokeWidth={whiteTube ? 1.5 : 1}
            />
            {fiberColors.map((fc, fi) => {
              const angle = -Math.PI / 2 + (2 * Math.PI * fi) / fibersPerTube;
              const p = multiFiber
                ? polar(tube.x, fiberCY, fiberRingR, angle)
                : { x: tube.x, y: fiberCY };
              const whiteFiber = fc === 'BRANCA';
              return (
                <circle
                  key={fi}
                  cx={p.x}
                  cy={p.y}
                  r={fiberR}
                  fill={FIBERMAP_COLOR_HEX[fc]}
                  className={whiteFiber ? 'stroke-border-strong' : undefined}
                  stroke={whiteFiber ? undefined : DARK_STROKE}
                  strokeWidth={whiteFiber ? 1 : 0.6}
                />
              );
            })}
            {/* Número do tubo SEMPRE visível (spec §2) */}
            <circle
              cx={tube.x}
              cy={badgeY}
              r={badgeR}
              className="fill-surface stroke-border-strong"
              strokeWidth={1}
            />
            <text
              x={tube.x}
              y={badgeY}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={badgeR * 1.15}
              fontWeight={700}
              className="fill-text"
            >
              {tube.n}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
