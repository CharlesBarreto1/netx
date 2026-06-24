/**
 * Catálogo central de menus (sidebar) — agora hierárquico.
 *
 * Estrutura:
 *   - `MENU_GROUPS`   — definição de grupos (CRM, Financeiro, etc.)
 *   - `MENU_CATALOG`  — flatten dos itens (mantido por compat: UserForm,
 *                      validação server-side, menuAccess).
 *
 * Cada **item** tem:
 *   - `key`         — string estável usada em `User.menuAccess` (NÃO renomear
 *     sem migrar valores no DB).
 *   - `href`        — rota Next.js.
 *   - `labelKey`    — chave em `messages/<locale>.ts` namespace `nav`.
 *   - `permission`  — código de permissão exigido (RBAC). Sem perm → não vê.
 *
 * Cada **grupo** tem:
 *   - `key`         — id estável (não muda label nem rota).
 *   - `labelKey`    — em `nav.group.<key>` (ex.: 'group.crm').
 *   - `items`       — array de MenuDef.
 *
 * Como `menuAccess` continua funcionando:
 *   - É controlado por `key` do **item**, não do grupo.
 *   - Se TODOS os itens de um grupo estão escondidos, o grupo inteiro some
 *     (cabeçalho não aparece).
 */

import type { ModuleCode } from '@netx/shared';

export interface MenuDef {
  key: string;
  href: string;
  labelKey: string;
  permission?: string;
  /**
   * Lista de códigos ISO 3166-1 alpha-2 (ex.: ['PY', 'AR']). Quando presente,
   * o item só aparece se `tenant.country` estiver na lista. Ausente = todos.
   * Útil pra módulos exclusivos de um país (fiscal/SIFEN só faz sentido no PY).
   */
  visibleIfCountry?: string[];
  /**
   * Módulos do ecossistema que habilitam este item (entitlement da licença).
   * O item aparece se QUALQUER um da lista estiver habilitado. Ausente = item
   * do ERP base, sempre visível. Espelha o `@RequiresModule` do backend.
   */
  requiredModules?: ModuleCode[];
}

export interface MenuGroup {
  key: string;
  /** Sem labelKey = item solto (top-level), não renderiza header. */
  labelKey?: string;
  items: MenuDef[];
  /** Mesmo conceito de `MenuDef.visibleIfCountry`, mas filtra o grupo inteiro. */
  visibleIfCountry?: string[];
  /**
   * Mesmo conceito de `MenuDef.requiredModules`, mas filtra o grupo inteiro
   * (atalho quando o grupo mapeia 1:1 a um módulo do ecossistema).
   */
  requiredModules?: ModuleCode[];
}

// -----------------------------------------------------------------------------
// Estrutura visual da sidebar.
// Ordem aqui = ordem renderizada de cima pra baixo.
// -----------------------------------------------------------------------------
export const MENU_GROUPS: MenuGroup[] = [
  // Top-level isolado — Dashboard sempre primeiro.
  {
    key: 'home',
    items: [
      { key: 'dashboard', href: '/dashboard', labelKey: 'dashboard' },
    ],
  },

  // CRM — base de clientes + relacionamento + vendas
  {
    key: 'crm',
    labelKey: 'group.crm',
    items: [
      { key: 'customers', href: '/customers', labelKey: 'customers', permission: 'customers.read' },
      { key: 'contracts', href: '/contracts', labelKey: 'contracts', permission: 'contracts.read' },
      { key: 'sales', href: '/deals', labelKey: 'sales', permission: 'deals.read' },
      { key: 'tags', href: '/crm/tags', labelKey: 'tags', permission: 'customers.tags.manage' },
    ],
  },

  // Financeiro — cobranças e movimentação
  {
    key: 'finance',
    labelKey: 'group.finance',
    items: [
      { key: 'charges', href: '/finance/charges', labelKey: 'charges', permission: 'finance.charges.read' },
      { key: 'payables', href: '/finance/payables', labelKey: 'payables', permission: 'finance.payables.read' },
      { key: 'cashRegisters', href: '/settings/cash-registers', labelKey: 'cashRegisters', permission: 'cash_registers.manage' },
      { key: 'brBilling', href: '/settings/br-billing', labelKey: 'brBilling', permission: 'efi.config.read' },
    ],
  },

  // Fiscal — SIFEN / e-Kuatiá (PY). Só aparece pra tenants Paraguai.
  {
    key: 'fiscal',
    labelKey: 'group.fiscal',
    visibleIfCountry: ['PY'],
    items: [
      { key: 'fiscalDocuments', href: '/fiscal/documents', labelKey: 'fiscalDocuments', permission: 'sifen.read' },
      { key: 'fiscalEmit', href: '/fiscal/documents/new', labelKey: 'fiscalEmit', permission: 'sifen.emit' },
      { key: 'sifenConfig', href: '/settings/sifen', labelKey: 'sifenConfig', permission: 'sifen.config.read' },
    ],
  },

  // Fiscal BR — NFCom (modelo 62, SVRS). Só aparece pra tenants Brasil.
  {
    key: 'fiscalBr',
    labelKey: 'group.fiscalBr',
    visibleIfCountry: ['BR'],
    items: [
      { key: 'nfcomDocuments', href: '/fiscal/nfcom', labelKey: 'nfcomDocuments', permission: 'nfcom.read' },
      { key: 'nfcomConfig', href: '/settings/nfcom', labelKey: 'nfcomConfig', permission: 'nfcom.config' },
    ],
  },

  // Mapeamento — visualização geográfica (clientes, rede, backbone, etc).
  {
    key: 'mapping',
    labelKey: 'group.mapping',
    requiredModules: ['netx-maps'],
    items: [
      { key: 'mappingCustomers',   href: '/mapping/customers',   labelKey: 'mappingCustomers',   permission: 'mapping.read' },
      { key: 'mappingNetwork',     href: '/mapping/network',     labelKey: 'mappingNetwork',     permission: 'mapping.read' },
      { key: 'mapStudio',          href: '/mapa',                labelKey: 'mapStudio',          permission: 'network.read' },
      { key: 'mappingBackbone',    href: '/mapping/backbone',    labelKey: 'mappingBackbone',    permission: 'mapping.read' },
      { key: 'mappingTechnicians', href: '/mapping/technicians', labelKey: 'mappingTechnicians', permission: 'mapping.read' },
    ],
  },

  // Frota — veículos, motoristas, despesas, manutenções + rastreamento ao vivo.
  {
    key: 'fleet',
    labelKey: 'group.fleet',
    items: [
      { key: 'fleetVehicles',    href: '/fleet/vehicles',    labelKey: 'fleetVehicles',    permission: 'fleet.read' },
      { key: 'fleetDrivers',     href: '/fleet/drivers',      labelKey: 'fleetDrivers',     permission: 'fleet.read' },
      { key: 'fleetExpenses',    href: '/fleet/expenses',     labelKey: 'fleetExpenses',    permission: 'fleet.read' },
      { key: 'fleetMaintenance', href: '/fleet/maintenance',  labelKey: 'fleetMaintenance', permission: 'fleet.read' },
      { key: 'fleetLive',        href: '/fleet/live',         labelKey: 'fleetLive',        permission: 'fleet.live.read' },
    ],
  },

  // RH — gestão de colaboradores (admin). O portal self-service é o grupo abaixo.
  {
    key: 'hr',
    labelKey: 'group.hr',
    requiredModules: ['netx-rh'],
    items: [
      { key: 'hrEmployees',  href: '/hr/employees',  labelKey: 'hrEmployees',  permission: 'hr.read' },
      { key: 'hrTimeclock',  href: '/hr/timeclock',  labelKey: 'hrTimeclock',  permission: 'hr.read' },
      { key: 'hrPayroll',    href: '/hr/payroll',    labelKey: 'hrPayroll',    permission: 'hr.payroll.manage' },
      { key: 'hrPosts',      href: '/hr/posts',      labelKey: 'hrPosts',      permission: 'hr.blog.manage' },
      { key: 'hrReports',    href: '/hr/reports',    labelKey: 'hrReports',    permission: 'hr.payroll.manage' },
    ],
  },

  // Portal do colaborador — self-service. Items keyed me* batem com o
  // menuAccess do User provisionado (EmployeesService.EMPLOYEE_MENU_ACCESS).
  {
    key: 'portal',
    labelKey: 'group.portal',
    requiredModules: ['netx-rh'],
    items: [
      { key: 'meHome',      href: '/me',             labelKey: 'meHome',      permission: 'self.read' },
      { key: 'meTimeclock', href: '/me/ponto',       labelKey: 'meTimeclock', permission: 'self.read' },
      { key: 'meEarnings',  href: '/me/rendimentos', labelKey: 'meEarnings',  permission: 'self.read' },
      { key: 'meDocuments', href: '/me/documentos',  labelKey: 'meDocuments', permission: 'self.read' },
      { key: 'meNews',      href: '/me/noticias',    labelKey: 'meNews',      permission: 'self.read' },
    ],
  },

  // [DESATIVADO] Atendimento — Evolution API teve problemas; reativar quando
  // trocarmos pra Whaticket/WhatsApp Web JS/Meta oficial. Veja docs/architecture/
  // ou memória "whatsapp_evolution_pendente". Backend/schema/i18n/pages
  // continuam no código, apenas escondemos do menu.
  // {
  //   key: 'chat',
  //   labelKey: 'group.chat',
  //   items: [
  //     { key: 'chat', href: '/chat', labelKey: 'chat', permission: 'chat.read' },
  //   ],
  // },

  // Operações — campo (O.S) + infraestrutura de rede (POPs + equipamentos)
  {
    key: 'operations',
    labelKey: 'group.operations',
    items: [
      { key: 'serviceOrders', href: '/service-orders', labelKey: 'serviceOrders', permission: 'service_orders.read' },
      { key: 'serviceOrderReasons', href: '/settings/service-order-reasons', labelKey: 'serviceOrderReasons', permission: 'service_order_reasons.manage' },
      { key: 'pops', href: '/network/pops', labelKey: 'pops', permission: 'network.read' },
      { key: 'equipment', href: '/network/equipment', labelKey: 'equipment', permission: 'network.read' },
      { key: 'opticalEnclosures', href: '/network/optical', labelKey: 'opticalEnclosures', permission: 'network.read' },
      { key: 'fiberCables', href: '/network/fiber', labelKey: 'fiberCables', permission: 'network.read' },
      { key: 'fiberSplices', href: '/network/splices', labelKey: 'fiberSplices', permission: 'network.read' },
      { key: 'powerBudget', href: '/network/power-budget', labelKey: 'powerBudget', permission: 'network.read' },
      { key: 'otdrEvents', href: '/network/otdr', labelKey: 'otdrEvents', permission: 'network.read' },
      { key: 'ponTree', href: '/network/pon-tree', labelKey: 'ponTree', permission: 'network.read' },
      { key: 'kmlImport', href: '/network/import-export', labelKey: 'kmlImport', permission: 'network.read' },
      { key: 'radiusLog', href: '/network/radius-log', labelKey: 'radiusLog', permission: 'audit.read' },
    ],
  },

  // Estoque — produtos, compras, locais com ACL, kardex (Fase 1)
  {
    key: 'stock',
    labelKey: 'group.stock',
    items: [
      { key: 'stockProducts', href: '/stock/products', labelKey: 'stockProducts', permission: 'stock.read' },
      { key: 'stockAssets', href: '/stock/assets', labelKey: 'stockAssets', permission: 'stock.read' },
      { key: 'stockSuppliers', href: '/stock/suppliers', labelKey: 'stockSuppliers', permission: 'stock.read' },
      { key: 'stockLocations', href: '/stock/locations', labelKey: 'stockLocations', permission: 'stock.read' },
      { key: 'stockPurchases', href: '/stock/purchases', labelKey: 'stockPurchases', permission: 'stock.purchase.create' },
      { key: 'stockMovements', href: '/stock/movements', labelKey: 'stockMovements', permission: 'stock.read' },
      { key: 'stockReport', href: '/stock/report', labelKey: 'stockReport', permission: 'stock.read' },
    ],
  },

  // Provisionamento — OLT/ONT (PY: Ufinet, BR: Parks/etc) + TR-069 ACS (Fase 3)
  {
    key: 'provisioning',
    labelKey: 'group.provisioning',
    requiredModules: ['netx-cpe'],
    items: [
      { key: 'provisioningPending', href: '/provisioning/pending', labelKey: 'provisioningPending', permission: 'provisioning.read' },
      { key: 'alarms', href: '/alarms', labelKey: 'alarms', permission: 'provisioning.read' },
      { key: 'olts', href: '/olts', labelKey: 'olts', permission: 'olts.admin' },
      { key: 'oltTemplates', href: '/olt-templates', labelKey: 'oltTemplates', permission: 'olts.admin' },
      { key: 'tr069Dashboard', href: '/tr069', labelKey: 'tr069Dashboard', permission: 'tr069.admin' },
      { key: 'tr069Devices', href: '/tr069/devices', labelKey: 'tr069Devices', permission: 'tr069.admin' },
      { key: 'tr069Alerts', href: '/tr069/alerts', labelKey: 'tr069Alerts', permission: 'tr069.admin' },
      { key: 'tr069WifiCoverage', href: '/tr069/wifi-coverage', labelKey: 'tr069WifiCoverage', permission: 'provisioning.read' },
      { key: 'tr069Profiles', href: '/tr069/profiles', labelKey: 'tr069Profiles', permission: 'tr069.admin' },
    ],
  },

  // Relatórios — solto, sem subgrupo
  {
    key: 'reports-group',
    items: [
      { key: 'reports', href: '/reports', labelKey: 'reports', permission: 'reports.read' },
    ],
  },

  // Configurações — admin da operação (= empresa/ISP inteira nesta instância)
  {
    key: 'settings',
    labelKey: 'group.settings',
    items: [
      // /settings/tenant: configuração da empresa (país/locale/moeda/CNPJ)
      { key: 'settings', href: '/settings/tenant', labelKey: 'settings', permission: 'tenants.update' },
      { key: 'users', href: '/settings/users', labelKey: 'users', permission: 'users.read' },
      { key: 'plans', href: '/settings/plans', labelKey: 'plans', permission: 'plans.manage' },
      // Hubsoft — integração de leitura p/ migração (config + sync). Só BR.
      { key: 'hubsoft', href: '/settings/hubsoft', labelKey: 'hubsoft', permission: 'hubsoft.config.read', visibleIfCountry: ['BR'] },
      // [DESATIVADO] WhatsApp admin — descomenta quando módulo Chat voltar
      // { key: 'whatsapp', href: '/settings/whatsapp', labelKey: 'whatsappAdmin', permission: 'chat.admin' },
      { key: 'backups', href: '/settings/backups', labelKey: 'backups', permission: 'backups.manage' },
      { key: 'audit', href: '/settings/audit', labelKey: 'audit', permission: 'audit.read' },
    ],
  },

  // Conta pessoal — sempre visível, fica isolado no fim
  {
    key: 'me',
    items: [
      // 'security' não tem permissão: cada user gerencia a própria senha/2FA.
      { key: 'security', href: '/settings/security', labelKey: 'security' },
    ],
  },
];

// -----------------------------------------------------------------------------
// Catálogo flat — derivado dos grupos. Mantido por compat com:
//   - UserForm (checklist de menus)
//   - validação `MENU_KEYS` em outros lugares
//   - `visibleMenus()` antigo
// -----------------------------------------------------------------------------
export const MENU_CATALOG: MenuDef[] = MENU_GROUPS.flatMap((g) => g.items);

export const MENU_KEYS = MENU_CATALOG.map((m) => m.key);

/** Helper: item visível pelo país? Sem restrição = sempre visível. */
function matchesCountry(
  entry: { visibleIfCountry?: string[] },
  country: string | null | undefined,
): boolean {
  if (!entry.visibleIfCountry || entry.visibleIfCountry.length === 0) return true;
  if (!country) return false;
  return entry.visibleIfCountry.includes(country);
}

/**
 * Resolve quais menus o user pode efetivamente ver (modo flat — usado
 * em validações que não se importam com agrupamento).
 *
 * `country` é opcional pra compat — quando ausente, ignora filtro de país
 * (mostra tudo que passa em perm/menuAccess). Callers que querem o filtro
 * passam tenant.country.
 */
/**
 * Gating por módulo (entitlement da licença). FAIL-OPEN: sem `entitledModules`
 * (licença ainda carregando, endpoint off, ou instância legada) ⇒ libera, igual
 * ao guard default-permissivo do backend. Item sem `requiredModules` ⇒ ERP base,
 * sempre liberado. Caso contrário, basta UM módulo da lista estar habilitado.
 */
function moduleAllowed(
  m: { requiredModules?: ModuleCode[] },
  entitled: readonly string[] | null | undefined,
): boolean {
  if (!m.requiredModules || !entitled) return true;
  return m.requiredModules.some((mod) => entitled.includes(mod));
}

export function visibleMenus(
  permissions: string[],
  menuAccess: string[] | null | undefined,
  country?: string | null,
  entitledModules?: readonly ModuleCode[] | null,
): MenuDef[] {
  return MENU_CATALOG.filter((m) => {
    if (m.permission && !permissions.includes(m.permission)) return false;
    if (Array.isArray(menuAccess) && !menuAccess.includes(m.key)) return false;
    if (country !== undefined && !matchesCountry(m, country)) return false;
    if (!moduleAllowed(m, entitledModules)) return false;
    return true;
  });
}

/**
 * Variante hierárquica: devolve grupos com items já filtrados. Grupos sem
 * nenhum item visível são excluídos automaticamente. Grupos com
 * `visibleIfCountry` que não bate com `country` também somem inteiros.
 */
export function visibleMenuGroups(
  permissions: string[],
  menuAccess: string[] | null | undefined,
  country?: string | null,
  entitledModules?: readonly ModuleCode[] | null,
): MenuGroup[] {
  return MENU_GROUPS
    .filter((g) => country === undefined || matchesCountry(g, country))
    .filter((g) => moduleAllowed(g, entitledModules))
    .map((g) => ({
      ...g,
      items: g.items.filter((m) => {
        if (m.permission && !permissions.includes(m.permission)) return false;
        if (Array.isArray(menuAccess) && !menuAccess.includes(m.key)) return false;
        if (country !== undefined && !matchesCountry(m, country)) return false;
        if (!moduleAllowed(m, entitledModules)) return false;
        return true;
      }),
    }))
    .filter((g) => g.items.length > 0);
}

/** Um módulo licenciável NÃO habilitado — vira oferta "Disponível · ativar". */
export interface UpsellModule {
  key: string;
  /** Chave i18n do nome do grupo/módulo (namespace `nav`). */
  labelKey: string;
  requiredModules: ModuleCode[];
}

/**
 * Módulos gateados por licença que NÃO estão habilitados — em vez de sumir da
 * nav (como `visibleMenuGroups` faz), aparecem como UPSELL ("Disponível ·
 * ativar"). Independe de permissão (é oferta de produto, não navegação).
 *
 * FAIL-OPEN: sem `entitledModules` (licença carregando, off, ou legado ⇒ tudo
 * habilitado) não há nada a ofertar — retorna vazio.
 */
export function upsellMenuGroups(
  country: string | null | undefined,
  entitledModules: readonly ModuleCode[] | null | undefined,
): UpsellModule[] {
  if (!entitledModules) return [];
  return MENU_GROUPS.filter(
    (g) =>
      g.requiredModules &&
      g.requiredModules.length > 0 &&
      !g.requiredModules.some((m) => entitledModules.includes(m)) &&
      (country === undefined || matchesCountry(g, country)),
  ).map((g) => ({
    key: g.key,
    labelKey: g.labelKey ?? g.key,
    requiredModules: g.requiredModules as ModuleCode[],
  }));
}
