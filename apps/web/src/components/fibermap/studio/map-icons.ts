/**
 * Ícones por tipo de elemento no mapa do Estúdio FiberMap (canvas → addImage).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Silhuetas distintas por tipo (ergonomia Tomodat): cubo verde = CTO, domo
 * roxo = CEO, torre azul = POP, rack cinza = armário, poste fino, bobina
 * laranja = reserva, casa rosa = cliente. Desenhados em 2x (pixelRatio 2)
 * pra ficarem nítidos; badge com borda branca pra ler sobre tiles OSM.
 */
import type { Map as MaplibreMap } from 'maplibre-gl';

import type { FibermapElementType } from '@/lib/fibermap-api';

import { ELEMENT_TYPE_COLOR } from './constants';

const S = 52; // 2x de 26px lógicos
const C = S / 2;

type Draw = (ctx: CanvasRenderingContext2D) => void;

/** Badge base: círculo ou quadrado arredondado, cor do tipo, borda branca. */
function badge(ctx: CanvasRenderingContext2D, color: string, square: boolean) {
  ctx.fillStyle = color;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  if (square) {
    const r = 9;
    const p = 4;
    ctx.roundRect(p, p, S - p * 2, S - p * 2, r);
  } else {
    ctx.arc(C, C, C - 4.5, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
}

function glyphStyle(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

const GLYPHS: Record<FibermapElementType, { square: boolean; draw: Draw }> = {
  // Cubo 3D (caixa de atendimento) — quadrado frontal + topo em perspectiva.
  CTO: {
    square: true,
    draw: (ctx) => {
      glyphStyle(ctx);
      ctx.strokeRect(16, 22, 16, 14);
      ctx.beginPath();
      ctx.moveTo(16, 22); ctx.lineTo(22, 15); ctx.lineTo(38, 15);
      ctx.lineTo(32, 22); ctx.moveTo(38, 15); ctx.lineTo(38, 29); ctx.lineTo(32, 36);
      ctx.stroke();
    },
  },
  // Domo de emenda (CEO) — cúpula sobre base.
  CEO: {
    square: false,
    draw: (ctx) => {
      glyphStyle(ctx);
      ctx.beginPath();
      ctx.arc(C, 28, 10, Math.PI, 0);
      ctx.lineTo(36, 34); ctx.lineTo(16, 34); ctx.closePath();
      ctx.stroke();
      ctx.beginPath(); ctx.moveTo(22, 34); ctx.lineTo(22, 38);
      ctx.moveTo(30, 34); ctx.lineTo(30, 38); ctx.stroke();
    },
  },
  // Torre/antena (POP).
  POP: {
    square: true,
    draw: (ctx) => {
      glyphStyle(ctx);
      ctx.beginPath();
      ctx.moveTo(20, 38); ctx.lineTo(26, 14); ctx.lineTo(32, 38);
      ctx.moveTo(22, 30); ctx.lineTo(30, 30);
      ctx.moveTo(23.5, 23); ctx.lineTo(28.5, 23);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(26, 12, 2.4, 0, Math.PI * 2); ctx.fill();
    },
  },
  // Armário de rua — rack com prateleiras.
  CABINET: {
    square: true,
    draw: (ctx) => {
      glyphStyle(ctx);
      ctx.strokeRect(17, 14, 18, 24);
      ctx.beginPath();
      ctx.moveTo(17, 22); ctx.lineTo(35, 22);
      ctx.moveTo(17, 30); ctx.lineTo(35, 30);
      ctx.stroke();
    },
  },
  // Poste — mastro com travessa.
  POLE: {
    square: false,
    draw: (ctx) => {
      glyphStyle(ctx);
      ctx.beginPath();
      ctx.moveTo(C, 13); ctx.lineTo(C, 39);
      ctx.moveTo(18, 18); ctx.lineTo(34, 18);
      ctx.moveTo(20, 23); ctx.lineTo(32, 23);
      ctx.stroke();
    },
  },
  // Reserva técnica — bobina (espiral de arcos).
  SLACK_COIL: {
    square: false,
    draw: (ctx) => {
      glyphStyle(ctx);
      ctx.beginPath(); ctx.arc(C, C, 9, 0.4, Math.PI * 1.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(C, C, 4.5, Math.PI, Math.PI * 2.6); ctx.stroke();
    },
  },
  // Cliente — casinha.
  CUSTOMER_PREMISE: {
    square: false,
    draw: (ctx) => {
      glyphStyle(ctx);
      ctx.beginPath();
      ctx.moveTo(15, 26); ctx.lineTo(C, 16); ctx.lineTo(37, 26);
      ctx.stroke();
      ctx.strokeRect(19, 26, 14, 11);
    },
  },
};

/** Registra `fm-{TYPE}` no mapa. Idempotente (skip se já existe). */
export function addElementIcons(map: MaplibreMap): void {
  (Object.keys(GLYPHS) as FibermapElementType[]).forEach((type) => {
    const name = `fm-${type}`;
    if (map.hasImage(name)) return;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    badge(ctx, ELEMENT_TYPE_COLOR[type], GLYPHS[type].square);
    GLYPHS[type].draw(ctx);
    map.addImage(name, ctx.getImageData(0, 0, S, S), { pixelRatio: 2 });
  });
}
