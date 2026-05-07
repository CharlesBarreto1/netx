# Tenancy no NetX

## Resumo executivo

**Cada instalação NetX atende exatamente uma ISP.** O `Tenant` no banco representa essa ISP — não é multi-tenant SaaS-style hospedado. O modelo de operação é "1 VPS = 1 ISP", deployado tipicamente na infra do próprio provedor.

A abstração `tenantId` em todas as queries existe por três razões além do isolamento atual:

1. **Cooperativas/revenda** — pequenos ISPs que compartilham infra (caso comum no interior do Brasil)
2. **Modo hosted opcional futuro** — se quisermos oferecer NetX gerenciado pra ISPs micro
3. **Higiene de queries** — todas as queries já carregam tenant scope, não tem caminho que misture dados

## Por que NÃO é SaaS multi-tenant compartilhado

Foi a primeira ideia, descartada por três motivos não-negociáveis:

### 1. Latência RADIUS

O Mikrotik fala com o FreeRADIUS em real-time, com timeout típico de 200ms. Se o servidor RADIUS está num data center diferente do BNG, fica:

- **Mesmo data center**: 1-3ms RTT, ok
- **Mesmo país**: 10-30ms RTT, ok mas margem apertada
- **Outro continente**: 100-200ms RTT, falha intermitente garantida

Pra ISP atender em escala, RADIUS precisa estar **na mesma rede** ou **adjacente** ao BNG. Isso impede SaaS hospedado central pra ISPs distribuídos pelo mundo.

### 2. Soberania de dados (LGPD/GDPR)

ISP tem dados sensíveis dos clientes (CPF/RUC, endereço, histórico financeiro). Brasileiros levam LGPD a sério, paraguaios a Lei 6534 também. Nenhum ISP sério aceita ver os dados deles num DB compartilhado com concorrentes — mesmo que tecnicamente isolado. É decisão comercial, não técnica.

Adicionalmente: backups, exports, auditoria — tudo fica mais simples quando o DB tem só uma operação dentro.

### 3. Blast radius

Bug no NetX afeta **uma única ISP** por instalação. Em SaaS compartilhado, um bug afeta todas. Mesmo argumento pra incidentes operacionais (DB lento, OOM, etc).

## Modelo atual

```
┌─────────────────────────┐
│ VPS / servidor da ISP   │
│                         │
│  ┌───────────────────┐  │
│  │ NetX (1 instância)│  │
│  │   ↓               │  │
│  │   Tenant único    │  │  ← representa a empresa toda
│  │   (a ISP)         │  │
│  └───────────────────┘  │
│                         │
│  ┌───────────────────┐  │
│  │ Postgres          │  │
│  │ Redis             │  │
│  │ RabbitMQ          │  │
│  │ FreeRADIUS        │  │
│  │ Nginx             │  │
│  └───────────────────┘  │
└─────────────────────────┘
```

Cada ISP roda esta stack inteira na sua própria VPS (gerenciada pela própria ISP ou contratada). NetX é distribuído como código — software local, não SaaS hospedado central.

## Conceitos relacionados que NÃO são "tenant"

### Filial / Sucursal / Branch

**Não modelado hoje.** Se uma ISP tem operação física em 3 cidades (Asunción, Encarnación, CDE), atualmente isso é resolvido com:

- Tag em `Customer.city` / `Customer.address`
- Filtro nas listas
- Múltiplos `CashRegister` (um por filial física)
- POPs de rede (`NetworkPop`) cadastrados por cidade

Quando aparecer cliente real com necessidade de **isolamento real entre filiais** (atendente da filial X só vê clientes da filial X, caixa segregado, RBAC por filial), aí promovemos pra entidade `Branch` separada — sem mexer no `Tenant`.

### POP de rede (`NetworkPop`)

Já existe. É site físico onde tem equipamento de rede (BNG, OLT, switch core). Filtra por `Equipment.popId`. Não tem implicação de RBAC.

### Caixa (`CashRegister`)

Já existe. Caixa de atendimento físico, com `Membership` de quais usuários podem operar. Cada filial física pode ter seu caixa.

## O que muda se promovermos hospedado um dia

Se virmos demanda real ("ISP de 50 clientes não quer manter VPS, pagaria mensalidade pra hospedar"), o caminho é:

1. NetX hosted vira um deployment compartilhado, com 1 instância servindo N tenants.
2. RADIUS continua local na ISP (via VPN ou agent dedicado), mas resto da app (backend + frontend + DB + RabbitMQ) é hospedado.
3. Subdomínio por tenant (`isp1.netx.app`, `isp2.netx.app`) ou seleção via JWT.
4. Política de retenção, backup e isolamento de dados precisa ser revista.

A engenharia atual já está pronta pra isso (todas as queries são tenant-scoped). Só não é o **product offering** do dia 1.

## Implicações pra desenvolvedores

- Toda nova entidade que acompanha dados do cliente deve ter `tenantId` no schema.
- Toda query nova deve filtrar por `tenantId` (RBAC + middleware do CLS já fazem isso por padrão, mas confirme).
- UI/textos visíveis dizem **"operação"** ou **"empresa"**, não **"tenant"**. Tenant é jargão interno.
- Documentação pública (READMEs, tooltips) usa **"sua empresa"** ou **"sua operação NetX"**.
- Internamente (código, comentários, schema), continuamos usando `Tenant` / `tenantId` por consistência histórica e pra não ter migration custosa.

## Onde "tenant" aparece (e fica) no código

- `Tenant` model em `prisma/schema.prisma`
- `tenantId` em todas as outras tabelas
- `/v1/tenants/me` endpoint (config da empresa)
- `TENANT_RESOLUTION_STRATEGY=jwt` (default — único usuário JWT carrega seu tenantId)
- `useTenantConfig()` hook do frontend
- `TenantConfigProvider`

Tudo isso permanece. **A mudança é vocabular, não estrutural.**
