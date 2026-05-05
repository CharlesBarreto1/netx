/**
 * Catálogo central de menus (sidebar).
 *
 * Cada item tem:
 *   - `key`         — string estável usada em `User.menuAccess` para
 *     liberar/ocultar individualmente (NÃO renomear sem migrar valores no DB).
 *   - `href`        — rota Next.js.
 *   - `labelKey`    — chave em `messages/<locale>.ts` namespace `nav`.
 *   - `permission`  — código de permissão exigido (RBAC). Sem perm → não vê.
 *
 * Ordem do array = ordem na sidebar.
 *
 * Como o checklist na tela de Usuários funciona:
 *   1. Admin abre o user em /settings/users/[id].
 *   2. Marca/desmarca menus.
 *   3. Salvamos `menuAccess: string[]` ou `null`.
 *      - `null`  → sem override (sidebar mostra todos os menus que o user
 *        tem permissão pra acessar).
 *      - `[]`    → array vazio = nenhum menu visível (login só, sem nav).
 *      - `[...]` → intersecção: menu só aparece se a `key` está no array E
 *        o user tem a permissão.
 */

export interface MenuDef {
  key: string;
  href: string;
  labelKey: string; // ex.: 'dashboard', 'sales', resolvido em namespace 'nav'
  permission?: string;
}

export const MENU_CATALOG: MenuDef[] = [
  { key: 'dashboard', href: '/dashboard', labelKey: 'dashboard' },
  { key: 'sales', href: '/deals', labelKey: 'sales', permission: 'deals.read' },
  { key: 'customers', href: '/customers', labelKey: 'customers', permission: 'customers.read' },
  { key: 'contracts', href: '/contracts', labelKey: 'contracts', permission: 'contracts.read' },
  { key: 'serviceOrders', href: '/service-orders', labelKey: 'serviceOrders', permission: 'service_orders.read' },
  { key: 'charges', href: '/finance/charges', labelKey: 'charges', permission: 'finance.charges.read' },
  { key: 'reports', href: '/reports', labelKey: 'reports', permission: 'reports.read' },
  { key: 'tags', href: '/crm/tags', labelKey: 'tags', permission: 'customers.tags.manage' },
  { key: 'settings', href: '/settings/tenant', labelKey: 'settings', permission: 'tenants.update' },
  { key: 'cashRegisters', href: '/settings/cash-registers', labelKey: 'cashRegisters', permission: 'cash_registers.manage' },
  { key: 'serviceOrderReasons', href: '/settings/service-order-reasons', labelKey: 'serviceOrderReasons', permission: 'service_order_reasons.manage' },
  { key: 'users', href: '/settings/users', labelKey: 'users', permission: 'users.read' },
  { key: 'backups', href: '/settings/backups', labelKey: 'backups', permission: 'backups.manage' },
];

/** Lookup por key, útil em validações server-side. */
export const MENU_KEYS = MENU_CATALOG.map((m) => m.key);

/**
 * Resolve quais menus o user pode efetivamente ver.
 *  - filtra por permissão
 *  - se `menuAccess` for array, intersecta
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
