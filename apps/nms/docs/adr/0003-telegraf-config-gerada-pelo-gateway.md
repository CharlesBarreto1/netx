# ADR 0003 — Config de coleta SNMP do Telegraf gerada pelo gateway

- Status: aceito
- Data: 2026-06-19

## Contexto

O AGENTS.md (Pilar 2) obriga **usar Telegraf** para coleta SNMP — não escrever poller
próprio. Mas o Telegraf precisa da **community SNMP em texto claro** na sua config para
pollar, enquanto a §4 manda que credenciais fiquem cifradas no cofre e que **só o
device-gateway** as decifre. Há, portanto, uma tensão a resolver.

Além disso, os devices são dinâmicos (cadastrados via API/banco), mas a config do Telegraf
é estática em arquivo.

## Decisão

O **device-gateway gera a config SNMP do Telegraf** a partir do banco:

- A API lê os devices que têm community cadastrada e enfileira um job `sync-snmp-config`
  carregando a lista `{ deviceId, mgmtIp, snmpCommunityEnc, version }` (apenas **ciphertext**).
- O gateway (que tem a chave-mestra) **decifra** cada community e escreve um arquivo por device
  em `telegraf.d/snmp-<deviceId>.conf` (input SNMP com IF-MIB + MIBs Juniper + DOM óptico).
- O Telegraf roda com `--config-directory` + `--watch-config` e **recarrega sozinho** quando
  um arquivo **já existente** muda (ex.: troca de community). **Limitação conhecida**: arquivo
  **novo** (device novo) só é carregado num restart do Telegraf — o watcher só observa os
  arquivos presentes no start. Workaround MVP: reiniciar o Telegraf ao adicionar o 1º device;
  refinamento futuro = disparar reload do Telegraf (SIGHUP) ao materializar config nova.
- A regeneração é disparada quando uma credencial é gravada (e por endpoint manual).

Consequência da §4: a community fica **em claro no arquivo gerado**, no host on-prem (acesso
restrito ao serviço). A **decifragem continua só no gateway**; a API nunca vê a community em
claro. É o mínimo necessário para o Telegraf funcionar — documentado aqui conscientemente.

## Consequências

- Nenhum poller próprio; Telegraf como mandado.
- O diretório `telegraf.d/` é um volume compartilhado entre gateway e Telegraf (em produção,
  ambos on-prem). Os arquivos gerados NÃO entram no git (contêm segredo) — gitignored.
- Migrar para Vault no futuro troca "arquivo no host" por "segredo no Vault" sem mexer no
  resto (o gateway segue sendo quem materializa a config).

## Alternativas

- **SNMPv3** (sem community): exige reconfigurar v3 no equipamento e ainda guarda chaves
  auth/priv no config do Telegraf — não elimina o segredo em arquivo. Rejeitado p/ MVP.
- **Gateway lê o banco direto** (asyncpg): quebraria a fronteira "API dona do modelo, gateway
  responde pela fila". Mantido o padrão de job.
