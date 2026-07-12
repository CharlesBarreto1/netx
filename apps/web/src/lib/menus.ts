/**
 * Catálogo central de menus (sidebar) — hierárquico, até 3 níveis.
 *
 * Estrutura:
 *   - `MENU_GROUPS`   — definição de grupos top-level (CRM, Financeiro, etc.).
 *     Cada grupo tem `items`, que podem ser FOLHAS (`MenuLeaf`, um link) ou
 *     SUB-ÁRVORES (`MenuBranch`, um cabeçalho aninhado com `children`).
 *   - `MENU_CATALOG`  — flatten recursivo só das FOLHAS (mantido por compat:
 *                      UserForm, CommandPalette, validação `menuAccess`).
 *
 * Cada **folha** (`MenuLeaf`) tem:
 *   - `key`         — string estável usada em `User.menuAccess` (NÃO renomear
 *     sem migrar valores no DB).
 *   - `href`        — rota Next.js.
 *   - `labelKey`    — chave em `messages/<locale>.ts` namespace `nav`.
 *   - `permission`  — código de permissão exigido (RBAC). Sem perm → sempre vê.
 *
 * Cada **sub-árvore** (`MenuBranch`) tem:
 *   - `key`         — id estável do cabeçalho (NÃO entra em `menuAccess`, é só
 *     visual; o gating granular continua nas folhas).
 *   - `labelKey`    — em `nav.sub.<x>` (ex.: 'sub.provisioning').
 *   - `children`    — folhas (a UI não aninha além de grupo › sub-árvore › folha).
 *
 * Cada **grupo** (`MenuGroup`) tem:
 *   - `key`         — id estável (não muda label nem rota).
 *   - `labelKey`    — em `nav.group.<key>` (ex.: 'group.crm'). Ausente = grupo
 *     solto (top-level), não renderiza header (ex.: Dashboard, Minha Segurança).
 *   - `items`       — array de `MenuItem` (folha OU sub-árvore).
 *
 * Como `menuAccess` continua funcionando:
 *   - É controlado por `key` da **folha**, não de grupo/sub-árvore.
 *   - Sub-árvore some quando todas as folhas dela somem; grupo some quando
 *     todos os items somem (cabeçalho não aparece).
 */

import type { ModuleCode } from '@netx/shared';

export interface MenuLeaf {
  key: string;
  href: string;
  labelKey: string;
  permission?: string;
  /**
   * Lista de códigos ISO 3166-1 alpha-2 (ex.: ['PY', 'AR']). Quando presente,
   * o item só aparece se `tenant.country` estiver na lista. Ausente = todos.
   * Útil pra módulos exclusivos de um país (SIFEN só faz sentido no PY).
   */
  visibleIfCountry?: string[];
  /**
   * Módulos do ecossistema que habilitam este item (entitlement da licença).
   * O item aparece se QUALQUER um da lista estiver habilitado. Ausente = item
   * do ERP base, sempre visível. Espelha o `@RequiresModule` do backend.
   */
  requiredModules?: ModuleCode[];
}

export interface MenuBranch {
  key: string;
  labelKey: string;
  children: MenuLeaf[];
  /** Mesmo conceito de `MenuLeaf`, mas filtra a sub-árvore inteira. */
  permission?: string;
  visibleIfCountry?: string[];
  requiredModules?: ModuleCode[];
}

/** Um item de grupo é uma folha (link) ou uma sub-árvore (cabeçalho aninhado). */
export type MenuItem = MenuLeaf | MenuBranch;

export interface MenuGroup {
  key: string;
  /** Sem labelKey = grupo solto (top-level), não renderiza header. */
  labelKey?: string;
  items: MenuItem[];
  /** Mesmo conceito de `MenuLeaf.visibleIfCountry`, mas filtra o grupo inteiro. */
  visibleIfCountry?: string[];
  /**
   * Mesmo conceito de `MenuLeaf.requiredModules`, mas filtra o grupo inteiro
   * (atalho quando o grupo mapeia 1:1 a um módulo do ecossistema).
   */
  requiredModules?: ModuleCode[];
}

/** Type guard — distingue sub-árvore de folha pela presença de `children`. */
export function isBranch(item: MenuItem): item is MenuBranch {
  return 'children' in item;
}

/**
 * @deprecated Use `MenuLeaf`. Mantido como alias por compat com importadores
 * antigos (CommandPalette, UserForm) que tipam o catálogo flat.
 */
export type MenuDef = MenuLeaf;

// -----------------------------------------------------------------------------
// Estrutura visual da sidebar.
// Ordem aqui = ordem renderizada de cima pra baixo.
// -----------------------------------------------------------------------------
export const MENU_GROUPS: MenuGroup[] = [
  // 1. Dashboard — top-level isolado, sempre primeiro.
  {
    key: 'home',
    // Copiloto de IA não tem rota própria: vive no rail direito (Nexus/CopilotRail).
    items: [{ key: 'dashboard', href: '/dashboard', labelKey: 'dashboard' }],
  },

  // 2. CRM — base de clientes + relacionamento + vendas.
  {
    key: 'crm',
    labelKey: 'group.crm',
    items: [
      { key: 'customers', href: '/customers', labelKey: 'customers', permission: 'customers.read' },
      { key: 'contracts', href: '/contracts', labelKey: 'contracts', permission: 'contracts.read' },
      { key: 'sales', href: '/deals', labelKey: 'sales', permission: 'deals.read' },
    ],
  },

  // 3. Financeiro — cobranças, movimentação e fiscal (notas).
  {
    key: 'finance',
    labelKey: 'group.finance',
    items: [
      { key: 'charges', href: '/finance/charges', labelKey: 'charges', permission: 'finance.charges.read' },
      { key: 'payables', href: '/finance/payables', labelKey: 'payables', permission: 'finance.payables.read' },
      { key: 'cashRegisters', href: '/settings/cash-registers', labelKey: 'cashRegisters', permission: 'cash_registers.manage' },
      // Fiscal — emissão/documentos. SIFEN (PY) e NFCom (BR) convivem por país.
      // A parametrização (config SIFEN/NFCom) mora em Configurações › Fiscal.
      {
        key: 'financeFiscal',
        labelKey: 'sub.fiscal',
        children: [
          { key: 'fiscalDocuments', href: '/fiscal/documents', labelKey: 'fiscalDocuments', permission: 'sifen.read', visibleIfCountry: ['PY'] },
          { key: 'fiscalEmit', href: '/fiscal/documents/new', labelKey: 'fiscalEmit', permission: 'sifen.emit', visibleIfCountry: ['PY'] },
          { key: 'nfcomDocuments', href: '/fiscal/nfcom', labelKey: 'nfcomDocuments', permission: 'nfcom.read', visibleIfCountry: ['BR'] },
        ],
      },
    ],
  },

  // 4. Estoque — produtos, compras, locais com ACL, kardex.
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

  // NMS — gestão técnica de rede multi-vendor (Juniper + Mikrotik). Módulo
  // netx-nms, servido pelo gateway em /v1/nms/* (ecossistema plugável).
  {
    key: 'nms',
    labelKey: 'group.nms',
    requiredModules: ['netx-nms'],
    items: [
      { key: 'nmsDevices', href: '/nms/devices', labelKey: 'nmsDevices', requiredModules: ['netx-nms'] },
    ],
  },

  // 5. RH — gestão de colaboradores + portal self-service. Módulo netx-rh.
  {
    key: 'hr',
    labelKey: 'group.hr',
    requiredModules: ['netx-rh'],
    items: [
      {
        key: 'hrManagement',
        labelKey: 'sub.hrManagement',
        children: [
          { key: 'hrEmployees', href: '/hr/employees', labelKey: 'hrEmployees', permission: 'hr.read' },
          { key: 'hrTimeclock', href: '/hr/timeclock', labelKey: 'hrTimeclock', permission: 'hr.read' },
          { key: 'hrPayroll', href: '/hr/payroll', labelKey: 'hrPayroll', permission: 'hr.payroll.manage' },
          { key: 'hrPosts', href: '/hr/posts', labelKey: 'hrPosts', permission: 'hr.blog.manage' },
          { key: 'hrReports', href: '/hr/reports', labelKey: 'hrReports', permission: 'hr.payroll.manage' },
        ],
      },
      // Portal do colaborador — self-service. Items me* batem com o menuAccess
      // provisionado em EmployeesService.EMPLOYEE_MENU_ACCESS.
      {
        key: 'hrPortal',
        labelKey: 'sub.hrPortal',
        children: [
          { key: 'meHome', href: '/me', labelKey: 'meHome', permission: 'self.read' },
          { key: 'meTimeclock', href: '/me/ponto', labelKey: 'meTimeclock', permission: 'self.read' },
          { key: 'meEarnings', href: '/me/rendimentos', labelKey: 'meEarnings', permission: 'self.read' },
          { key: 'meDocuments', href: '/me/documentos', labelKey: 'meDocuments', permission: 'self.read' },
          { key: 'meNews', href: '/me/noticias', labelKey: 'meNews', permission: 'self.read' },
        ],
      },
    ],
  },

  // 6. Atendimento — O.S por enquanto. Chat/Call entram como folhas no futuro.
  // (Motivos de O.S = parametrização → Configurações › Atendimento.)
  {
    key: 'support',
    labelKey: 'group.support',
    items: [
      { key: 'serviceOrders', href: '/service-orders', labelKey: 'serviceOrders', permission: 'service_orders.read' },
      // Assinante 360 — console do atendente (BFF read-only ERP+CPE+NMS). NetX Field.
      { key: 'subscriber360', href: '/subscriber360', labelKey: 'subscriber360', permission: 'field.subscriber360.read' },
      // Inbox de Atendimento WhatsApp (Call). Módulo netx-call.
      { key: 'chat', href: '/chat', labelKey: 'chat', permission: 'chat.read', requiredModules: ['netx-call'] },
    ],
  },

  // 7. Técnico — provisionamento, planta de rede, alarmes, RADIUS.
  // (Templates/Profiles = parametrização → Configurações › Técnico.)
  {
    key: 'technical',
    labelKey: 'group.technical',
    items: [
      // Provisionamento OLT/ONT + TR-069 ACS. Módulo netx-cpe.
      {
        key: 'techProvisioning',
        labelKey: 'sub.provisioning',
        requiredModules: ['netx-cpe'],
        children: [
          { key: 'provisioningPending', href: '/provisioning/pending', labelKey: 'provisioningPending', permission: 'provisioning.read' },
          { key: 'olts', href: '/olts', labelKey: 'olts', permission: 'olts.admin' },
          { key: 'tr069Dashboard', href: '/tr069', labelKey: 'tr069Dashboard', permission: 'tr069.admin' },
          { key: 'tr069Devices', href: '/tr069/devices', labelKey: 'tr069Devices', permission: 'tr069.admin' },
          { key: 'tr069Alerts', href: '/tr069/alerts', labelKey: 'tr069Alerts', permission: 'tr069.admin' },
          { key: 'tr069WifiCoverage', href: '/tr069/wifi-coverage', labelKey: 'tr069WifiCoverage', permission: 'provisioning.read' },
          // Rollout em ondas do pacote de otimização Wi-Fi Huawei.
          { key: 'tr069WifiOpt', href: '/tr069/wifi-opt', labelKey: 'tr069WifiOpt', permission: 'tr069.admin', requiredModules: ['netx-cpe'] },
          // Catálogo de firmware CPE + rollout (parque do modelo ou seriais).
          { key: 'tr069Firmware', href: '/tr069/firmware', labelKey: 'tr069Firmware', permission: 'tr069.admin' },
        ],
      },
      // Planta de rede — infraestrutura física (POPs, equipamentos, IPAM).
      // A planta externa (caixas, cabos, fusões, OTDR, PON) mora no FiberMap.
      {
        key: 'techNetworkPlant',
        labelKey: 'sub.networkPlant',
        children: [
          { key: 'pops', href: '/network/pops', labelKey: 'pops', permission: 'network.read' },
          { key: 'equipment', href: '/network/equipment', labelKey: 'equipment', permission: 'network.read' },
          { key: 'ipam', href: '/network/ipam', labelKey: 'ipam', permission: 'ipam.read' },
        ],
      },
      { key: 'alarms', href: '/alarms', labelKey: 'alarms', permission: 'provisioning.read', requiredModules: ['netx-cpe'] },
      { key: 'radiusLog', href: '/network/radius-log', labelKey: 'radiusLog', permission: 'audit.read' },
    ],
  },

  // 8. Mapeamento — visualização geográfica. Módulo netx-maps.
  {
    key: 'mapping',
    labelKey: 'group.mapping',
    requiredModules: ['netx-maps'],
    items: [
      { key: 'mappingCustomers', href: '/mapping/customers', labelKey: 'mappingCustomers', permission: 'mapping.read' },
      // FiberMap (OSP v2) — documentação de planta externa. Módulo próprio.
      { key: 'fibermap', href: '/fibermap', labelKey: 'fibermap', permission: 'fibermap.read', requiredModules: ['netx-fibermap'] },
      { key: 'fibermapSettings', href: '/fibermap/settings', labelKey: 'fibermapSettings', permission: 'fibermap.admin', requiredModules: ['netx-fibermap'] },
    ],
  },

  // 9. Frota — veículos, motoristas, despesas, manutenções + ao vivo.
  {
    key: 'fleet',
    labelKey: 'group.fleet',
    items: [
      { key: 'fleetVehicles', href: '/fleet/vehicles', labelKey: 'fleetVehicles', permission: 'fleet.read' },
      { key: 'fleetDrivers', href: '/fleet/drivers', labelKey: 'fleetDrivers', permission: 'fleet.read' },
      { key: 'fleetExpenses', href: '/fleet/expenses', labelKey: 'fleetExpenses', permission: 'fleet.read' },
      { key: 'fleetMaintenance', href: '/fleet/maintenance', labelKey: 'fleetMaintenance', permission: 'fleet.read' },
      { key: 'fleetLive', href: '/fleet/live', labelKey: 'fleetLive', permission: 'fleet.live.read' },
    ],
  },

  // 10. Relatórios — hub geral. Consolidar estoque/RH/financeiro aqui é fase 2.
  // (key 'reports-group' p/ não colidir com a folha 'reports' — keys de grupo e
  // folha dividem o mesmo espaço no estado de expand da sidebar.)
  {
    key: 'reports-group',
    labelKey: 'group.reports',
    items: [
      { key: 'reports', href: '/reports', labelKey: 'reports', permission: 'reports.read' },
    ],
  },

  // 11. Configurações — parametrização do sistema, em sub-árvores por domínio.
  {
    key: 'settings',
    labelKey: 'group.settings',
    items: [
      {
        key: 'cfgGeneral',
        labelKey: 'sub.cfgGeneral',
        children: [
          // /settings/tenant: configuração da empresa (país/locale/moeda/CNPJ)
          { key: 'settings', href: '/settings/tenant', labelKey: 'settings', permission: 'tenants.update' },
          { key: 'users', href: '/settings/users', labelKey: 'users', permission: 'users.read' },
          { key: 'backups', href: '/settings/backups', labelKey: 'backups', permission: 'backups.manage' },
          { key: 'audit', href: '/settings/audit', labelKey: 'audit', permission: 'audit.read' },
        ],
      },
      {
        key: 'cfgCommercial',
        labelKey: 'sub.cfgCommercial',
        children: [
          { key: 'plans', href: '/settings/plans', labelKey: 'plans', permission: 'plans.manage' },
          // Endereços estruturados (cidade IBGE/bairro/rua/CEP). Só BR.
          { key: 'locations', href: '/settings/locations', labelKey: 'locations', permission: 'locations.read', visibleIfCountry: ['BR'] },
          { key: 'tags', href: '/crm/tags', labelKey: 'tags', permission: 'customers.tags.manage' },
        ],
      },
      {
        key: 'cfgFinance',
        labelKey: 'sub.cfgFinance',
        children: [
          { key: 'brBilling', href: '/settings/br-billing', labelKey: 'brBilling', permission: 'efi.config.read', visibleIfCountry: ['BR'] },
        ],
      },
      {
        key: 'cfgFiscal',
        labelKey: 'sub.cfgFiscal',
        children: [
          { key: 'sifenConfig', href: '/settings/sifen', labelKey: 'sifenConfig', permission: 'sifen.config.read', visibleIfCountry: ['PY'] },
          { key: 'nfcomConfig', href: '/settings/nfcom', labelKey: 'nfcomConfig', permission: 'nfcom.config', visibleIfCountry: ['BR'] },
        ],
      },
      {
        key: 'cfgSupport',
        labelKey: 'sub.cfgSupport',
        children: [
          { key: 'serviceOrderReasons', href: '/settings/service-order-reasons', labelKey: 'serviceOrderReasons', permission: 'service_order_reasons.manage' },
          // Conexão WhatsApp (WAHA QR / Meta Cloud) + templates HSM. Módulo netx-call.
          { key: 'whatsappInstances', href: '/settings/whatsapp', labelKey: 'whatsappInstances', permission: 'chat.admin', requiredModules: ['netx-call'] },
          // Chatbot de atendimento (menu + IA agêntica). Módulo netx-call.
          { key: 'chatbot', href: '/settings/whatsapp/bot', labelKey: 'chatbot', permission: 'chat.admin', requiredModules: ['netx-call'] },
          // Respostas rápidas (mensagens predefinidas). chat.send pra ver/usar; gestão da equipe via chat.admin.
          { key: 'quickReplies', href: '/settings/whatsapp/quick-replies', labelKey: 'quickReplies', permission: 'chat.send', requiredModules: ['netx-call'] },
          // Régua de cobrança (múltiplos disparos por regra + canal). Módulo netx-call.
          { key: 'billingRules', href: '/settings/whatsapp/billing', labelKey: 'billingRules', permission: 'chat.admin', requiredModules: ['netx-call'] },
        ],
      },
      {
        key: 'cfgTechnical',
        labelKey: 'sub.cfgTechnical',
        children: [
          { key: 'oltTemplates', href: '/olt-templates', labelKey: 'oltTemplates', permission: 'olts.admin', requiredModules: ['netx-cpe'] },
          { key: 'tr069Profiles', href: '/tr069/profiles', labelKey: 'tr069Profiles', permission: 'tr069.admin', requiredModules: ['netx-cpe'] },
          { key: 'tr069Config', href: '/settings/tr069', labelKey: 'tr069Config', permission: 'tr069.admin', requiredModules: ['netx-cpe'] },
        ],
      },
      {
        key: 'cfgIntegrations',
        labelKey: 'sub.cfgIntegrations',
        children: [
          // Hubsoft — integração de leitura p/ migração (config + sync). Só BR.
          { key: 'hubsoft', href: '/settings/hubsoft', labelKey: 'hubsoft', permission: 'hubsoft.config.read', visibleIfCountry: ['BR'] },
          { key: 'hubsoftImport', href: '/settings/hubsoft/import', labelKey: 'hubsoftImport', permission: 'hubsoft.config.read', visibleIfCountry: ['BR'] },
          // Motor de IA: provider/modelo + fallback de nuvem + teste.
          // Gate por permissão ai.config.read (sem gate de licença hoje).
          { key: 'aiConfig', href: '/settings/ai', labelKey: 'aiConfig', permission: 'ai.config.read' },
        ],
      },
    ],
  },

  // 12. Conta pessoal — sempre visível, isolado no fim.
  {
    key: 'me',
    items: [
      // 'security' não tem permissão: cada user gerencia a própria senha/2FA.
      { key: 'security', href: '/settings/security', labelKey: 'security' },
    ],
  },
];

// -----------------------------------------------------------------------------
// Catálogo flat — só folhas, derivado recursivamente dos grupos. Mantido por
// compat com:
//   - UserForm (checklist de menus)
//   - CommandPalette (busca rápida)
//   - validação `MENU_KEYS` em outros lugares
// -----------------------------------------------------------------------------
function flattenLeaves(items: MenuItem[]): MenuLeaf[] {
  return items.flatMap((it) => (isBranch(it) ? flattenLeaves(it.children) : [it]));
}

export const MENU_CATALOG: MenuLeaf[] = MENU_GROUPS.flatMap((g) => flattenLeaves(g.items));

export const MENU_KEYS = MENU_CATALOG.map((m) => m.key);

/** Helper: entry visível pelo país? Sem restrição = sempre visível. */
function matchesCountry(
  entry: { visibleIfCountry?: string[] },
  country: string | null | undefined,
): boolean {
  if (!entry.visibleIfCountry || entry.visibleIfCountry.length === 0) return true;
  if (!country) return false;
  return entry.visibleIfCountry.includes(country);
}

/**
 * Gating por módulo (entitlement da licença). FAIL-OPEN: sem `entitledModules`
 * (licença ainda carregando, endpoint off, ou instância legada) ⇒ libera, igual
 * ao guard default-permissivo do backend. Entry sem `requiredModules` ⇒ ERP
 * base, sempre liberado. Caso contrário, basta UM módulo da lista estar ativo.
 */
function moduleAllowed(
  m: { requiredModules?: ModuleCode[] },
  entitled: readonly string[] | null | undefined,
): boolean {
  if (!m.requiredModules || !entitled) return true;
  return m.requiredModules.some((mod) => entitled.includes(mod));
}

/** Uma folha passa por todos os filtros (perm/menuAccess/país/módulo)? */
function leafVisible(
  m: MenuLeaf,
  permissions: string[],
  menuAccess: string[] | null | undefined,
  country: string | null | undefined,
  entitledModules: readonly ModuleCode[] | null | undefined,
): boolean {
  if (m.permission && !permissions.includes(m.permission)) return false;
  if (Array.isArray(menuAccess) && !menuAccess.includes(m.key)) return false;
  if (country !== undefined && !matchesCountry(m, country)) return false;
  if (!moduleAllowed(m, entitledModules)) return false;
  return true;
}

/**
 * Resolve quais menus o user pode efetivamente ver (modo flat — usado em
 * validações e na busca que não se importam com agrupamento).
 *
 * `country` é opcional pra compat — quando ausente (undefined), ignora filtro
 * de país. Callers que querem o filtro passam tenant.country.
 */
export function visibleMenus(
  permissions: string[],
  menuAccess: string[] | null | undefined,
  country?: string | null,
  entitledModules?: readonly ModuleCode[] | null,
): MenuLeaf[] {
  return MENU_CATALOG.filter((m) =>
    leafVisible(m, permissions, menuAccess, country, entitledModules),
  );
}

/** Filtra recursivamente os items de um grupo/sub-árvore, dropando vazios. */
function filterItems(
  items: MenuItem[],
  permissions: string[],
  menuAccess: string[] | null | undefined,
  country: string | null | undefined,
  entitledModules: readonly ModuleCode[] | null | undefined,
): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of items) {
    if (isBranch(it)) {
      // Gate da sub-árvore inteira (país/módulo) antes de olhar filhos.
      if (country !== undefined && !matchesCountry(it, country)) continue;
      if (!moduleAllowed(it, entitledModules)) continue;
      const children = filterItems(
        it.children,
        permissions,
        menuAccess,
        country,
        entitledModules,
      ) as MenuLeaf[];
      if (children.length > 0) out.push({ ...it, children });
    } else if (leafVisible(it, permissions, menuAccess, country, entitledModules)) {
      out.push(it);
    }
  }
  return out;
}

/**
 * Variante hierárquica: devolve grupos com items (folhas + sub-árvores) já
 * filtrados. Sub-árvores sem filho visível somem; grupos sem nenhum item
 * visível são excluídos. Grupos com `visibleIfCountry`/`requiredModules` que
 * não batem também somem inteiros.
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
      items: filterItems(g.items, permissions, menuAccess, country, entitledModules),
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

/** Entry está gateado por módulo que NÃO está habilitado? */
function lockedByModule(
  node: { requiredModules?: ModuleCode[] },
  entitled: readonly ModuleCode[],
): boolean {
  return (
    !!node.requiredModules &&
    node.requiredModules.length > 0 &&
    !node.requiredModules.some((m) => entitled.includes(m))
  );
}

/**
 * Módulos gateados por licença que NÃO estão habilitados — em vez de sumir da
 * nav (como `visibleMenuGroups` faz), aparecem como UPSELL ("Disponível ·
 * ativar"). Varre tanto grupos (ex.: Mapeamento, RH) quanto sub-árvores
 * gateadas (ex.: Técnico › Provisionamento). Independe de permissão (é oferta
 * de produto, não navegação).
 *
 * FAIL-OPEN: sem `entitledModules` (licença carregando, off, ou legado ⇒ tudo
 * habilitado) não há nada a ofertar — retorna vazio.
 */
export function upsellMenuGroups(
  country: string | null | undefined,
  entitledModules: readonly ModuleCode[] | null | undefined,
): UpsellModule[] {
  if (!entitledModules) return [];
  const out: UpsellModule[] = [];
  for (const g of MENU_GROUPS) {
    if (country !== undefined && !matchesCountry(g, country)) continue;
    if (lockedByModule(g, entitledModules)) {
      // Grupo inteiro trancado — oferta única, não desce nas sub-árvores.
      out.push({
        key: g.key,
        labelKey: g.labelKey ?? g.key,
        requiredModules: g.requiredModules as ModuleCode[],
      });
      continue;
    }
    // Grupo liberado: procura sub-árvores trancadas por módulo.
    for (const it of g.items) {
      if (isBranch(it) && lockedByModule(it, entitledModules)) {
        out.push({
          key: it.key,
          labelKey: it.labelKey,
          requiredModules: it.requiredModules as ModuleCode[],
        });
      }
    }
  }
  return out;
}
