# ADR 0007 — Autenticação e RBAC (usuários de acesso)

Status: aceito · Data: 2026-06-21 · Fase 5a

## Contexto

Até a Fase 4 o NMS rodava **sem autenticação**: todos os endpoints HTTP e o WebSocket do terminal
estavam abertos, e a auditoria (AGENTS.md §5) amarrava ações a um `actor` improvisado vindo do header
`x-actor` (valores `unknown`/`web`). Isso é a pendência crítica antes de produção: qualquer um na rede
conseguia ler dados, rodar playbooks e abrir SSH nos equipamentos.

## Decisão

Auth no `apps/api` (responsabilidade da API por AGENTS.md), com três papéis:

- **viewer** — só leitura (dashboards, métricas, eventos, snapshots, copiloto).
- **operator** — viewer + ações operacionais (playbooks, backup, terminal SSH, connectivity-test,
  discovery, sync SNMP, scan de anomalia).
- **admin** — tudo + gestão de usuários e do inventário (CRUD de device, credenciais).

Mecanismo:

1. **Senha**: hash **scrypt** nativo do Node (`scrypt:N:r:p:salt:hash`, base64). Sem dependência nativa
   (bcrypt/argon2) para não complicar a imagem Docker. Verificação em tempo constante (`timingSafeEqual`).
2. **Token**: **JWT HS256** (`@nestjs/jwt`), claims `{ sub, username, role }`, validade `JWT_TTL` (12h).
   Sem Passport — guard próprio lê `Authorization: Bearer`. `JWT_SECRET` é obrigatório no boot (Zod, ≥32 chars).
3. **Guards globais** (APP_GUARD, nesta ordem): `JwtAuthGuard` autentica e anexa `req.user`; `RolesGuard`
   autoriza via `@Roles(...)`. Rotas marcadas com `@Public()` (login, health) passam sem token.
4. **Terminal WS**: o handshake WS não leva headers, então o token vai na query (`?token=`). O proxy
   valida o JWT e exige operator/admin **antes** de abrir a ponte ao gateway; o `actor` da auditoria
   passa a ser o `username` do JWT (fim do `x-actor`).
5. **Seed**: no boot, se não há nenhum usuário, cria o admin de `ADMIN_USERNAME`/`ADMIN_PASSWORD`. Sem
   senha definida, gera uma aleatória e a imprime **uma vez** no log.
6. **Trava de segurança**: não é possível remover nem rebaixar/desativar o **último admin ativo**.

Modelo `User` (tabela `app_user`): `username` único, `passwordHash`, `role`, `active`, `lastLoginAt`.
O `username` é o `actor` da auditoria — toda ação contra equipamento rastreia a um humano (AGENTS.md §5).

## Consequências

- O front (`apps/web`) guarda o JWT em `localStorage`, manda em todo request, e em `401` limpa o token
  e volta ao login. A UI esconde controles de escrita para viewer (defesa em profundidade; a trava real
  é no backend).
- `verifyToken` revalida contra o banco a cada request: desativar/remover um usuário corta o acesso na hora.
- Pendências fora deste ADR: refresh token / rotação de `JWT_SECRET`, rate-limit no login, 2FA.

## Verificação (ao vivo, 2026-06-21)

`401` sem token; `403` para viewer em escrita/`/users`/backup; `/health` público (200); login emite JWT;
seed do admin no boot; trava do último admin (`400`). Teste unitário do round-trip scrypt em
`password.util.spec.ts`.
