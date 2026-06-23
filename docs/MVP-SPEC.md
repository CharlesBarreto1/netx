# NetX NMS — Spec do MVP (Juniper)

Escopo em uma frase: **observar, documentar e diagnosticar uma rede Juniper, sem aplicar configuração pela
ferramenta.** O fluxo flagship "desenhar enlace no mapa e aplicar" fica para a fase 2.

Por que Juniper primeiro: o modelo transacional do Junos (config candidata, `commit confirmed`, `rollback N`)
dá rede de proteção de fábrica, e o ecossistema Python é o mais maduro (NAPALM `junos` por cima do PyEZ via
NETCONF na porta 830, com retorno em XML estruturado).

---

## Pilar 1 — Fundação

Pré-requisito de todo o resto. Entrega:

- Cadastro de equipamento: hostname, IP de gerência, modelo, versão de Junos, site.
- Credenciais no cofre (Vault; no mínimo cripto em repouso com chave por instância).
- Teste de conectividade ao adicionar um device, validando os três canais: SSH responde, NETCONF (830)
  responde, comunidade SNMP funciona.

## Pilar 2 — SNMP (coleta contínua)

- Use **Telegraf** com input SNMP gravando no TimescaleDB. Não escreva poller próprio no MVP.
- MIBs padrão: IF-MIB (tráfego, erros, status de interface).
- MIBs Juniper: `jnxBoxAnatomy` e `jnxOperating*` (temperatura, CPU, fonte) e DOM óptico dos transceivers
  (níveis de luz — onde mora metade dos problemas de provedor).
- Receptor de **traps** (input `snmp_trap` do Telegraf) para evento em tempo real, além do polling.

## Pilar 3 — SSH (coleta estruturada e blocos de comando)

- Use **PyEZ (`junos-eznc`)** para coleta: `get_route_information`, `get_ospf_neighbor_information`, status BGP —
  tudo retorna XML estruturado, sem parsing frágil de texto.
- Modele "blocos de comando" como **playbooks nomeados** (ex.: "diagnóstico de interface", "status OSPF do enlace X").
  No MVP, predominantemente **leitura**, executados com confirmação e gravando auditoria
  (quem rodou, quando, em qual device, com qual saída).
- Bloco que altera config é permitido só atrás de `commit confirmed`.

## Pilar 4 — Backup (apólice de seguro)

- Puxe a config via PyEZ (`get_config` em `set` e em XML) periodicamente e a cada mudança detectada.
- **Comite num repositório git** → histórico, diff e "quem mudou o quê" de graça.
- Recurso-chave: ao detectar diff inesperado (mudança via CLI fora da ferramenta), dispara alerta com o diff legível.
- Oxidized é referência se quiser não reinventar; com PyEZ + git você resolve sob medida.

## Pilar 5 — IA (comece humilde)

Três degraus, entregues nesta ordem (do barato ao caro):

1. **Detecção estatística de anomalia** sobre o TSDB: baseline móvel + z-score para CRC subindo, luz óptica
   degradando, temperatura/CPU fora da curva. Não precisa de LLM.
2. **Inteligência sobre mudança de config**: quando o backup gera um diff, o LLM resume "o que mudou e provável
   impacto" em português.
3. **Copiloto**: pergunta como "por que a `ge-0/0/3` está com erro?" → a IA usa os dados já coletados
   (métricas + eventos + config) para montar hipótese citando evidências.

Trava inegociável: no MVP a **IA nunca executa nada**. Explica e sugere; humano roda.

---

## Modelo de dados mínimo

- `Device` — hostname, mgmt_ip, vendor=juniper, model, os_version, site, credentials_ref.
- `Interface` — populada pela coleta (nome, descrição, admin/oper status, speed).
- `MetricPoint` — no TSDB (device_id, metric, value, ts).
- `Event` — traps/syslog normalizados (device_id, severity, type, message, ts).
- `ConfigSnapshot` — referência ao hash git + diff do anterior.
- `AuditLog` — quem, quando, device, comando/RPC, diff, resultado.

Resista a modelar IPAM completo ou topologia agora — fase 2.

## Definição de pronto

O MVP está fechado quando você consegue:

1. Adicionar um Juniper e ele auto-descobre as interfaces e começa a coletar.
2. Ver no dashboard tráfego, erros, temperatura e luz óptica ao vivo.
3. Rodar o backup que versiona no git e alerta em mudança inesperada.
4. Executar um bloco de comando de diagnóstico com auditoria.
5. Ver a IA apontar uma anomalia real (ex.: CRC subindo) com o copiloto explicando o porquê.

## Fora do MVP (não construir agora)

Outros vendors (Cisco/Huawei/Nokia/Mikrotik); fluxo de desenhar-e-aplicar no mapa; IPAM/source-of-truth
completo; multi-tenant; qualquer remediação automática pela IA.
