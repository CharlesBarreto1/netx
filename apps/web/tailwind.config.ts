/**
 * Tailwind 4 config (híbrido CSS-first + JS plugin).
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 *
 * Por que existir:
 *   • Tokens (cores, radii, shadows, animations) vivem em `@theme` no
 *     `globals.css` — é o caminho recomendado pra Tailwind 4.
 *   • Variantes custom (`dark`, `compact`, `cozy`, `comfortable`) vivem aqui
 *     via plugin JS porque o `@custom-variant` em CSS tem bugs intermitentes
 *     dependendo da versão de `@tailwindcss/postcss`. O plugin JS é a API
 *     estável desde TW v3 e funciona 100% em TW4.
 *   • `darkMode: 'class'` ativa o utility `dark:bg-foo` baseado na presença
 *     da classe `.dark` no <html> (toggle manual em runtime via JS).
 */
import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx,mdx}'],
  plugins: [
    plugin(({ addVariant }) => {
      // Densidade — data-density vive no <html>, descendentes pegam a variant.
      // Usa atributo entre colchetes pra evitar conflito com classes Tailwind.
      addVariant('compact', '&:where([data-density="compact"] *)');
      addVariant('cozy', '&:where([data-density="cozy"] *)');
      addVariant('comfortable', '&:where([data-density="comfortable"] *)');
    }),
  ],
};

export default config;
