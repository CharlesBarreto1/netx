/** Catálogo de playbooks read-only do MVP (Juniper). Todos são comandos `show`. */
export interface Playbook {
  id: string;
  name: string;
  command: string;
}

export const PLAYBOOKS: Playbook[] = [
  { id: 'route-summary', name: 'Resumo de rotas', command: 'show route summary' },
  { id: 'ospf-neighbors', name: 'Vizinhos OSPF', command: 'show ospf neighbor' },
  { id: 'bgp-summary', name: 'Resumo BGP', command: 'show bgp summary' },
  { id: 'interfaces-terse', name: 'Interfaces (terse)', command: 'show interfaces terse' },
  { id: 'system-uptime', name: 'Uptime do sistema', command: 'show system uptime' },
  { id: 'chassis-hardware', name: 'Hardware do chassi', command: 'show chassis hardware' },
  { id: 'chassis-environment', name: 'Ambiente (temp/fans)', command: 'show chassis environment' },
];

export function findPlaybook(id: string): Playbook | undefined {
  return PLAYBOOKS.find((p) => p.id === id);
}
