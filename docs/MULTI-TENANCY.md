# Multi-tenancy — NetX

> **Leia este documento antes de criar qualquer entidade ou endpoint.**
> Vazamentos cross-tenant são o bug mais caro em SaaS B2B.

## Estratégia adotada: `tenant_id` + Row-Level Security

Todas as tabelas de negócio têm uma coluna `tenant_id` (UUID, NOT NULL) com FK para `tenants`. Toda query do Prisma é obrigada a incluir `tenantId` no `where` — isso é garantido por:

1. **CLS (Continuation Local Storage)** — toda request autenticada popula `tenantId` no contexto assíncrono.
2. **Repositórios base** — quando migrarmos para repositórios, o `tenantId` é injetado automaticamente.
3. **RLS no Postgres** — defesa em profundidade. Mesmo se um desenvolvedor esquecer o filtro, o Postgres bloqueia.

## Por que não schema-per-tenant?

| Critério | `tenant_id` | schema-per-tenant |
|----------|-------------|-------------------|
| Custo de criar tenant | ~zero | Migration por tenant |
| Onboarding (trial) | Instantâneo | Minutos |
| Evolução de schema | 1x por deploy | N × tenants |
| Isolamento físico | Médio (RLS) | Alto |
| Backup por cliente | Difícil | Fácil |
| Cross-tenant analytics | Fácil | Complexo |
| Escala > 10k tenants | Excelente | Ruim |

Para um SaaS ISP com alvo multinacional e onboarding via trial, **`tenant_id`** é a escolha certa. Tenants enterprise que exigem isolamento físico (regulatório) podem ser movidos para uma **instância dedicada** do mesmo schema.

## Resolução de tenant

Três modos de resolver o `tenantId` de uma request (config por env):

- **`subdomain`** — `slug.netx.app` → slug de tenant. Default em produção.
- **`header`** — `X-Tenant-Id: <slug>`. Útil para dev e APIs server-to-server.
- **`jwt`** — lido da claim `tid`. Usado após o login.

Veja `apps/core-service/src/common/tenant.middleware.ts`.

## Checklist para cada nova entidade

- [ ] A tabela tem coluna `tenant_id` (UUID, NOT NULL, FK)?
- [ ] Há índice composto `(tenant_id, ...)` nas buscas frequentes?
- [ ] A policy RLS foi adicionada na migration?
- [ ] O service valida que o recurso lido pertence ao `tenantId` atual?
- [ ] Os testes incluem um caso com 2 tenants para detectar vazamento?
- [ ] Eventos publicados no barramento incluem `tenantId`?

## Exemplo de policy RLS

```sql
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_customers ON customers
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

No connection setup do Prisma, executar antes de cada transação:

```sql
SET LOCAL app.current_tenant_id = '<tenantId do CLS>';
```

## Superadmin e cross-tenant

O papel `superadmin` (tenantId = NULL) é o único que pode:
- Criar tenants
- Listar tenants globais
- Impersonar usuários de outros tenants (com log crítico)

Toda ação cross-tenant **obrigatoriamente** gera `AuditLog` com `level: CRITICAL`.

## Testes

Todo service deve ter pelo menos um teste de "isolation leak":

```ts
it('não retorna dados de outro tenant', async () => {
  const tenantA = await createTenant();
  const tenantB = await createTenant();
  await service.createCustomer({ tenantId: tenantA.id, name: 'A' });
  const result = await service.listCustomers({ tenantId: tenantB.id });
  expect(result).toHaveLength(0);
});
```
