# Disaster Recovery — backup e restore cifrados (core + NMS)

Um bundle de DR **único e cifrado** captura tudo que um restore fiel precisa: os
bancos (core + NMS/TimescaleDB), o volume de config-backups do NMS e os
**segredos que decifram os dados**. Sem esses segredos, um restore numa máquina
nova sobe a base mas quebra em silêncio (o teste de conexão de integrações
devolve `Unsupported state or unable to authenticate data` e ninguém loga).

Um backup fiel leva **3 coisas juntas**:

1. **`KMS_MASTER_KEY`** (core) — decifra credenciais de equipamento, Ufinet, BTG.
2. **NMS `MASTER_KEY`** — decifra credenciais de device no device-gateway.
3. **`DEFAULT_TENANT_SLUG`** — se não bater com o slug do tenant restaurado, o
   login falha pra todos (o front não envia slug; o backend cai no default).

## Comandos

```
sudo netx-dr-backup [dir_saida]         # gera <dir>/netx-dr-<host>-<ts>.tar.age
sudo netx-restore <bundle.tar.age> [--identity /caminho/age.key]
```

Ambos rodam como root (leem `/etc/netx/.secrets`, `.env.netx` e fazem
`docker exec` no TimescaleDB — coisa que o core-service, rodando como `netx`,
não pode fazer).

## Chave do operador (age)

O box **cifra** o bundle mas **não** o decifra — só o operador, com a chave
privada guardada fora do box (cofre). Setup uma vez:

```
age-keygen -o operador.key            # GUARDE operador.key no cofre; NÃO deixe no box
grep 'public key' operador.key        # copie a linha age1...
```

Em cada box gerenciado, coloque a(s) chave(s) pública(s), uma por linha, em:

```
/etc/netx/dr-recipients.txt           # age1... (pode ter várias linhas = vários operadores)
```

Restore precisa da chave **privada** (passe com `--identity`, ou em
`/etc/netx/dr-operator.key`, ou via env `NETX_DR_AGE_IDENTITY`).

## Conteúdo do bundle

| arquivo | o quê |
|---|---|
| `core.dump` | `pg_dump -Fc` do banco `netx` |
| `nms.dump` | `pg_dump -Fc` do `netx_nms` (TimescaleDB) |
| `nms-config-backups.tar.gz` | volume `config-backups` do NMS |
| `secrets.env` | KMS_MASTER_KEY, JWT_ACCESS/REFRESH/PORTAL_SECRET, DEFAULT_TENANT_SLUG, NMS_MASTER_KEY/JWT/CORE_JWT |
| `manifest.json` | origem, git, tenant slug, timestamp |

## O que o restore faz

1. Decifra + extrai (precisa da chave privada age).
2. Para os serviços do core.
3. Aplica os segredos portáveis no `/etc/netx/.env` (KMS, JWT, slug) — backup em `/root/.env.bak.dr.*`.
4. Recria o banco `netx` + extensions + `pg_restore --no-owner --no-acl` (snapshot pré-restore em `/var/backups/netx/`).
5. `prisma migrate deploy` (aplica migrations mais novas que o dump — forward-compat).
6. NMS: aplica segredos no `.env.netx`, sobe só o `timescaledb`,
   `timescaledb_pre_restore()` → `pg_restore` → `timescaledb_post_restore()`
   (obrigatório por causa das hypertables), restaura o volume, sobe a stack.
7. Restart dos serviços.

## Segurança

- O bundle é **cifrado** (`age`). Mesmo assim, trate-o como material sensível:
  contém a chave-mestra que decifra tudo do cliente.
- `dr-recipients.txt` no box só tem a chave **pública** — inútil pra decifrar.
- A chave **privada** do operador nunca deve viver no box gerenciado.
