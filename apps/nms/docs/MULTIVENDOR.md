# NetX NMS — Multi-vendor (Juniper + Mikrotik + Cisco IOS-XE)

O NMS gerencia **Juniper (Junos)**, **Mikrotik (RouterOS)** e **Cisco IOS-XE** (ASR 920/903/1000,
ISR, Catalyst) pelos mesmos fluxos. A diferença de cada vendor fica isolada nos drivers do
`device-gateway` (`apps/device-gateway/src/device_gateway/drivers/`) e nas measurements SNMP do
Telegraf.

> O **IOS-XR** (ASR 9000) NÃO é atendido pelo driver `cisco_iosxe`: o modelo de commit é outro
> (two-stage nativo) e os comandos `show` mudam. Entra como vendor próprio quando for o caso.

## O que funciona por vendor

| Recurso | Juniper (Junos) | Mikrotik (RouterOS) | Cisco IOS-XE |
|---|---|---|---|
| Conectividade | SSH + NETCONF(830) + SNMP | SSH + SNMP (NETCONF = **N/A**) | SSH + SNMP (NETCONF = **N/A**) |
| Interfaces / tráfego / erros | IF-MIB | IF-MIB (igual) | IF-MIB (igual) |
| Temperatura / CPU | jnxOperating | mtxrHealth + HOST-RESOURCES | CISCO-ENTITY-SENSOR + CISCO-PROCESS |
| Óptica (DOM SFP) | jnxDom | mtxrOptical | CISCO-ENTITY-SENSOR (sensores dBm) |
| Backup de config | `get-config set` | `/export` | `show running-config` |
| Playbooks (read-only) | `show ...` | `/... print` | `show ip ...` |
| Terminal SSH | sim | sim | sim |
| **Aplicar config** | `commit confirmed` (rollback auto) | backup + auto-revert agendado | `configure terminal revert timer` |

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

### Cisco IOS-XE (ASR 920/903/1000, ISR, Catalyst)
- **SSH** habilitado (`ip ssh version 2` + `transport input ssh` nas vty); usuário com
  `privilege 15` (necessário para entrar em config mode no fluxo de apply; leitura funciona
  com menos, mas os `show` do catálogo assumem exec privilegiado).
- **SNMP v2c** read-only: `snmp-server community <ro-community> RO` (+ ACL liberando o coletor).
- **Config archive é PRÉ-REQUISITO para aplicar config** — sem ele o `configure terminal revert
  timer` não tem para onde voltar. Configure no equipamento:
  ```
  archive
   path flash:netx-archive
   maximum 5
   write-memory
  ```
  O driver checa (`show archive`) e **recusa o apply** se não estiver configurado, em vez de
  escrever sem rede de segurança. Leitura, backup, playbooks e terminal funcionam sem isso.
- **Óptica**: os valores de DOM vêm da CISCO-ENTITY-SENSOR-MIB, indexados por entidade física
  (não por ifIndex). O NMS deriva a interface do `entPhysicalName`
  (`"Te0/0/2 Transceiver Receive Power Sensor"` → `Te0/0/2`) e aplica a escala do
  `entSensorPrecision`, que varia por plataforma.
- **NETCONF**: o IOS-XE 16.x+ até fala NETCONF, mas o NMS gerencia por SSH — o canal aparece
  como N/A no teste de conectividade (não é falha).

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
- **Cisco IOS-XE**: usa o rollback **nativo** do IOS. O driver entra em config mode já com
  `configure terminal revert timer <N>` (o rollback é armado ANTES da primeira linha, então uma
  queda de sessão no meio do apply também está coberta) e aplica os comandos. O **confirm** manda
  `configure confirm` **+ `write memory`** — sem o `write memory` a mudança viveria só na
  running-config e sumiria no próximo reload. Sem confirm, o IOS restaura sozinho, sem reboot.
  Como o IOS não devolve diff pronto, o driver captura a running-config antes e depois e monta um
  diff unificado. O `plan` (dry-run) **não toca o equipamento** — o IOS-XE não tem candidate
  config, então o plan é a lista de comandos que seria aplicada.

Após o apply, o NMS roda um **verify automático** (connectivity-test) e mostra se o SSH continua
acessível antes de o operador confirmar.

## Resolução de problemas

- **Dashboards de temp/CPU/óptica vazios no Mikrotik**: confirme SNMP habilitado + community correta
  e que o coletor está no `addresses` do `/snmp community`. Rode “snmp+disc” no DeviceManager.
- **Conectividade SSH falha**: cheque usuário/senha no cofre e `/ip service` (porta/allowed-address).
- **Apply Mikrotik reverteu sozinho**: ninguém confirmou na janela — é o comportamento esperado.
  Re-aplique e clique **Confirmar** após validar o acesso.
- **Apply Cisco recusado com "config archive não habilitado"**: é a trava de segurança. Configure o
  bloco `archive` (acima) no equipamento e tente de novo — o NMS não aplica sem rollback disponível.
- **Óptica Cisco vazia**: a porta pode não ter módulo com DOM, ou o sensor está `unavailable`
  (o NMS só lê sensores com `entSensorStatus = ok`). Confirme com `show interfaces transceiver`.
- **Mudança Cisco sumiu depois de um reload**: o `write memory` só roda no **Confirmar**. Se a
  janela expirou e o IOS reverteu, ou se ninguém confirmou, a config nunca foi para o startup.
