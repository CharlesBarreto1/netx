/* eslint-disable */
/**
 * DEPRECATED — config legado mantido só pra evitar quebra de ferramentas
 * (Nx, IDE plugins) que ainda procuram `tailwind.config.ts`. A configuração
 * real do Tailwind 4 vive em `src/app/globals.css` via `@theme`.
 *
 * Pra remover este arquivo de vez:
 *   1. Confirme que nenhum tool externo (storybook, etc) referencia ele
 *   2. `rm tailwind.config.ts` e remova a referência em qualquer script
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.
 */
export default {
  content: ['./src/**/*.{ts,tsx,mdx}'],
};
