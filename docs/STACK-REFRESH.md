# Stack Refresh — pré-v1.0

> Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — proprietary.

Pré-lançamento da v1.0 fizemos um refresh do stack pra sair com versões da
"geração 2024 H2" em vez da "2024 H1". Isso evita que entremos em produção
com ESLint 8 (EOL out/2024) e estoquemos dívida que vira urgência depois de
ter cliente real.

## O que mudou

| Categoria | Antes | Agora |
|-----------|-------|-------|
| Node.js (runtime + engines) | 20 | **24 LTS** (Active LTS até out/2026) |
| TypeScript | 5.5 | **5.7** |
| @types/node | 20 | **24** |
| NestJS (`@nestjs/*`) | 10.3 | **11.0** |
| @nestjs/throttler | 5 | **6** |
| @nestjs/swagger | 7 | **11** |
| @nestjs/schedule | 4 | **5** |
| @nestjs/config | 3 | **4** |
| @nestjs/axios | 3 | **4** |
| @types/express | 4 | **5** (Express 5 é default no Nest 11) |
| Prisma + @prisma/client | 5.15 | **6.2** |
| Helmet | 7 | **8** |
| nestjs-cls | 4 | **5** |
| Nx | 19 | **21** |
| ESLint | 8 (EOL) | **9 (flat config)** |
| @typescript-eslint | 7 (separado) | **typescript-eslint 8 (unificado)** |
| eslint-config-prettier | 9 | **10** |
| dotenv-cli | 7 | **8** |
| date-fns | 3 | **4** |
| lucide-react | 0.400 | **0.469** |
| Vários `@radix-ui/*` | 1.1.x antigo | **1.1.x atual** |
| `@dnd-kit/sortable` | 8 | **10** |
| pino-pretty | 11 | **13** |
| argon2 | 0.40 | **0.41** (prebuild nativo pra Node 24) |
| zod | 3.23 | **3.24** |
| GitHub Actions | @v4 (Node 20) | **@v5 (Node 24)** |

## Bumps de frontend (refresh aplicado depois de calibragem)

| Pacote | Antes | Agora |
|---|---|---|
| Next.js | 14.2 | **16.x** |
| React + react-dom | 18.3 | **19.1** |
| @types/react / react-dom | 18 | **19** |
| eslint-config-next | 14 | **16** |
| Tailwind CSS | 3.4 | **4.1** |
| @tailwindcss/postcss | — | **4.1** (novo plugin obrigatório) |
| tailwindcss-animate | 1.0 (deprecated TW4) | **removido**, substituído por `tw-animate-css` |
| autoprefixer | 10.4 | **removido** (Tailwind 4 já trata) |
| next-intl | 3 | **4** |
| Zod | 3.24 | **4.0** |
| sonner | 1 | **2** |
| tailwind-merge | 2 | **3** |
| @radix-ui/* | 1.1.x intermediário | **1.1.x/2.x latest** |
| cmdk | 1.0.4 | **1.1.1** |
| lucide-react | 0.469 | **0.526** |
| jest | 29 | **30** |
| @nestjs/schedule | 5 | **6** |
| nestjs-cls | 5 | **6** |
| argon2 | 0.41 | **0.43** |
| class-validator | 0.14.1 | **0.14.2** |
| TypeScript | 5.7 | **5.9** |
| ESLint | 9.18 | **9.30** |
| Nx | 21 | **22** |

## Migrações de código aplicadas

### Tailwind 4
- `apps/web/src/app/globals.css`: troca `@tailwind base/components/utilities` por `@import 'tailwindcss'` + `@config '../../tailwind.config.ts'` (compat layer) + `@import 'tw-animate-css'` + `@custom-variant dark`.
- `apps/web/postcss.config.js`: agora usa `@tailwindcss/postcss` (autoprefixer não é mais necessário).
- `apps/web/tailwind.config.ts`: removido plugin `tailwindcss-animate` (substituído por import CSS).
- Design tokens existentes (`bg`, `surface`, `border`, ...) ficam no `tailwind.config.ts` — Tailwind 4 lê via `@config`. Migrar pra `@theme` puro pode esperar até v1.2.

**Mudanças de classes aplicadas** (Tailwind 4 renomeou semântica):
- **`outline-none` → `outline-hidden`** em 8 arquivos (12 ocorrências total): chat/page, Tabs, dialog, Button, dropdown-menu, Input, DealCard, DealColumn. Em TW4 `outline-none` agora significa `outline-style: none` (semântica diferente); `outline-hidden` mantém o visual antigo (outline-width: 0 mas preserva estilo).
- **`border` sem cor** em `receipts/[type]/[id]/page.tsx` → adicionado `border-border` (TW4 default mudou).
- **`shadow-sm`, `rounded`, `rounded-sm`**: NÃO precisaram mudar — nosso `tailwind.config.ts` customiza ambos (`borderRadius.DEFAULT='6px'`, `boxShadow.sm/md/lg/...`), então o tema custom prevalece sobre as escalas renomeadas do TW4.
- **`ring-*`**: 7 usos, todos com prefixo numérico explícito (`ring-1`, `ring-2`, `ring-brand-500`). Default `ring` (sem prefixo) mudou de 3px → 1px no TW4, mas não usamos.

Pontos que vale conferir visualmente após `npm run dev`:
1. Focus state em inputs/dialogs (ring + outline-hidden).
2. Bordas em receipts/prints (border-border).
3. Animations via `tw-animate-css` (kanban, dropdowns).

### Next 16 + React 19 (requer ajustes pós-instalação)
- `npx @next/codemod@canary upgrade latest` resolve a maioria automaticamente.
- **Async params em route handlers:** se você tem `[id]/page.tsx` recebendo `params: { id: string }`, em Next 16 vira `params: Promise<{ id: string }>` — adicionar `await params` ou `const { id } = await params`.
- **`forwardRef` deprecated em React 19:** wrappers de shadcn/ui ainda funcionam mas emitem warning. Re-gerar componentes via `pnpm dlx shadcn@latest add ...` ou refatorar manualmente.
- **`useFormState` → `useActionState`** (se usado em algum form action).

### Zod 4 (back-compat ~98%)
- `.parse`, `.safeParse`, `.optional()`, `.string()`, `.array()` — tudo igual.
- `errorMap` API mudou: agora aceita `{ error: ... }` em vez de função única. Se nenhum `.refine` usa errorMap custom no nosso código, sem mudança.
- `z.infer<typeof schema>` continua igual.

---

## Refresh UI C — polish visual completo (pré-v1.0)

Migrou de "modesto operacional" pra "produto B2B moderno tipo Linear/Stripe".

### Fundação Tailwind 4 (CSS-first)
- `apps/web/src/app/globals.css` reescrito do zero — todos os tokens vivem em `@theme` (cores semânticas, fontes, radii, shadows, animations, font sizes). `tailwind.config.ts` virou stub deprecated (mantido só pra não quebrar ferramentas).
- Custom variants: `dark`, `compact`, `cozy`, `comfortable` — todos via `@custom-variant`.
- Inter Variable + JetBrains Mono Variable carregados via `next/font/google` em `apps/web/src/app/layout.tsx`, injetando `--font-sans` e `--font-mono`.
- Tokens novos: `surface-elevated`, `accent-strong`, `severity-online/warn/offline/error`, `--shadow-glow`, `--shadow-pop`, `--radius-2xl`.
- Animations novas: `fade-in-up`, `slide-right`, `bounce-in`, `pulse-soft`, `ping-soft`.
- Utilities novas: `.glass`, `.glass-strong`, `.card-interactive`, `.dot-status[data-status]`, `.lift-3d`, `.mask-fade-b`, `.mask-fade-r`, `.surface-aurora`, `.grid-dense-16`.

### Componentes reusáveis novos
- `components/ui/Skeleton.tsx` — `<Skeleton>`, `<SkeletonText>`, `<SkeletonRow>`, `<SkeletonCard>`, `<SkeletonAvatar>`.
- `components/ui/EmptyState.tsx` — placeholder unificado com ícone Lucide + título + descrição + CTA.
- `components/ui/Breadcrumb.tsx` — trilho com truncate, tooltip em items longos, `ChevronRight` Lucide.
- `components/ui/StatusBadge.tsx` — pill `online/warn/offline/error` com pulse na bolinha online.
- `components/ui/DataTable.tsx` — wrapper genérico de tabela com `columns` + `data`, integra skeleton/empty/density/container query nativamente.
- `lib/notify.ts` — wrapper sonner com presets `success/error/warning/info/apiError/promise` + ícones Lucide.
- `lib/density.tsx` — `DensityProvider` + `useDensity()` com `cycle()`, persiste em localStorage.

### Navegação
- `components/layout/CommandPalette.tsx` — Cmd+K (Ctrl+K) palette completo: search global (clientes via SWR debounced), navegação rápida, ações ("Novo cliente"), troca de density, toggle dark/light. Trigger global via `window.dispatchEvent('netx:open-command-palette')`.
- `components/layout/AppShell.tsx` reescrito:
  - Topbar **glassmorphism** (`.glass`) com `backdrop-blur`.
  - Botão "Buscar..." com kbd `⌘K` na topbar (md+).
  - **Sidebar collapsible** com toggle `⌘\\` (atalho global) + botão `ChevronsLeft/Right`. Persiste em localStorage. Quando colapsada, tooltips Radix nos items.
  - Ícones **Lucide** (LayoutDashboard, Users, FileText, KanbanSquare, Wrench, etc) substituem SVG inline antigos.
  - UserMenu redesenhado com glass-strong + Lucide.
  - Density variants aplicadas nos items do sidebar (`compact:py-1.5 cozy:py-2 comfortable:py-2.5`).

### Páginas-chave refinadas
- **Dashboard** (`/dashboard/page.tsx`): hero com greeting dinâmico + surface-aurora; 3 KPIs em cards animados (`animate-fade-in-up` com `animationDelay` staggered); 3 shortcut cards; dica do dia mencionando ⌘K. Cards com `card-interactive` (hover lift + shadow).
- **Hub do cliente** (`/customers/[id]/page.tsx`):
  - Breadcrumb no topo (Clientes → Nome).
  - Header card com avatar de iniciais 14×14 em accent-muted, nome 2xl, badges PF/PJ + status, código pill, tax id tabular.
  - InfoChips com ícones Lucide (Mail, Phone, Calendar, Clock) e tokens semânticos.
- **DealCard kanban**: hover lift sutil (`hover:-translate-y-px`), animação `fade-in-up` na entrada, drag overlay com `scale-[1.03]` + perspective.

### Padrão pra migrar outras listagens
As 7+ listagens restantes (`/contracts`, `/finance/charges`, `/service-orders`, `/network/equipment`, `/network/pops`, `/settings/users`, `/settings/audit`, `/settings/cash-registers`, `/settings/backups`) podem ser migradas pro `<DataTable />` em ~15 min cada. Padrão:

```tsx
import { DataTable } from '@/components/ui/DataTable';
import { Users } from 'lucide-react';

<DataTable
  columns={[
    { key: 'name', label: 'Nome', cell: (c) => <Link href={...}>{c.displayName}</Link> },
    { key: 'email', label: 'Email', cell: (c) => c.primaryEmail, hideOnNarrow: true },
    { key: 'status', label: 'Status', cell: (c) => <Badge tone={...}>{...}</Badge> },
    { key: 'actions', label: '', cell: (c) => <Link>Abrir</Link>, align: 'right' },
  ]}
  data={data?.data}
  isLoading={isLoading}
  empty={{
    icon: Users,
    title: 'Nenhum cliente ainda',
    description: 'Cadastre o primeiro pra começar.',
    action: { label: 'Novo cliente', href: '/customers/new' },
  }}
/>
```

Density (`compact:py-1.5 cozy:py-2.5 comfortable:py-3 py-2.5`) e container queries (`hideOnNarrow` usa `hidden @md/datatable:table-cell`) já vêm de graça.

### O que sobrou pra v1.1 ou depois
- Migrar as 7 listagens restantes pro `DataTable` (mecânico).
- Aplicar `notify.success/error` no lugar de `alert()` / `toast.error()` solto.
- `globals.css`: dois ou três blocos de cor ainda em hex direto (paletas brand-* legadas) podem ser removidos quando todo código usar tokens semânticos.
- White-label: cada tenant injeta `style="--accent: ...;"` no `<html>` via TenantConfigProvider. Foundation pronta.
- @starting-style nativo (sem JS) substituindo data-state dos dialogs Radix em v1.2.

## O que precisa rodar localmente

A regeneração de lockfile e baseline Prisma 6 são manuais — sandbox sem registry npm.

```bash
# 1. Mac, no repo
cd ~/dev/netx
rm -rf node_modules package-lock.json    # garante tabula rasa
npm install                                # gera package-lock.json novo

# 2. Apaga configs ESLint legados (flat config substitui) — sandbox não permitiu deletar
git rm .eslintrc.json .eslintignore apps/web/.eslintrc.json

# 3. Regenera baseline Prisma em 6.x
rm -rf apps/core-service/prisma/migrations/0_init
npm run db:baseline                        # gera prisma/migrations/0_init/migration.sql
npm run db:generate                        # cliente Prisma 6 com novos tipos

# 4. Build + lint
npm run build
npm run lint                               # ESLint 9 flat config

# 5. Commit
git add -A
git commit -m "chore(stack): refresh — Nest 11, Prisma 6, ESLint 9, Node 24, etc"
git push

# 6. Servidor de dev (PM2)
ssh netx@servidor
cd ~/apps/netx
git pull
rm -rf node_modules
npm install
npm run db:generate
npm run db:adopt                           # marca a baseline 0_init como aplicada
npm run db:migrate:deploy                  # aplica migrations posteriores (radacct + must_change_password)
npm run build
pm2 restart netx-core netx-gateway netx-web
pm2 logs netx-core --lines 50              # validar boot
```

## O que pode dar errado e como resolver

### `npm install` falha em `argon2`
Argon2 0.41 tem prebuild pra Node 24. Se o `node-gyp` rebuild explodir,
instale `build-essential python3 make g++` no servidor. PM2 + Node via NVM
costuma já ter.

### `prisma migrate deploy` reclama de drift
Se a tabela `_prisma_migrations` ainda não existe no DB, rode `db:adopt`
**antes** do migrate deploy. Adopt cria a tabela e marca `0_init` como
aplicada — tudo subsequente flui normal.

### ESLint 9 reclama de regras antigas
Erros tipo "Cannot find module '@typescript-eslint/parser'" significam que
o `node_modules` ainda tem cache antigo. `rm -rf node_modules
package-lock.json && npm install` resolve.

### NestJS 11 + algum guard custom dá erro de tipo
`ExecutionContext.switchToHttp().getRequest<Request>()` continua igual.
Se algum guard do projeto fazia cast pra `express.Request` antigo, o tipo
agora vem do `@types/express@5` — verifique o build mas não devem haver
breaking changes em código de aplicação.

### Helmet 8 muda `crossOriginResourcePolicy` default
Em Helmet 8 esse header agora é `same-origin` por default em vez de
`same-site`. Já passamos `'same-site'` explícito no `main.ts` então não
afeta.

### Prisma 6 + `postgresqlExtensions` warning
Continua sendo preview em 6.0/6.1 e estabilizado em alguma 6.x posterior.
Se aparecer warning "preview feature stabilized", remova de
`previewFeatures` em schema.prisma e rode `db:generate` de novo.

## Pós-lançamento (v1.1)

Próxima janela de upgrade:

- **Onda D — Frontend modernization (3-4 dias)**
  - React 18 → 19 + Next 14 → 15
  - Re-gerar componentes shadcn/ui afetados por mudanças em `forwardRef`
  - Codemod Next 15 (`npx @next/codemod@latest`)
  - Async params em route handlers (`params: Promise<{ id: string }>`)
- **Onda E — Tailwind 4 (2 dias)**
  - Migrar `tailwind.config.js` → `@theme` no globals.css
  - Validar visualmente cada página
- **Onda F — Sentry / error reporting (1 dia)**
  - Adicionar `@sentry/node` no core e `@sentry/nextjs` no web
  - Cobre P2-E identificado na auditoria pré-v1.0

---

## Bump pra Node 26 (beta v1.1 — quando virar LTS em out/2026)

Hoje o projeto roda Node 24 (Active LTS). Node 26 saiu em abril/2026 como
Current e vira Active LTS em outubro/2026. A intenção é fazer um beta v1.1
nessa versão **assim que o LTS for promovido** — antes disso é risco médio
(prebuilds nativos, comunidade ainda formando experiência).

### Onde mexer (lista mínima)

Mantemos a versão centralizada onde possível. Pra subir de 24 → 26, mexa
em **5 lugares**:

| Lugar | Mudança |
|---|---|
| `infra/installer/lib/packages.sh` | `NETX_NODE_MAJOR="${NETX_NODE_MAJOR:-24}"` → `26` |
| `package.json` (raiz) | `"engines.node": ">=24.0.0"` → `">=26.0.0"` |
| `apps/api-gateway/package.json` | `"@types/node": "^24.0.0"` → `"^26.0.0"` |
| `apps/core-service/package.json` | idem |
| `apps/web/package.json` | idem |
| `.github/workflows/ci.yml` | `node-version: 24` → `26` |
| `README.md` (raiz, tabela Stack) | "Node.js 24" → "Node.js 26" |
| `infra/installer/README.md` (tabela) | "Node.js 24 LTS" → "Node.js 26 LTS" |

8 edições, todas mecânicas. **Sem mudança de código** — Node 26 é
back-compat com Node 24 em APIs estáveis.

### Antes de bumpar, verificar

1. **NodeSource publicou `node_26.x`?** `curl -fsSL https://deb.nodesource.com/node_26.x` deve responder. Se não, espera 1-2 dias após o LTS oficial — eles publicam rápido.
2. **`argon2` tem prebuild pra Node 26?** Veja `https://github.com/ranisalt/node-argon2/releases`. Se ainda não, `npm install` cai em `node-gyp` rebuild — `build-essential python3` já está garantido pelo installer.
3. **Prisma support.** Prisma costuma anunciar Node LTS novo em release notes. Bumpe `prisma + @prisma/client` pra última 6.x antes (ou pra Prisma 7 se já estiver out).
4. **NestJS test matrix.** Cheque release notes do Nest 11 — costumam adicionar Node 26 ao test matrix dentro de 1-2 minor releases após o LTS.
5. **Smoke test local.** `nvm install 26 && nvm use 26 && npm ci && npm run build` antes de pushar.

### Plano de release v1.1-beta

1. Esperar Node 26 virar Active LTS (out/2026, ±1 semana).
2. Aguardar 2 semanas pra prebuilds nativos pegarem (ouro padrão: `argon2` publicar release nota mencionando Node 26).
3. Criar branch `v1.1-beta`.
4. Fazer as 8 edições acima em commit único: `chore(stack): bump Node 24 → 26 (Active LTS)`.
5. CI verde + smoke test local → tag `v1.1.0-beta1` e deploy num cliente piloto.
