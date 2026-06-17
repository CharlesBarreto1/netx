/**
 * Prisma seed script — creates baseline data to bootstrap a fresh database:
 *
 *   - System permissions (Module 1: Core)
 *   - System roles (superadmin, admin, operator, viewer)
 *   - A default tenant with an admin user
 *
 * Run with:  npm run db:seed
 *
 * Copyright (c) 2024-2026 NETX DESENVOLVIMENTO E TECNOLOGIA LTDA — CNPJ 57.118.236/0001-44.
 * Proprietary — see /LICENSE.
 *
 * @provenance MDg0NzI5Njg5MDE=
 */
import { PrismaClient, TenantStatus, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// -----------------------------------------------------------------------------
// Permission catalog for Module 1 (Core). Each module will extend this list.
// -----------------------------------------------------------------------------
const corePermissions = [
  // Tenant administration
  { code: 'tenants.read', module: 'core', resource: 'tenants', action: 'read' },
  { code: 'tenants.update', module: 'core', resource: 'tenants', action: 'update' },
  { code: 'tenants.settings.manage', module: 'core', resource: 'tenant_settings', action: 'manage' },
  { code: 'tenants.features.manage', module: 'core', resource: 'tenant_features', action: 'manage' },

  // Users
  { code: 'users.create', module: 'core', resource: 'users', action: 'create' },
  { code: 'users.read', module: 'core', resource: 'users', action: 'read' },
  { code: 'users.update', module: 'core', resource: 'users', action: 'update' },
  { code: 'users.delete', module: 'core', resource: 'users', action: 'delete' },
  { code: 'users.invite', module: 'core', resource: 'users', action: 'invite' },
  { code: 'users.impersonate', module: 'core', resource: 'users', action: 'impersonate' },

  // Roles and permissions
  { code: 'roles.create', module: 'core', resource: 'roles', action: 'create' },
  { code: 'roles.read', module: 'core', resource: 'roles', action: 'read' },
  { code: 'roles.update', module: 'core', resource: 'roles', action: 'update' },
  { code: 'roles.delete', module: 'core', resource: 'roles', action: 'delete' },
  { code: 'roles.assign', module: 'core', resource: 'roles', action: 'assign' },

  // API Keys
  { code: 'api_keys.create', module: 'core', resource: 'api_keys', action: 'create' },
  { code: 'api_keys.read', module: 'core', resource: 'api_keys', action: 'read' },
  { code: 'api_keys.revoke', module: 'core', resource: 'api_keys', action: 'revoke' },

  // Audit
  { code: 'audit.read', module: 'core', resource: 'audit_logs', action: 'read' },
];

// -----------------------------------------------------------------------------
// Permission catalog for Module 2 (CRM / Clientes)
// -----------------------------------------------------------------------------
const crmPermissions = [
  { code: 'customers.create', module: 'crm', resource: 'customers', action: 'create' },
  { code: 'customers.read', module: 'crm', resource: 'customers', action: 'read' },
  { code: 'customers.update', module: 'crm', resource: 'customers', action: 'update' },
  { code: 'customers.delete', module: 'crm', resource: 'customers', action: 'delete' },
  { code: 'customers.tags.manage', module: 'crm', resource: 'customer_tags', action: 'manage' },
  { code: 'customers.consents.manage', module: 'crm', resource: 'customer_consents', action: 'manage' },
  { code: 'customers.notes.manage', module: 'crm', resource: 'customer_notes', action: 'manage' },

  // Vendas — pipelines/deals/activities
  { code: 'pipelines.manage', module: 'crm', resource: 'pipelines', action: 'manage' },
  { code: 'deals.read', module: 'crm', resource: 'deals', action: 'read' },
  { code: 'deals.write', module: 'crm', resource: 'deals', action: 'write' },
  { code: 'deals.delete', module: 'crm', resource: 'deals', action: 'delete' },
  { code: 'activities.read', module: 'crm', resource: 'activities', action: 'read' },
  { code: 'activities.write', module: 'crm', resource: 'activities', action: 'write' },
  { code: 'activities.delete', module: 'crm', resource: 'activities', action: 'delete' },
];

// -----------------------------------------------------------------------------
// Permission catalog for Module 3 (Contratos)
// -----------------------------------------------------------------------------
const contractsPermissions = [
  { code: 'contracts.read', module: 'contracts', resource: 'contracts', action: 'read' },
  { code: 'contracts.write', module: 'contracts', resource: 'contracts', action: 'write' },
  { code: 'contracts.delete', module: 'contracts', resource: 'contracts', action: 'delete' },
  { code: 'contracts.admin', module: 'contracts', resource: 'contracts', action: 'admin' },
  // contracts.wifi.reveal: revelar a senha Wi-Fi decifrada (cliente esqueceu).
  // Sensível — decifra PII e é auditado por revelação.
  { code: 'contracts.wifi.reveal', module: 'contracts', resource: 'contracts', action: 'wifi.reveal' },
  // plans.manage: CRUD do catálogo de planos de internet (configuração).
  { code: 'plans.manage', module: 'contracts', resource: 'plans', action: 'manage' },
];

// -----------------------------------------------------------------------------
// Permission catalog — Ordens de Serviço (O.S)
// -----------------------------------------------------------------------------
const serviceOrdersPermissions = [
  { code: 'service_orders.read', module: 'service_orders', resource: 'service_orders', action: 'read' },
  { code: 'service_orders.write', module: 'service_orders', resource: 'service_orders', action: 'write' },
  { code: 'service_orders.delete', module: 'service_orders', resource: 'service_orders', action: 'delete' },
  // Cadastro de motivos da O.S (config do tenant).
  { code: 'service_order_reasons.manage', module: 'service_orders', resource: 'service_order_reasons', action: 'manage' },
];

// -----------------------------------------------------------------------------
// Permission catalog — Finance (caixas + cobranças avulsas + descontos)
// -----------------------------------------------------------------------------
const financePermissions = [
  // Cadastro de caixas (admin).
  { code: 'cash_registers.manage', module: 'finance', resource: 'cash_registers', action: 'manage' },
  // Cobranças avulsas.
  { code: 'finance.charges.read', module: 'finance', resource: 'charges', action: 'read' },
  { code: 'finance.charges.write', module: 'finance', resource: 'charges', action: 'write' },
  { code: 'finance.charges.delete', module: 'finance', resource: 'charges', action: 'delete' },
  // Contas a pagar (parcelas de compra de fornecedor — à vista/a prazo).
  { code: 'finance.payables.read', module: 'finance', resource: 'payables', action: 'read' },
  { code: 'finance.payables.write', module: 'finance', resource: 'payables', action: 'write' },
  // Aplicar desconto em pagamento (sensível — não vai pro operator default).
  { code: 'finance.discount.apply', module: 'finance', resource: 'payments', action: 'discount' },
];

// -----------------------------------------------------------------------------
// Permission catalog — Reports
// -----------------------------------------------------------------------------
const reportsPermissions = [
  { code: 'reports.read', module: 'reports', resource: 'reports', action: 'read' },
];

// -----------------------------------------------------------------------------
// Permission catalog — Backups (admin-only)
// -----------------------------------------------------------------------------
const backupsPermissions = [
  { code: 'backups.manage', module: 'core', resource: 'backups', action: 'manage' },
];

// -----------------------------------------------------------------------------
// Permission catalog — Network (POPs + Equipamentos)
// -----------------------------------------------------------------------------
const networkPermissions = [
  { code: 'network.read', module: 'network', resource: 'network', action: 'read' },
  { code: 'network.write', module: 'network', resource: 'network', action: 'write' },
  { code: 'network.delete', module: 'network', resource: 'network', action: 'delete' },
];

// -----------------------------------------------------------------------------
// Permission catalog — Estoque
// -----------------------------------------------------------------------------
const stockPermissions = [
  // stock.read: ver produtos, fornecedores, locais (filtrados pela ACL), kardex
  { code: 'stock.read',            module: 'stock', resource: 'stock', action: 'read' },
  // stock.write: criar/editar produto/fornecedor + transferências + ACL-write em local
  { code: 'stock.write',           module: 'stock', resource: 'stock', action: 'write' },
  // stock.delete: remover (soft) produto/fornecedor que ainda não tem histórico
  { code: 'stock.delete',          module: 'stock', resource: 'stock', action: 'delete' },
  // stock.purchase.create: registrar entrada por compra
  { code: 'stock.purchase.create', module: 'stock', resource: 'purchases', action: 'create' },
  // stock.purchase.update: editar/corrigir compra lançada errada — reverte e
  // reaplica (mesmas travas do delete), então é tão administrativo quanto ele
  { code: 'stock.purchase.update', module: 'stock', resource: 'purchases', action: 'update' },
  // stock.purchase.delete: excluir/reverter compra lançada errada (só se nada movimentou)
  { code: 'stock.purchase.delete', module: 'stock', resource: 'purchases', action: 'delete' },
  // stock.adjust: ajustes de inventário (contagem, perda, descarte, achado)
  { code: 'stock.adjust',          module: 'stock', resource: 'stock', action: 'adjust' },
  // stock.admin: gerenciar locais + ACL de usuário por local. Bypassa filtro de
  // ACL nas listagens — vê todos os locais do tenant.
  { code: 'stock.admin',           module: 'stock', resource: 'stock', action: 'admin' },
];

// -----------------------------------------------------------------------------
// Permission catalog — Frota (veículos, motoristas, despesas, manutenção, GPS)
// -----------------------------------------------------------------------------
const fleetPermissions = [
  // fleet.read: ver veículos, motoristas, despesas, manutenções
  { code: 'fleet.read',                module: 'fleet', resource: 'fleet',       action: 'read'   },
  // fleet.write: criar/editar veículos e motoristas
  { code: 'fleet.write',               module: 'fleet', resource: 'fleet',       action: 'write'  },
  // fleet.delete: remover (soft) veículo/motorista — decisão administrativa
  { code: 'fleet.delete',              module: 'fleet', resource: 'fleet',       action: 'delete' },
  // fleet.expense.create: lançar/editar/remover despesa (integra no caixa)
  { code: 'fleet.expense.create',      module: 'fleet', resource: 'expenses',    action: 'create' },
  // fleet.maintenance.manage: gerenciar planos preventivos + registrar manutenção
  { code: 'fleet.maintenance.manage',  module: 'fleet', resource: 'maintenance', action: 'manage' },
  // fleet.live.read: ver o mapa "Ao vivo" (posições GPS via Traccar)
  { code: 'fleet.live.read',           module: 'fleet', resource: 'live',        action: 'read'   },
];

// -----------------------------------------------------------------------------
// Permission catalog — RH (Recursos Humanos / colaboradores)
// -----------------------------------------------------------------------------
const hrPermissions = [
  // hr.read: ver colaboradores, documentos, ponto, espelho
  { code: 'hr.read',               module: 'hr', resource: 'hr',          action: 'read'   },
  // hr.write: criar/editar colaboradores (e provisionar login)
  { code: 'hr.write',              module: 'hr', resource: 'hr',          action: 'write'  },
  // hr.delete: desligar/remover (soft) colaborador
  { code: 'hr.delete',             module: 'hr', resource: 'hr',          action: 'delete' },
  // hr.payroll.manage: holerites + pagamentos (integra no caixa) + relatórios de folha
  { code: 'hr.payroll.manage',     module: 'hr', resource: 'payroll',     action: 'manage' },
  // hr.timeclock.manage: lançar ponto manual + aprovar/rejeitar correções
  { code: 'hr.timeclock.manage',   module: 'hr', resource: 'timeclock',   action: 'manage' },
  // hr.documents.manage: anexar/assinar/remover documentos do colaborador
  { code: 'hr.documents.manage',   module: 'hr', resource: 'documents',   action: 'manage' },
  // hr.blog.manage: gerenciar notícias/blog da empresa
  { code: 'hr.blog.manage',        module: 'hr', resource: 'blog',        action: 'manage' },
  // self.read: acesso ao portal do colaborador (self-service /me). Não controla
  // os endpoints /hr/me (que só exigem login) — é só pra exibir o menu do portal.
  { code: 'self.read',             module: 'hr', resource: 'self',        action: 'read'   },
];

// -----------------------------------------------------------------------------
// Permission catalog — Provisionamento (OLT/ONT + TR-069 ACS)
// -----------------------------------------------------------------------------
const provisioningPermissions = [
  // olts.admin: CRUD de OLTs + test-connection (credenciais sensíveis, restrito)
  { code: 'olts.admin',          module: 'provisioning', resource: 'olts',          action: 'admin' },
  // provisioning.read: listar contratos PENDING_INSTALL + status ONT (técnico vê)
  { code: 'provisioning.read',   module: 'provisioning', resource: 'provisioning', action: 'read'  },
  // provisioning.write: ativar cliente em campo (técnico — orquestra OLT+RADIUS+TR069)
  { code: 'provisioning.write',  module: 'provisioning', resource: 'provisioning', action: 'write' },
  // tr069.admin: gerenciar ACS, cancelar tasks, ver devices (admin)
  { code: 'tr069.admin',         module: 'provisioning', resource: 'tr069',         action: 'admin' },
];

// -----------------------------------------------------------------------------
// Permission catalog — Ufinet (rede neutra PY, API TMF)
// -----------------------------------------------------------------------------
const ufinetPermissions = [
  // config da OLT-orquestradora (credenciais) já é olts.admin; aqui só o estado
  // ufinet.orders.read: ver status dos serviços Ufinet (Hub do Atendente)
  { code: 'ufinet.orders.read',  module: 'ufinet', resource: 'ufinet_services', action: 'read'  },
  // ufinet.orders.retry: reprocessar um serviço FAILED
  { code: 'ufinet.orders.retry', module: 'ufinet', resource: 'ufinet_services', action: 'retry' },
];

// -----------------------------------------------------------------------------
// Permission catalog — EFI / EfiPay (pagamentos BR: Pix imediato + Bolix)
// -----------------------------------------------------------------------------
const efiPermissions = [
  // Config (credenciais/certificado por tenant — sensível, admin).
  { code: 'efi.config.read',  module: 'efi', resource: 'efi_config',  action: 'read'  },
  { code: 'efi.config.write', module: 'efi', resource: 'efi_config',  action: 'write' },
  // Cobranças (gerar Pix/Bolix sobre faturas; ver status).
  { code: 'efi.charges.read',  module: 'efi', resource: 'efi_charges', action: 'read'  },
  { code: 'efi.charges.write', module: 'efi', resource: 'efi_charges', action: 'write' },
];

// -----------------------------------------------------------------------------
// Permission catalog — BTG Pactual (pagamentos BR: boleto + Pix + Pix Automático)
// -----------------------------------------------------------------------------
const btgPermissions = [
  // Config (credenciais OAuth + consentimento da conta PJ — sensível, admin).
  { code: 'btg.config.read',  module: 'btg', resource: 'btg_config',  action: 'read'  },
  { code: 'btg.config.write', module: 'btg', resource: 'btg_config',  action: 'write' },
  // Cobranças (gerar boleto/Pix sobre faturas; ver status).
  { code: 'btg.charges.read',  module: 'btg', resource: 'btg_charges', action: 'read'  },
  { code: 'btg.charges.write', module: 'btg', resource: 'btg_charges', action: 'write' },
];

// -----------------------------------------------------------------------------
// Permission catalog — Chat / Atendimento (WhatsApp via Evolution API)
// -----------------------------------------------------------------------------
const chatPermissions = [
  { code: 'chat.read',   module: 'chat', resource: 'chat', action: 'read'   },
  { code: 'chat.send',   module: 'chat', resource: 'chat', action: 'send'   },
  { code: 'chat.assign', module: 'chat', resource: 'chat', action: 'assign' },
  // chat.audit = ver conversas atribuídas a OUTROS operadores (rastreado em audit log)
  { code: 'chat.audit',  module: 'chat', resource: 'chat', action: 'audit'  },
  // chat.admin = gerenciar instâncias Evolution + conexão WhatsApp
  { code: 'chat.admin',  module: 'chat', resource: 'chat', action: 'admin'  },

  // SIFEN — Fatura eletrônica Paraguay (DNIT / e-Kuatiá)
  { code: 'sifen.read',   module: 'sifen', resource: 'sifen', action: 'read'   },
  // sifen.emit = disparar emissão manual de DE (factura, NC, ND)
  { code: 'sifen.emit',   module: 'sifen', resource: 'sifen', action: 'emit'   },
  // sifen.cancel = cancelar DTE aprovado (janela 48h)
  { code: 'sifen.cancel', module: 'sifen', resource: 'sifen', action: 'cancel' },
  // sifen.admin = configurar certificado, timbrado, ambiente, reemissão em massa
  { code: 'sifen.admin',  module: 'sifen', resource: 'sifen', action: 'admin'  },
  // sifen.config.read/write = ler/escrever config SIFEN do tenant (RUC, timbrado,
  // CSC, certificado .p12). Granular pra permitir financeiro ler config sem
  // poder mexer no certificado.
  { code: 'sifen.config.read',  module: 'sifen', resource: 'sifen_config', action: 'read'  },
  { code: 'sifen.config.write', module: 'sifen', resource: 'sifen_config', action: 'write' },

  // Mapeamento — visualização geográfica de clientes/rede/técnicos/veículos
  { code: 'mapping.read', module: 'mapping', resource: 'mapping', action: 'read' },
];

// Role → permission mapping
const systemRoles = [
  {
    name: 'superadmin',
    description: 'Acesso total, incluindo administração cross-tenant',
    priority: 0,
    permissions: '*', // all
  },
  {
    name: 'admin',
    description: 'Administrador do tenant — gerencia usuários, papéis e configurações',
    priority: 10,
    permissions: [
      'tenants.read',
      'tenants.update',
      'tenants.settings.manage',
      'users.create',
      'users.read',
      'users.update',
      'users.delete',
      'users.invite',
      'roles.create',
      'roles.read',
      'roles.update',
      'roles.delete',
      'roles.assign',
      'api_keys.create',
      'api_keys.read',
      'api_keys.revoke',
      'audit.read',
      // CRM — clientes
      'customers.create',
      'customers.read',
      'customers.update',
      'customers.delete',
      'customers.tags.manage',
      'customers.consents.manage',
      'customers.notes.manage',
      // CRM — vendas
      'pipelines.manage',
      'deals.read',
      'deals.write',
      'deals.delete',
      'activities.read',
      'activities.write',
      'activities.delete',
      // Contratos
      'contracts.read',
      'contracts.write',
      'contracts.delete',
      'contracts.admin',
      'contracts.wifi.reveal',
      'plans.manage',
      // Ordens de Serviço
      'service_orders.read',
      'service_orders.write',
      'service_orders.delete',
      'service_order_reasons.manage',
      // Finance
      'cash_registers.manage',
      'finance.charges.read',
      'finance.charges.write',
      'finance.charges.delete',
      'finance.payables.read',
      'finance.payables.write',
      'finance.discount.apply',
      // EFI — pagamentos BR (config + cobranças)
      'efi.config.read',
      'efi.config.write',
      'efi.charges.read',
      'efi.charges.write',
      // BTG — pagamentos BR (config + cobranças)
      'btg.config.read',
      'btg.config.write',
      'btg.charges.read',
      'btg.charges.write',
      'reports.read',
      'backups.manage',
      // Rede
      'network.read',
      'network.write',
      'network.delete',
      // Estoque (admin tem tudo, inclusive gerenciar locais e ACL)
      'stock.read',
      'stock.write',
      'stock.delete',
      'stock.purchase.create',
      'stock.purchase.update',
      'stock.purchase.delete',
      'stock.adjust',
      'stock.admin',
      // Frota (admin tem tudo)
      'fleet.read',
      'fleet.write',
      'fleet.delete',
      'fleet.expense.create',
      'fleet.maintenance.manage',
      'fleet.live.read',
      // RH (admin tem tudo)
      'hr.read',
      'hr.write',
      'hr.delete',
      'hr.payroll.manage',
      'hr.timeclock.manage',
      'hr.documents.manage',
      'hr.blog.manage',
      'self.read',
      // Provisionamento (admin gerencia OLTs e ACS)
      'olts.admin',
      'provisioning.read',
      'provisioning.write',
      'tr069.admin',
      // Ufinet — status + reprocessar serviços ópticos
      'ufinet.orders.read',
      'ufinet.orders.retry',
      // Chat / Atendimento (admin tem tudo, inclusive auditoria)
      'chat.read',
      'chat.send',
      'chat.assign',
      'chat.audit',
      'chat.admin',
      // SIFEN — admin gerencia certificado e pode cancelar/emitir
      'sifen.read',
      'sifen.emit',
      'sifen.cancel',
      'sifen.admin',
      'sifen.config.read',
      'sifen.config.write',
      'mapping.read',
    ],
  },
  {
    name: 'operator',
    description: 'Operação diária — usuários, clientes e leitura de auditoria',
    priority: 50,
    permissions: [
      'tenants.read',
      'users.read',
      'users.update',
      'users.invite',
      'roles.read',
      'audit.read',
      // CRM (operação)
      'customers.create',
      'customers.read',
      'customers.update',
      'customers.tags.manage',
      'customers.consents.manage',
      'customers.notes.manage',
      // CRM — vendas (operação diária; sem excluir pipelines)
      'deals.read',
      'deals.write',
      'activities.read',
      'activities.write',
      // Contratos (operação)
      'contracts.read',
      'contracts.write',
      'contracts.wifi.reveal',
      // Ordens de Serviço (operação — sem deletar nem mexer em motivos)
      'service_orders.read',
      'service_orders.write',
      // Finance (operação — pode criar/baixar cobrança, sem mexer em caixa
      // nem aplicar desconto)
      'finance.charges.read',
      'finance.charges.write',
      // Contas a pagar — operador consulta e dá baixa em parcela (a compra
      // que gera as parcelas ele já lança via stock.purchase.create)
      'finance.payables.read',
      'finance.payables.write',
      // EFI — operador gera/consulta cobranças (sem mexer em credenciais)
      'efi.charges.read',
      'efi.charges.write',
      // BTG — operador gera/consulta cobranças (sem mexer em credenciais)
      'btg.charges.read',
      'btg.charges.write',
      // Reports (operador também pode ver)
      'reports.read',
      // Rede — só leitura pra operador
      'network.read',
      // Estoque — operador faz leitura, compra, ajuste, transferência.
      // Sem `stock.admin` (gerenciar locais e ACL fica pro admin) e sem `stock.delete`
      // (remover catálogo é decisão administrativa).
      'stock.read',
      'stock.write',
      'stock.purchase.create',
      'stock.adjust',
      // Frota — operação cuida de veículos, despesas e manutenção; sem delete.
      'fleet.read',
      'fleet.write',
      'fleet.expense.create',
      'fleet.maintenance.manage',
      'fleet.live.read',
      // RH — operação consulta colaboradores/ponto e aprova correções; folha
      // (holerites/pagamentos) fica pro admin. Acessa o próprio portal.
      'hr.read',
      'hr.timeclock.manage',
      'hr.documents.manage',
      'self.read',
      // Provisionamento — técnico ativa cliente em campo, lê pendentes.
      // Sem `olts.admin` (creds SSH/API ficam só com admin) nem `tr069.admin`.
      'provisioning.read',
      'provisioning.write',
      // Ufinet — operador acompanha e reprocessa serviços ópticos (Hub do Atendente)
      'ufinet.orders.read',
      'ufinet.orders.retry',
      // Chat (operador atende: lê, envia, atribui — sem auditar terceiros nem admin)
      'chat.read',
      'chat.send',
      'chat.assign',
      // SIFEN — operador pode ver e disparar emissão manual; cancelamento e
      // config de certificado ficam pro admin.
      'sifen.read',
      'sifen.emit',
      // Operador pode LER config (sabe se está habilitado/ambiente test/prod),
      // mas não pode mexer (sem .config.write).
      'sifen.config.read',
      'mapping.read',
    ],
  },
  {
    name: 'viewer',
    description: 'Acesso somente-leitura',
    priority: 100,
    permissions: [
      'tenants.read',
      'users.read',
      'roles.read',
      'customers.read',
      'deals.read',
      'activities.read',
      'contracts.read',
      'service_orders.read',
      'finance.charges.read',
      'finance.payables.read',
      'reports.read',
      'network.read',
      'stock.read',
      'fleet.read',
      'fleet.live.read',
      'hr.read',
      'self.read',
      'provisioning.read',
      'sifen.read',
      'mapping.read',
    ],
  },
  {
    // Role do portal do colaborador. Provisionada automaticamente ao criar um
    // Employee com login (EmployeesService.provisionLoginUser). Só dá acesso
    // ao self-service (/me) — sem nenhuma permissão de gestão. menuAccess do
    // User restringe a navegação aos itens do portal.
    name: 'employee',
    description: 'Colaborador — acesso somente ao portal self-service (/me)',
    priority: 200,
    permissions: ['self.read'],
  },
];

async function main() {
  console.log('🌱 Seeding NetX core database...');

  // 1. Permissions (global catalog)
  console.log('  → Permissions');
  for (const p of [
    ...corePermissions,
    ...crmPermissions,
    ...contractsPermissions,
    ...serviceOrdersPermissions,
    ...financePermissions,
    ...reportsPermissions,
    ...backupsPermissions,
    ...networkPermissions,
    ...stockPermissions,
    ...fleetPermissions,
    ...hrPermissions,
    ...provisioningPermissions,
    ...ufinetPermissions,
    ...efiPermissions,
    ...btgPermissions,
    ...chatPermissions,
  ]) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { module: p.module, resource: p.resource, action: p.action },
      create: p,
    });
  }

  // 2. System roles (tenantId = null → system-wide templates)
  // Prisma não suporta `null` em composite unique, então usamos findFirst + create/update
  console.log('  → System roles');
  const allPermissions = await prisma.permission.findMany();
  for (const r of systemRoles) {
    const existing = await prisma.role.findFirst({
      where: { name: r.name, tenantId: null },
    });

    const role = existing
      ? await prisma.role.update({
          where: { id: existing.id },
          data: { description: r.description, priority: r.priority, isSystem: true },
        })
      : await prisma.role.create({
          data: {
            name: r.name,
            description: r.description,
            priority: r.priority,
            isSystem: true,
          },
        });

    const perms =
      r.permissions === '*'
        ? allPermissions
        : allPermissions.filter((p) => (r.permissions as string[]).includes(p.code));

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }

  // 3. Default tenant (dev only) — Paraguai como mercado primário.
  console.log('  → Default tenant (PY)');
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      slug: 'default',
      name: 'NetX Paraguay ISP',
      legalName: 'NetX Paraguay S.A.',
      taxId: '80000000-0',
      country: 'PY',
      locale: 'es-PY',
      timezone: 'America/Asuncion',
      currency: 'PYG',
      status: TenantStatus.ACTIVE,
    },
  });

  // ────────────────────────────────────────────────────────────────────────
  // Sincroniza roles `admin`, `operator`, `viewer` em TODOS os tenants
  // existentes com os templates do sistema. Sem isso, módulos novos
  // (service-orders, finance, audit, etc.) ficam invisíveis pra usuários
  // já cadastrados porque suas roles ainda têm o catálogo antigo.
  //
  // Idempotente: roda na seed e a cada release. Custom roles (não-system,
  // criadas pelo admin do tenant manualmente) NÃO são tocadas.
  // ────────────────────────────────────────────────────────────────────────
  console.log('  → Sincronizando roles admin/operator/viewer em todos os tenants');
  const allTenants = await prisma.tenant.findMany({ select: { id: true, slug: true } });
  const SYSTEM_ROLE_NAMES = ['admin', 'operator', 'viewer'] as const;

  for (const t of allTenants) {
    for (const roleName of SYSTEM_ROLE_NAMES) {
      const tpl = await prisma.role.findFirst({
        where: { name: roleName, tenantId: null },
        include: { rolePermissions: true },
      });
      if (!tpl) continue;

      const tenantRole = await prisma.role.upsert({
        where: { tenantId_name: { tenantId: t.id, name: roleName } },
        update: {
          // Atualiza descrição/prioridade pra alinhar com o template,
          // mas preserva o flag `isSystem: false` (é uma cópia do tenant).
          description: tpl.description,
          priority: tpl.priority,
        },
        create: {
          tenantId: t.id,
          name: roleName,
          description: tpl.description,
          priority: tpl.priority,
          isSystem: false,
        },
      });

      // Sincroniza as permissões da role do tenant com o template:
      // remove o que não está mais e adiciona o que faltava. Isso permite
      // adicionar permissões novas sem quebrar customizações de UserRole.
      await prisma.rolePermission.deleteMany({ where: { roleId: tenantRole.id } });
      await prisma.rolePermission.createMany({
        data: tpl.rolePermissions.map((rp) => ({
          roleId: tenantRole.id,
          permissionId: rp.permissionId,
        })),
        skipDuplicates: true,
      });
    }
    console.log(`     · ${t.slug}: roles atualizadas`);
  }

  // Mantém referência ao admin do tenant default pra atribuir ao user admin
  const tenantAdmin = await prisma.role.findFirstOrThrow({
    where: { tenantId: tenant.id, name: 'admin' },
  });

  // 4. Admin user
  console.log('  → Admin user');
  const passwordHash = await argon2.hash('ChangeMe!2026', {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const admin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'admin@netx.local' } },
    update: {},
    create: {
      tenantId: tenant.id,
      email: 'admin@netx.local',
      emailVerified: true,
      passwordHash,
      firstName: 'NetX',
      lastName: 'Admin',
      status: UserStatus.ACTIVE,
      // Senha default 'ChangeMe!2026' precisa ser trocada no primeiro login.
      mustChangePassword: true,
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: tenantAdmin.id } },
    update: {},
    create: { userId: admin.id, roleId: tenantAdmin.id },
  });

  // 5. Default sales pipeline (idempotente)
  console.log('  → Default sales pipeline');
  const existingDefault = await prisma.pipeline.findFirst({
    where: { tenantId: tenant.id, slug: 'vendas' },
  });
  if (!existingDefault) {
    await prisma.pipeline.create({
      data: {
        tenantId: tenant.id,
        name: 'Vendas',
        slug: 'vendas',
        description: 'Funil padrão — lead → qualificação → proposta → negociação → fechamento',
        color: '#0ea5e9',
        isDefault: true,
        stages: {
          create: [
            { tenantId: tenant.id, name: 'Novo lead',        order: 0, probability: 10,  color: '#64748b' },
            { tenantId: tenant.id, name: 'Qualificado',      order: 1, probability: 25,  color: '#0ea5e9' },
            { tenantId: tenant.id, name: 'Proposta enviada', order: 2, probability: 50,  color: '#a855f7' },
            { tenantId: tenant.id, name: 'Negociação',       order: 3, probability: 75,  color: '#f59e0b' },
            { tenantId: tenant.id, name: 'Ganho',            order: 4, probability: 100, color: '#22c55e', isWon: true },
            { tenantId: tenant.id, name: 'Perdido',          order: 5, probability: 0,   color: '#ef4444', isLost: true },
          ],
        },
      },
    });
  }

  // 6. Motivos de O.S. padrão do sistema (idempotente)
  // "Instalação" com isInstallation=true — usado pelo wizard de novo cliente
  // e pela trava operacional (OS de instalação não fecha sem comodato).
  console.log('  → Default service-order reasons');
  const defaultReasons = [
    { name: 'Instalação', description: 'Instalação de novo cliente', isInstallation: true, order: 0 },
    { name: 'Suporte técnico', description: 'Atendimento técnico em campo', isInstallation: false, order: 1 },
    { name: 'Manutenção', description: 'Manutenção preventiva ou corretiva', isInstallation: false, order: 2 },
    { name: 'Mudança de endereço', description: 'Transferência de ponto', isInstallation: false, order: 3 },
  ];
  for (const r of defaultReasons) {
    const existing = await prisma.serviceOrderReason.findFirst({
      where: { tenantId: tenant.id, name: r.name },
    });
    if (!existing) {
      await prisma.serviceOrderReason.create({
        data: { tenantId: tenant.id, ...r },
      });
    } else if (r.isInstallation && !existing.isInstallation) {
      // Garante que o motivo "Instalação" tenha a flag (corrige seed antigo).
      await prisma.serviceOrderReason.update({
        where: { id: existing.id },
        data: { isInstallation: true },
      });
    }
  }

  // 7. Planos de internet exemplo (idempotente)
  // O admin ajusta velocidades/preços em Configurações → Planos.
  console.log('  → Sample internet plans');
  const samplePlans = [
    { name: 'Plano 300 Mega', downloadMbps: 300, uploadMbps: 300, monthlyPrice: '95000', order: 0 },
    { name: 'Plano 500 Mega', downloadMbps: 500, uploadMbps: 500, monthlyPrice: '125000', order: 1 },
    { name: 'Plano 1 Giga', downloadMbps: 1000, uploadMbps: 1000, monthlyPrice: '185000', order: 2 },
  ];
  for (const p of samplePlans) {
    const existing = await prisma.plan.findFirst({
      where: { tenantId: tenant.id, name: p.name },
    });
    if (!existing) {
      await prisma.plan.create({
        data: {
          tenantId: tenant.id,
          name: p.name,
          downloadMbps: p.downloadMbps,
          uploadMbps: p.uploadMbps,
          monthlyPrice: p.monthlyPrice,
          order: p.order,
        },
      });
    }
  }

  // 8. TR-069 — profile padrão Huawei EG8145 (motor de conformidade).
  //    IDEMPOTENTE POR REGRA: garante o profile (cria se faltar) e faz upsert de
  //    cada regra-base por param — adiciona o que falta (ex.: regra nova num
  //    deploy) SEM clobberar edições do operador em regras já existentes. Assim
  //    `netx-update` mantém o baseline em dia em profiles já criados. Só params
  //    LEGÍVEIS viram regra — senhas WiFi/PPPoE ficam de fora (o GET Huawei as
  //    devolve vazias; são aplicadas no provisionamento). Paths espelham
  //    tr069-paths.huawei.ts (mesmo índice de WAN).
  console.log('  → TR-069 default Huawei profile');
  const HW_PROFILE_NAME = 'Huawei EG8145 — padrão';
  const WAN = process.env.HUAWEI_PPPOE_WAN_INDEX ?? '2';
  const ppp = `InternetGatewayDevice.WANDevice.1.WANConnectionDevice.${WAN}.WANPPPConnection.1`;
  const HW_BASELINE_RULES = [
    // IP Acquisition Mode IPv6 = Automatic (não DHCPv6) — exige reboot.
    {
      param: `${ppp}.X_HW_IPv6.IPv6Address.1.Origin`,
      valueType: 'xsd:string',
      source: 'STATIC' as const,
      staticValue: 'AutoConfigured',
      mode: 'ENFORCE' as const,
      requiresReboot: true,
      sortOrder: 1,
    },
    // SSID 2.4G / 5G — do cadastro do contrato (sistema é dono do WiFi).
    {
      param: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID',
      valueType: 'xsd:string',
      source: 'CONTRACT_WIFI_SSID' as const,
      mode: 'ENFORCE' as const,
      sortOrder: 2,
    },
    {
      param: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID',
      valueType: 'xsd:string',
      source: 'CONTRACT_WIFI_SSID_5G' as const,
      mode: 'ENFORCE' as const,
      sortOrder: 3,
    },
    // PPPoE username — do contrato.
    {
      param: `${ppp}.Username`,
      valueType: 'xsd:string',
      source: 'CONTRACT_PPPOE_USER' as const,
      mode: 'ENFORCE' as const,
      sortOrder: 4,
    },
    // VLAN PPPoE — informativo (pode variar por planta).
    {
      param: `${ppp}.X_HW_VLAN`,
      valueType: 'xsd:unsignedInt',
      source: 'STATIC' as const,
      staticValue: '1010',
      mode: 'REPORT_ONLY' as const,
      sortOrder: 5,
    },
    // Periodic Inform = 5 min — ENFORCE idempotente: o reconciliador re-aplica
    // se a ONT voltar pro default de fábrica. Garante 5 min em toda Huawei,
    // independentemente. Aplica live (sem reboot).
    {
      param: 'InternetGatewayDevice.ManagementServer.PeriodicInformInterval',
      valueType: 'xsd:unsignedInt',
      source: 'STATIC' as const,
      staticValue: '300',
      mode: 'ENFORCE' as const,
      sortOrder: 6,
    },
  ];
  for (const t of allTenants) {
    const profile = await prisma.tr069Profile.upsert({
      where: { tenantId_name: { tenantId: t.id, name: HW_PROFILE_NAME } },
      update: {},
      create: { tenantId: t.id, name: HW_PROFILE_NAME, manufacturer: 'Huawei' },
      select: { id: true },
    });
    for (const r of HW_BASELINE_RULES) {
      await prisma.tr069ProfileRule.upsert({
        where: { profileId_param: { profileId: profile.id, param: r.param } },
        update: {},
        create: { profileId: profile.id, ...r },
      });
    }
    console.log(`     · ${t.slug}: profile Huawei garantido`);
  }

  console.log('✅ Seed completed.');
  console.log('');
  console.log('   Login de desenvolvimento:');
  console.log('     email:    admin@netx.local');
  console.log('     senha:    ChangeMe!2026');
  console.log('     tenant:   default');
  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
