import type { DeviceVendor } from '../devices/device.dto.js';

/**
 * Catálogo de playbooks read-only, multi-vendor. Cada playbook mapeia o comando
 * equivalente por vendor (Junos `show ...`, RouterOS `/... print`, IOS-XE `show ip ...`).
 * Um playbook só aparece para um vendor se tiver comando definido para ele.
 *
 * Todo comando IOS-XE precisa começar com `show` — o driver recusa o resto (o exec do
 * IOS aceitaria `reload`/`copy` na mesma sessão).
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
    commands: {
      juniper: 'show route summary',
      mikrotik: '/ip route print count-only',
      cisco_iosxe: 'show ip route summary',
      parks: 'show ip route summary',
    },
  },
  {
    id: 'ospf-neighbors',
    name: 'Vizinhos OSPF',
    commands: {
      juniper: 'show ospf neighbor',
      mikrotik: '/routing ospf neighbor print',
      cisco_iosxe: 'show ip ospf neighbor',
      parks: 'show ip ospf neighbor',
    },
  },
  {
    id: 'bgp-summary',
    name: 'Resumo BGP',
    commands: {
      juniper: 'show bgp summary',
      mikrotik: '/routing bgp session print',
      cisco_iosxe: 'show ip bgp summary',
      parks: 'show ip bgp summary',
    },
  },
  {
    id: 'interfaces-terse',
    name: 'Interfaces',
    commands: {
      juniper: 'show interfaces terse',
      mikrotik: '/interface print',
      cisco_iosxe: 'show ip interface brief',
      parks: 'show interface brief',
    },
  },
  {
    id: 'system-uptime',
    name: 'Uptime do sistema',
    commands: {
      juniper: 'show system uptime',
      mikrotik: '/system resource print',
      // No IOS o uptime só existe dentro do `show version` — filtra para não voltar a saída inteira.
      cisco_iosxe: 'show version | include uptime',
      parks: 'show version',
    },
  },
  {
    id: 'chassis-hardware',
    name: 'Hardware',
    commands: {
      juniper: 'show chassis hardware',
      mikrotik: '/system routerboard print',
      cisco_iosxe: 'show inventory',
      parks: 'show version',
    },
  },
  {
    id: 'chassis-environment',
    name: 'Ambiente (temp/fans)',
    commands: {
      juniper: 'show chassis environment',
      mikrotik: '/system health print',
      cisco_iosxe: 'show environment all',
      parks: 'show temperature',
    },
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
