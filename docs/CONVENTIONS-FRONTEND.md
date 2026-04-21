# Convenções — Frontend (`apps/web`)

Regras e padrões obrigatórios para o frontend Next.js 14 + TypeScript estrito.
Pensadas para prevenir os erros recorrentes que já tomaram tempo de deploy.

## Stack

- Next.js 14 (App Router) com `experimental.typedRoutes: true`
- React 18 + Server/Client Components
- TypeScript 5 (`strict: true`)
- Tailwind puro + primitivos caseiros em `components/ui/`
- SWR para fetching no cliente
- `sessionStorage` para token + user + tenant (chaves `netx.*`)

## 1. Roteamento com `typedRoutes`

O `next.config.mjs` tem `experimental.typedRoutes: true`. Isso faz o Next
gerar tipos estáticos para todas as rotas do `app/` e **rejeita** em
compile-time qualquer `router.push`/`router.replace`/`<Link href>` que não
seja prova­velmente uma rota válida.

### Regra de ouro

> O pathname tem que **casar com o filesystem** de `app/`. Query string é livre.

### Como escrever URLs dinâmicas

**✅ Correto** — template literal cujo prefixo é uma rota conhecida:

```ts
router.push(`/customers/${id}`);
router.replace(`/customers/${id}?${params.toString()}`);
router.push(`/customers?${qs}`);
<Link href={`/customers/${customer.id}`}>Abrir</Link>
```

O Next reconhece `/customers/[id]` pelo filesystem; a parte `${id}` é
permitida. O `?...` é sempre ignorado pela validação.

**❌ Errado** — string montada em runtime:

```ts
router.replace(url.pathname + url.search);           // TS barra
const href = '/customers/' + id;                     // TS barra
router.push(someString);                             // TS barra
```

O validador não consegue provar estaticamente que `someString` é uma rota
real, então trata como inválida.

### Escape hatch (raríssimo)

Em casos muito específicos (ex.: URL vinda de uma API de redirect), cast
explícito:

```ts
import type { Route } from 'next';
router.push(returnTo as Route);
```

Quando for usar `as Route`, deixe um comentário explicando por quê.

### Rotas "externas" (fora de `app/`)

Para redirecionar para domínio externo (OAuth callback, etc.) use
`window.location.href = ...`, não o router.

### Checklist ao adicionar nova rota

1. Criar `app/(protected)/<pasta>/page.tsx` (ou `app/<pasta>/page.tsx` se
   público).
2. O next dev **regera os tipos** automaticamente; se estiver em CI ou em
   build sem dev server, rode `next build` uma vez para disparar a geração.
3. Pronto — `/<pasta>` já é aceito em `router.push`.

## 2. Event handlers com retorno tipado (`onConfirm`, etc.)

Quando um prop é tipado como `() => void | Promise<void>` (ex.:
`ConfirmDialog.onConfirm`), o retorno da função **precisa** caber nessa união.
Expressões com `&&`/`||` devolvem o **operando**, não um booleano — e isso
quebra a assinatura silenciosamente.

### Exemplo do problema real

`ConfirmDialog` do NetX:

```ts
onConfirm: () => void | Promise<void>;
```

**❌ Errado** — TS infere retorno `null | Promise<void>`:

```tsx
onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
// Se confirmDelete é null, a arrow retorna null — não bate com void | Promise<void>.
```

**✅ Correto** — bloco com `return` condicional:

```tsx
onConfirm={() => {
  if (confirmDelete) return handleDelete(confirmDelete);
}}
```

Quando `confirmDelete` é falsy, a função retorna `undefined` (= `void`).
Quando é truthy, retorna `Promise<void>`. Ambos válidos.

### Exceção — callbacks `() => void`

Handlers do React DOM (`onClick`, `onSubmit`, etc.) são tipados como
`(event) => void`. TypeScript tem uma regra especial: **retornos de funções
`() => void` são ignorados**. Então isso não quebra:

```tsx
<button onClick={() => !disabled && doThing()} />   // ok, onClick ignora retorno
```

Mas **não conte com isso** em props customizados. Sempre prefira
`if (...) return fn();` — é mais legível e nunca quebra.

### Checklist ao passar callbacks

1. Se o prop é `() => Promise<void>` ou `() => void | Promise<void>`, use
   bloco com `return` condicional.
2. Nunca use `cond && fn()` como corpo de arrow para callbacks custom.
3. Se o lint encontrar warnings `@typescript-eslint/no-floating-promises`,
   envolva chamadas async com `void fn()` (ex.: no `onClick` do `ConfirmDialog`
   já fazemos `onClick={() => void onConfirm()}`).

## 3. Adicionar dependências

Sempre que mexer em `package.json` de qualquer workspace:

```bash
npm install                              # regenera package-lock.json
git add package.json package-lock.json   # commit dos DOIS juntos
git commit -m "chore(web): add swr dep"
```

Motivo: a VPS usa `npm ci`, que **falha** se o lockfile não estiver em sincronia
(`EUSAGE: lock file ... out of sync`). Sem o lockfile correto, a VPS não instala
a dep, o build falha, e o deploy trava.

Para checar antes do push:

```bash
npm install --dry-run                    # não deve reportar mudanças se lockfile ok
git status                               # package-lock.json NÃO deve aparecer como modificado
```

## 4. Env vars `NEXT_PUBLIC_*`

Variáveis `NEXT_PUBLIC_*` são **bakeadas no bundle** no momento do `next build`.
Consequências:

- Mudar `.env.production` depois do build **não tem efeito**. Precisa rebuildar.
- O valor vai pro browser — **nunca** coloque segredo em `NEXT_PUBLIC_*`.
- Em deploy, garanta que a env está setada **antes** do `npm run build`.

Vars atuais em uso:

| Variável | Onde usada | Default |
|----------|------------|---------|
| `NEXT_PUBLIC_API_URL` | `apps/web/src/lib/api.ts`, rewrites | `http://localhost:3000/api` |

Em produção: `https://<dominio>/api`.

## 5. Cliente HTTP (`lib/api.ts`) e SWR

### Regras

- **Sempre** use `api.get/post/patch/put/delete` — nunca `fetch()` solto.
  O wrapper trata 401 (redireciona pra `/login`), adiciona Bearer token de
  `sessionStorage`, e expõe erros como `ApiError` (RFC 7807-like).
- Para SWR, a `key` é o **path da API** (começa com `/v1/...`). O `swrFetcher`
  global delega pro `api.get`, então todo consumidor reaproveita auth e
  tratamento de erro.
- Em operações de login (ou qualquer coisa onde 401 é resposta legítima),
  use `apiLogin` direto — não passe pelo `api.*`, senão o 401 dispara o
  redirect indesejado.

### Tipagem

Sempre passe o tipo esperado:

```ts
const { data } = useSWR<Customer>(key);                   // ✅
const created = await api.post<Customer>('/v1/customers', dto);
```

## 6. Permissões na UI

Gating no frontend é **UX**, não segurança. A autoridade é o backend — nunca
mostrar dado que o backend não liberou, mas também nunca confiar que esconder
um botão protege uma rota.

### Permissões CRM que já existem no seed

| Permissão | Significa |
|-----------|-----------|
| `customers.read` | Listar/ver clientes |
| `customers.create` | Criar cliente |
| `customers.update` | Editar cliente, endereços, contatos |
| `customers.delete` | Soft-delete de cliente |
| `customers.tags.manage` | CRUD de tags + atribuir/remover em clientes |
| `customers.consents.manage` | Registrar consentimentos LGPD |
| `customers.notes.manage` | CRUD de anotações (com regra de ownership) |

### Padrão de uso

```tsx
import { hasPermission } from '@/lib/session';

const canCreate = hasPermission('customers.create');

{canCreate && <Button onClick={openNewForm}>Novo cliente</Button>}
```

Para gates em navegação, use o filtro de `AppShell.tsx` (campo `permission`
em cada item do nav).

## 7. Persistência de estado em URL

Filtros de lista e abas de detalhe vivem em **query string**, não em state
local. Vantagens: link compartilhável, back/forward do browser funciona,
refresh não perde contexto.

Padrão:

```tsx
const sp = useSearchParams();
const filter = sp.get('status') ?? 'all';

function setFilter(next: string) {
  const params = new URLSearchParams(sp.toString());
  params.set('status', next);
  router.replace(`/customers?${params.toString()}`);
}
```

Ao mudar filtro, **sempre resetar paginação** (`page=1`).

## 8. Estrutura de pastas

```
apps/web/src/
├── app/
│   ├── (protected)/           ← route group: exige sessão
│   │   ├── layout.tsx         ← redirect → /login + SWRConfig + AppShell
│   │   ├── dashboard/
│   │   ├── customers/
│   │   │   ├── page.tsx       ← lista
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/
│   │   │       ├── page.tsx   ← detalhe 360°
│   │   │       └── edit/page.tsx
│   │   └── crm/
│   │       └── tags/page.tsx
│   └── login/page.tsx
├── components/
│   ├── ui/                    ← primitivos (Button, Modal, Tabs, Badge, Spinner, Input)
│   ├── layout/AppShell.tsx    ← sidebar + topbar + permission-filtered nav
│   └── crm/                   ← componentes específicos do CRM (abas, forms)
└── lib/
    ├── api.ts                 ← cliente HTTP + ApiError + swrFetcher
    ├── session.ts             ← getSession/clearSession/hasPermission
    ├── cn.ts                  ← clsx + tailwind-merge
    ├── format.ts              ← formatadores (datas, CPF/CNPJ, telefone)
    └── crm-types.ts           ← espelho TS-only dos DTOs de @netx/shared
```

### Regras

- **Rotas protegidas** vão dentro de `(protected)/`. O layout do grupo
  garante sessão antes de renderizar children.
- **Primitivos UI** ficam em `components/ui/`, stateless no possível.
- **`lib/crm-types.ts`** existe pra evitar importar o runtime do Zod do
  `@netx/shared` no bundle do browser. Se adicionar novo DTO, espelhe
  aqui.

## 9. Styling

- Tailwind puro. Sem shadcn/ui. Sem component library.
- Use `cn()` de `lib/cn.ts` para combinar classes (`clsx` + `tailwind-merge`).
- Cores de marca: `brand-50` até `brand-900` (ver `tailwind.config.ts`). Se
  precisar de um tom novo, **adicione ao config antes de usar** — Tailwind
  faz tree-shaking baseado nas classes encontradas no source.
- Suporte a dark mode obrigatório: sempre pareie `text-slate-900
  dark:text-slate-100` etc.

## 10. Checklist pré-commit (frontend)

Antes de `git commit`:

1. [ ] `npm install` deixou o `package-lock.json` limpo (se mexeu em deps).
2. [ ] `npm run build --workspace web` passa sem erros.
3. [ ] `npm run lint --workspace web` passa.
4. [ ] Toda `router.push`/`router.replace`/`<Link>` usa template literal com
      prefixo conhecido (ver §1).
5. [ ] Nenhum callback custom usa `cond && fn()` como corpo (ver §2).
6. [ ] Dark mode testado nas views novas.
7. [ ] Permissões corretas gatando novos botões/páginas (ver §6).

## Referências

- [Next.js typedRoutes docs](https://nextjs.org/docs/app/api-reference/next-config-js/typedRoutes)
- [TypeScript special rules for `() => void`](https://www.typescriptlang.org/docs/handbook/2/functions.html#return-type-void)
- [SWR — useSWR](https://swr.vercel.app/docs/data-fetching)
