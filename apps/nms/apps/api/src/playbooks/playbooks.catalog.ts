import type { DeviceVendor } from '../devices/device.dto.js';

/**
 * Catálogo de playbooks read-only, multi-vendor. Cada playbook mapeia o comando
 * equivalente por vendor (Junos `show ...` vs RouterOS `/... print`). Um playbook
 * só aparece para um vendor se tiver comando definido para ele.
 */
export interface Playbook {
  id: string;
  name: string;
  commands: Partial<Record<DeviceVendor, string>>;
}

export const PLAYBOOKS: Playbook[] = [
  {
    id: 'route-summary',
    name: 'Resumo de rotas',
    commands: { juniper: 'show route summary', mikrotik: '/ip route print count-only' },
  },
  {
    id: 'ospf-neighbors',
    name: 'Vizinhos OSPF',
    commands: { juniper: 'show ospf neighbor', mikrotik: '/routing ospf neighbor print' },
  },
  {
    id: 'bgp-summary',
    name: 'Resumo BGP',
    commands: { juniper: 'show bgp summary', mikrotik: '/routing bgp session print' },
  },
  {
    id: 'interfaces-terse',
    name: 'Interfaces',
    commands: { juniper: 'show interfaces terse', mikrotik: '/interface print' },
  },
  {
    id: 'system-uptime',
    name: 'Uptime do sistema',
    commands: { juniper: 'show system uptime', mikrotik: '/system resource print' },
  },
  {
    id: 'chassis-hardware',
    name: 'Hardware',
    commands: { juniper: 'show chassis hardware', mikrotik: '/system routerboard print' },
  },
  {
    id: 'chassis-environment',
    name: 'Ambiente (temp/fans)',
    commands: { juniper: 'show chassis environment', mikrotik: '/system health print' },
  },
];

export function findPlaybook(id: string): Playbook | undefined {
  return PLAYBOOKS.find((p) => p.id === id);
}

/** Comando do playbook para o vendor, ou undefined se não houver equivalente. */
export function resolveCommand(playbook: Playbook, vendor: DeviceVendor): string | undefined {
  return playbook.commands[vendor];
}

/** Playbooks disponíveis para um vendor (com o comando já resolvido). */
export function playbooksForVendor(
  vendor: DeviceVendor,
): { id: string; name: string; command: string }[] {
  return PLAYBOOKS.flatMap((p) => {
    const command = p.commands[vendor];
    return command ? [{ id: p.id, name: p.name, command }] : [];
  });
}
