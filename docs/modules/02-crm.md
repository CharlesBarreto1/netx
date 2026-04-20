# Módulo 02 — CRM / Gestão de Clientes

> Status: **Fundação entregue** (v1) — PF/PJ, endereços, contatos, tags, consentimentos LGPD/GDPR, anotações e validadores plugáveis de documento.

Este módulo implementa o cadastro e gestão de clientes (PF e PJ) do provedor, com multi-tenancy estrito, trilha de auditoria e validação fiscal plugável por país.

---

## 1. Escopo desta entrega

| Área | Entregue | Observações |
|------|----------|-------------|
| Cadastro PF (INDIVIDUAL) | ✅ | `firstName`, `lastName`, `birthDate`, `gender`, `motherName` |
| Cadastro PJ (COMPANY) | ✅ | `companyName` (razão), `tradeName` (fantasia), `foundedAt`, inscrições estadual/municipal |
| Identificação fiscal | ✅ | Multi-país via `taxId + taxIdType + taxIdCountry` |
| Validação de documento | ✅ | **BR:** CPF, CNPJ (módulo 11) · **PY:** CI (estrutural), RUC (módulo 11) |
| Endereços | ✅ | BILLING/SERVICE/SHIPPING, geocoord opcional, único primário por cliente |
| Contatos | ✅ | EMAIL/PHONE/MOBILE/WHATSAPP/TELEGRAM; normalização e opt-in |
| Tags | ✅ | Catálogo por tenant + atribuição N..N |
| Consentimentos | ✅ | Trilha imutável LGPD/GDPR com IP e User-Agent |
| Anotações | ✅ | Histórico livre, pinadas |
| Soft delete | ✅ | Via `deletedAt` + `status = CHURNED` |
| Score de crédito | ⏳ | Previsto para próxima iteração (integração Serasa/Equifax) |
| Portal do Cliente | ⏳ | Módulo 18 |
| Funil de vendas / pipeline | ⏳ | Próxima iteração do CRM |

---

## 2. Modelo de dados

Todas as entidades têm `tenantId` obrigatório com FK para `tenants` (Cascade). Os índices abaixo foram escolhidos para cobrir listagens, buscas textuais e filtros comuns.

### `customers`
- `id` (UUID)
- `tenantId` (FK)
- `code` (humano opcional — `CLI-000123`), único por tenant
- `type` — `INDIVIDUAL | COMPANY`
- `status` — `LEAD | PROSPECT | ACTIVE | SUSPENDED | INACTIVE | CHURNED`
- Campos PF: `firstName`, `lastName`, `birthDate`, `gender`, `motherName`
- Campos PJ: `companyName`, `tradeName`, `foundedAt`, `stateRegistration`, `municipalRegistration`
- `displayName` — **desnormalizado** para busca (PF = nome completo, PJ = fantasia || razão)
- `taxId`, `taxIdType`, `taxIdCountry` (ISO-2), `taxIdVerifiedAt`
- `primaryEmail` (citext), `primaryPhone`, `preferredLanguage`, `timezone`
- `shortNote`, `metadata` (JSON livre)
- Auditoria: `createdById`, `updatedById`, `createdAt`, `updatedAt`, `deletedAt`

**Restrições únicas:**
- `(tenantId, code)` — evita colisão de código humano
- `(tenantId, taxId, taxIdType)` — evita dois clientes com o mesmo documento

### `customer_addresses`, `customer_contacts`
Endereços e contatos; cada um com flag `isPrimary` (1 primário por cliente, garantido em transação).

### `customer_tags` + `customer_tag_assignments`
Catálogo de tags por tenant. Assignment tem `assignedById` para trilha.

### `customer_consents`
Cada evento de consentimento é um **registro novo**, nunca sobrescrito. Armazenamos `purpose`, `status`, `method`, `grantedAt`, `revokedAt`, `expiresAt`, `policyVersion`, `sourceIp` (inet), `sourceUserAgent`, `evidenceUrl`. O "estado atual" é derivado do último registro por `(customerId, purpose)`.

### `customer_notes`
Notas livres, com `pinned` e autoria. Edição/remoção permitida apenas ao autor original.

---

## 3. Validação de documentos fiscais

O projeto define um **registry plugável** em `packages/shared/src/validators/documents/`. Cada par `(country, type)` pode ter um validator próprio, e o serviço consulta antes de gravar.

| País | Tipo | Estratégia |
|------|------|-----------|
| BR | CPF | Módulo 11 com pesos 10→2 e 11→2 |
| BR | CNPJ | Módulo 11 com pesos `[5,4,3,2,9,8,7,6,5,4,3,2]` e `[6,…,2]` |
| PY | CI | Estrutural (6–9 dígitos) — Paraguai não publica algoritmo de dígito verificador |
| PY | RUC | Módulo 11 cíclico sobre a parte base, DV com regra 2/10→0, 11→0 |

### Contrato do validador
```ts
interface DocumentValidator {
  validate(value: string): DocumentValidationResult;
}

interface DocumentValidationResult {
  valid: boolean;
  normalized: string;   // forma canônica (somente dígitos)
  formatted?: string;   // opcional, para UI (ex.: 529.982.247-25)
  reason?: string;
}
```

### Registry
```ts
import { validateDocument, isDocumentTypeSupported } from '@netx/shared';

if (isDocumentTypeSupported('BR', 'CPF')) {
  const r = validateDocument('BR', 'CPF', '529.982.247-25');
  // r = { valid: true, normalized: '52998224725', formatted: '529.982.247-25' }
}
```

### Fallback
Se `isDocumentTypeSupported(country, type)` retorna `false` **ou** o validador lança `UnsupportedDocumentTypeError`, o serviço grava o documento sem `taxIdVerifiedAt` — permite onboarding de países sem validator plugado sem bloquear a operação. Para tipo `OTHER` isso é o caminho normal.

### Adicionar novo país
1. Crie `packages/shared/src/validators/documents/<pais>-<tipo>.ts` exportando uma função que retorne `DocumentValidator`.
2. Registre em `packages/shared/src/validators/documents/index.ts` no Map `validators`.
3. Adicione fixtures de teste em `validators.spec.ts`.
4. Estenda o enum `TaxIdType` no Prisma e no Zod se o tipo ainda não existe.

---

## 4. Endpoints HTTP

Todos sob `/api/v1` do API Gateway. Todos exigem Bearer JWT e `tenantId` é resolvido do principal autenticado.

### Clientes
| Método | Rota | Permissão |
|--------|------|-----------|
| GET | `/customers` | `customers.read` |
| GET | `/customers/:id` | `customers.read` |
| POST | `/customers` | `customers.create` |
| PATCH | `/customers/:id` | `customers.update` |
| DELETE | `/customers/:id` | `customers.delete` |
| POST | `/customers/:id/tags` | `customers.tags.manage` |
| DELETE | `/customers/:id/tags/:tagId` | `customers.tags.manage` |

### Endereços (nested)
| Método | Rota | Permissão |
|--------|------|-----------|
| GET / POST / PATCH / DELETE | `/customers/:customerId/addresses[/:addressId]` | `customers.read` / `customers.update` |

### Contatos (nested)
| Método | Rota | Permissão |
|--------|------|-----------|
| GET / POST / PATCH / DELETE | `/customers/:customerId/contacts[/:contactId]` | `customers.read` / `customers.update` |

### Consentimentos (nested)
| Método | Rota | Permissão |
|--------|------|-----------|
| GET | `/customers/:customerId/consents` | `customers.read` |
| GET | `/customers/:customerId/consents/current` | `customers.read` |
| POST | `/customers/:customerId/consents` | `customers.consents.manage` |

### Anotações (nested)
| Método | Rota | Permissão |
|--------|------|-----------|
| GET / POST / PATCH / DELETE | `/customers/:customerId/notes[/:noteId]` | `customers.read` / `customers.notes.manage` |

### Tags (catálogo)
| Método | Rota | Permissão |
|--------|------|-----------|
| GET / POST / PATCH / DELETE | `/crm/tags[/:id]` | `customers.read` / `customers.tags.manage` |

---

## 5. Exemplos de uso

### Criar cliente PF com CPF válido
```http
POST /api/v1/customers
Authorization: Bearer <token>
Content-Type: application/json

{
  "type": "INDIVIDUAL",
  "firstName": "Maria",
  "lastName": "Souza",
  "birthDate": "1985-07-12",
  "taxId": {
    "type": "CPF",
    "country": "BR",
    "value": "529.982.247-25"
  },
  "primaryEmail": "maria@example.com",
  "primaryPhone": "+5511999998888",
  "preferredLanguage": "pt-BR",
  "timezone": "America/Sao_Paulo"
}
```

Resposta `201`:
```json
{
  "id": "...",
  "displayName": "Maria Souza",
  "taxId": "52998224725",
  "taxIdType": "CPF",
  "taxIdCountry": "BR",
  "taxIdVerifiedAt": "2026-04-20T12:00:00.000Z",
  "status": "LEAD"
}
```

### Criar cliente PJ paraguaia com RUC
```http
POST /api/v1/customers
{
  "type": "COMPANY",
  "companyName": "Servicios del Sur S.A.",
  "tradeName": "SDS",
  "taxId": { "type": "RUC", "country": "PY", "value": "80018923-3" },
  "primaryEmail": "contacto@sds.py"
}
```

### Registrar consentimento LGPD
```http
POST /api/v1/customers/{id}/consents
{
  "purpose": "MARKETING_WHATSAPP",
  "status": "GRANTED",
  "method": "WEB_FORM",
  "policyVersion": "privacy-2026-01",
  "evidenceUrl": "https://evidence.s3/abc.pdf"
}
```
O IP do requisitante e o User-Agent são gravados automaticamente.

### Listar com filtros
```
GET /api/v1/customers?search=maria&status=ACTIVE&country=BR&taxIdType=CPF&page=1&pageSize=20
```

Busca cobre: `displayName` (insensitive), `primaryEmail`, `primaryPhone`, `taxId` (dígitos) e `code`.

---

## 6. Multi-tenancy

- Todas as queries filtram por `tenantId`, sempre vindo do JWT via `CurrentUser()`.
- Assignments de tag validam que `tagId` pertence ao mesmo tenant antes de persistir.
- Índices compostos sempre começam por `tenantId` para garantir particionamento lógico eficiente.

---

## 7. Auditoria

Ações geram registros em `audit_logs` via `AuditService`:

| Ação | Quando |
|------|--------|
| `customer.created` | POST /customers |
| `customer.updated` | PATCH /customers/:id |
| `customer.deleted` | DELETE /customers/:id |
| `customer.address.*` | CRUD de endereço |
| `customer.contact.*` | CRUD de contato |
| `customer.tag.*` | CRUD de catálogo de tags |
| `customer.tags.assigned` / `.removed` | Assignments N..N |
| `customer.consent.recorded` | POST /consents |
| `customer.note.*` | CRUD de anotação |

`beforeState` e `afterState` são JSON parciais — mantemos apenas o delta relevante para evitar explosão de tamanho.

---

## 8. Migração

A migração Prisma correspondente deve ser gerada com:

```bash
cd apps/core-service
npx prisma migrate dev --name crm_foundation --create-only
# revisar o SQL gerado em prisma/migrations/<ts>_crm_foundation/migration.sql
npx prisma migrate deploy   # em ambientes não-dev
```

A migração cria 7 tabelas (`customers`, `customer_addresses`, `customer_contacts`, `customer_tags`, `customer_tag_assignments`, `customer_consents`, `customer_notes`) e 6 novos enums. Usa `citext` para `primary_email` (já disponível pelo `CITEXT` extension do Core) e `inet` para `customer_consents.source_ip`.

Após migrar:
```bash
npm run db:seed
```
Isso popula as novas permissões CRM (`customers.create`, `customers.read`, `customers.update`, `customers.delete`, `customers.tags.manage`, `customers.consents.manage`, `customers.notes.manage`) e as anexa aos papéis `admin` (todas), `operator` (CRUD sem delete + tags/consents/notes) e `viewer` (somente `customers.read`).

---

## 9. Próximos passos do CRM

1. **Pipeline de vendas** — entidades `Lead`, `Opportunity`, `Stage`, `Activity`
2. **Score de crédito** — integração plugável (Serasa/Equifax/Boa Vista), com cache por 30 dias
3. **Segmentação avançada** — filtros salvos e exportação para campanhas
4. **Campanhas** — disparo via Omnichannel (Módulo 13) com opt-in respeitado
5. **Geolocalização** — rota `/customers/geo` para mapa GIS do frontend
6. **Importação em massa** — CSV/XLSX com validação linha a linha
7. **Eventos de domínio** — publicar `customer.created/updated/deleted` no barramento (RabbitMQ) para outros módulos
