# NetX NMS — Multi-vendor (Juniper + Mikrotik)

O NMS gerencia **Juniper (Junos)** e **Mikrotik (RouterOS)** pelos mesmos fluxos. A diferença
de cada vendor fica isolada nos drivers do `device-gateway`
(`apps/device-gateway/src/device_gateway/drivers/`) e nas measurements SNMP do Telegraf.

## O que funciona por vendor

| Recurso | Juniper (Junos) | Mikrotik (RouterOS) |
|---|---|---|
| Conectividade | SSH + NETCONF(830) + SNMP | SSH + SNMP (NETCONF = **N/A**) |
| Interfaces / tráfego / erros | IF-MIB | IF-MIB (igual) |
| Temperatura / CPU | jnxOperating | mtxrHealth + HOST-RESOURCES |
| Óptica (DOM SFP) | jnxDom | mtxrOptical |
| Backup de config | `get-config set` | `/export` |
| Playbooks (read-only) | `show ...` | `/... print` |
| Terminal SSH | sim | sim |
| **Aplicar config** | `commit confirmed` (rollback auto) | backup + auto-revert agendado |

## Pré-requisitos no equipamento

### Juniper (Junos)
- NETCONF over SSH habilitado: `set system services netconf ssh` (porta 830).
- SSH habilitado; usuário com classe que permita `show` (e, para apply, `configure`).
- SNMP v2c: `set snmp community <ro-community> authorization read-only` + acesso do coletor.
- Para óptica: transceivers com DOM (a `jnxDomCurrentTable` popula sozinha).

### Mikrotik (RouterOS)
- **SSH** habilitado (`/ip service enable ssh`); usuário com política `ssh,read,write,test`
  (write só é necessário para o fluxo de apply).
- **SNMP** habilitado com community read-only:
  `/snmp set enabled=yes` e `/snmp community add name=<ro-community> addresses=<coletor>/32`.
- **Óptica**: requer SFP/SFP+ com DOM e `/interface ethernet set sfpX sfp-shutdown-temperature=...`
  (a `mtxrOptical` só popula em portas com módulo e leitura habilitada).
- **NETCONF não existe** no RouterOS — o teste de conectividade marca o canal como N/A (não é falha).
- Não é preciso abrir a API binária (8728/8729): o NMS usa **SSH** (Netmiko).

## Aplicar configuração (escrita) — modelo de segurança

Fluxo: **planejar → revisar o diff → aplicar → verificar → confirmar** (AGENTS.md §1, 2, 5, 6).
Só `operator`/`admin`; toda ação é auditada (`audit_log`) e registrada com ciclo de vida
(`config_change`). A IA **nunca** aplica nada.

- **Juniper**: a config (`set ...`) entra como candidate, passa por `commit check` e efetiva com
  `commit confirmed <N>min`. Se o operador não **confirmar** (2º commit) na janela, o Junos reverte.
- **Mikrotik**: como o RouterOS não tem commit atômico, emulamos a rede de segurança — salva um
  backup binário (`netx-rollback`), agenda um auto-revert para `N` min e aplica os comandos.
  O **confirm** cancela o scheduler. Sem confirm, o RouterOS recarrega o backup (reboot → estado bom).
  É mais pesado que o Junos, mas protege contra lockout.

Após o apply, o NMS roda um **verify automático** (connectivity-test) e mostra se o SSH continua
acessível antes de o operador confirmar.

## Resolução de problemas

- **Dashboards de temp/CPU/óptica vazios no Mikrotik**: confirme SNMP habilitado + community correta
  e que o coletor está no `addresses` do `/snmp community`. Rode “snmp+disc” no DeviceManager.
- **Conectividade SSH falha**: cheque usuário/senha no cofre e `/ip service` (porta/allowed-address).
- **Apply Mikrotik reverteu sozinho**: ninguém confirmou na janela — é o comportamento esperado.
  Re-aplique e clique **Confirmar** após validar o acesso.
