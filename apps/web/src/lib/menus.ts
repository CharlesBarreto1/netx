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

export interface MenuDef {
  key: string;
  href: string;
  labelKey: string;
  permission?: string;
}

export interface MenuGroup {
  key: string;
  /** Sem labelKey = item solto (top-level), não renderiza header. */
  labelKey?: string;
  items: MenuDef[];
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
      { key: 'cashRegisters', href: '/settings/cash-registers', labelKey: 'cashRegisters', permission: 'cash_registers.manage' },
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
      { key: 'radiusLog', href: '/network/radius-log', labelKey: 'radiusLog', permission: 'audit.read' },
    ],
  },

  // Estoque — produtos, compras, locais com ACL, kardex (Fase 1)
  {
    key: 'stock',
    labelKey: 'group.stock',
    items: [
      { key: 'stockProducts', href: '/stock/products', labelKey: 'stockProducts', permission: 'stock.read' },
      { key: 'stockSuppliers', href: '/stock/suppliers', labelKey: 'stockSuppliers', permission: 'stock.read' },
      { key: 'stockLocations', href: '/stock/locations', labelKey: 'stockLocations', permission: 'stock.read' },
      { key: 'stockPurchases', href: '/stock/purchases', labelKey: 'stockPurchases', permission: 'stock.purchase.create' },
      { key: 'stockMovements', href: '/stock/movements', labelKey: 'stockMovements', permission: 'stock.read' },
    ],
  },

  // Provisionamento — OLT/ONT (PY: Ufinet, BR: Parks/etc) + TR-069 ACS (Fase 3)
  {
    key: 'provisioning',
    labelKey: 'group.provisioning',
    items: [
      { key: 'provisioningPending', href: '/provisioning/pending', labelKey: 'provisioningPending', permission: 'provisioning.read' },
      { key: 'olts', href: '/olts', labelKey: 'olts', permission: 'olts.admin' },
      { key: 'tr069Devices', href: '/tr069/devices', labelKey: 'tr069Devices', permission: 'tr069.admin' },
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

/**
 * Resolve quais menus o user pode efetivamente ver (modo flat — usado
 * em validações que não se importam com agrupamento).
 */
export function visibleMenus(
  permissions: string[],
  menuAccess: string[] | null | undefined,
): MenuDef[] {
  return MENU_CATALOG.filter((m) => {
    if (m.permission && !permissions.includes(m.permission)) return false;
    if (Array.isArray(menuAccess) && !menuAccess.includes(m.key)) return false;
    return true;
  });
}

/**
 * Variante hierárquica: devolve grupos com items já filtrados. Grupos sem
 * nenhum item visível são excluídos automaticamente.
 */
export function visibleMenuGroups(
  permissions: string[],
  menuAccess: string[] | null | undefined,
): MenuGroup[] {
  return MENU_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((m) => {
      if (m.permission && !permissions.includes(m.permission)) return false;
      if (Array.isArray(menuAccess) && !menuAccess.includes(m.key)) return false;
      return true;
    }),
  })).filter((g) => g.items.length > 0);
}
