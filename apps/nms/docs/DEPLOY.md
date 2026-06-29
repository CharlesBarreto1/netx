# NetX NMS — Deploy (produção on-prem)

Cada cliente roda a própria instância via `docker compose`, com imagens versionadas do GHCR.
As apps **não** são compiladas no servidor do cliente — o GitHub Actions builda e publica.

## Pré-requisitos no servidor

- **SO**: Debian 12/13 (Trixie) ou Ubuntu, **amd64** (as imagens das apps são amd64; ARM ainda não).
- **Docker Engine + Compose v2**: o installer instala automaticamente se faltar (ver abaixo).
- Saída de rede para `ghcr.io` (puxar imagens) e alcance L3 aos equipamentos: Juniper (SSH/NETCONF/SNMP)
  e Mikrotik (SSH/SNMP). Ver `docs/MULTIVENDOR.md` para o que cada vendor exige.
- As imagens do GHCR devem estar **públicas** (ou faça `docker login ghcr.io` antes; e use `GITHUB_TOKEN` no installer
  se o Release for privado).

## Instalação num Debian 13 limpo (uma linha)

```bash
curl -fsSL https://raw.githubusercontent.com/CharlesBarreto1/NetX-NMS/main/scripts/install.sh | sudo bash
```

> Use `sudo` (ou rode como root): o installer instala o Docker e escreve em `/opt/netx-nms`.
> Se o Docker não estiver presente, ele pergunta antes de instalar (repo oficial da Docker via apt).
> Em provisionamento **não-interativo** (cloud-init/Ansible), passe `NETX_YES=1` para pular a confirmação.

Variáveis opcionais: `NETX_DIR` (default `/opt/netx-nms`), `NETX_VERSION` (default `latest`),
`WEB_PORT` (default `8080`), `NETX_YES=1` (confirma instalação do Docker sem prompt),
`GITHUB_TOKEN` (só se repo/release privado).

O `install.sh`:

1. **instala o Docker Engine + Compose** se faltar (Debian/Ubuntu, com confirmação);
2. baixa o bundle de deploy do Release (`netx-nms-stack.tar.gz`);
3. gera `.env` com segredos aleatórios (`POSTGRES_PASSWORD`, `JWT_SECRET`, `MASTER_KEY`, senha do admin);
4. `docker compose pull` + `up -d`;
5. espera a API ficar saudável e **imprime a senha do admin uma única vez**.

Painel: `http://<servidor>:8080`. Primeiro login com o admin mostrado no fim da instalação.

> Idempotente: rodar de novo num diretório já instalado preserva o `.env` (não regenera segredos).

### Instalar o Docker manualmente (opcional)

Se preferir não deixar o installer mexer em pacotes, instale o Docker antes e rode o one-liner depois:

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2   # ou o repo oficial da Docker
```

## Atualização

No diretório de instalação:

```bash
cd /opt/netx-nms
./update.sh            # última release
./update.sh v1.4.0     # versão específica
```

Faz backup do banco em `backups/`, troca a tag das imagens, sobe (as migrations rodam no boot da API),
verifica a saúde e, **se a API não subir, faz rollback automático** para a versão anterior.

## Operação

```bash
cd /opt/netx-nms
docker compose logs -f api          # logs da API (inclui a senha do admin no 1º boot, se ADMIN_PASSWORD vazio)
docker compose ps                   # status
docker compose down                 # parar (volumes preservados)
```

Segredos vivem só no `.env` (chmod 600). A `MASTER_KEY` do cofre é usada **apenas** pelo `device-gateway`
(AGENTS.md §4). Para trocar um segredo, edite o `.env` e rode `docker compose up -d`.

## Publicar uma versão (mantenedor)

```bash
git tag v1.4.0 && git push origin v1.4.0     # dispara o workflow release.yml
```

O Actions builda/publica `netx-nms-{api,web,device-gateway}:v1.4.0` (+ `latest`) no GHCR e cria o Release
com o bundle. Ver `.github/workflows/release.yml` e ADR 0007 (auth).
