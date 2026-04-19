# Infra — Local Development

Containers para desenvolvimento local. **Não usar em produção.**

## Serviços

| Serviço | Porta | UI |
|---------|-------|----|
| PostgreSQL 16 | `5432` | http://localhost:8080 (Adminer) |
| Redis 7 | `6379` | — |
| RabbitMQ 3.13 | `5672` / `15672` | http://localhost:15672 (`netx` / `netx_dev_password`) |
| MailHog | `1025` (SMTP) / `8025` (web) | http://localhost:8025 |
| Adminer | `8080` | http://localhost:8080 |

## Comandos

```bash
# Subir tudo
docker compose -f infra/docker/docker-compose.yml up -d

# Ver logs em tempo real
docker compose -f infra/docker/docker-compose.yml logs -f

# Derrubar (mantendo dados)
docker compose -f infra/docker/docker-compose.yml down

# Derrubar e apagar volumes (RESET completo)
docker compose -f infra/docker/docker-compose.yml down -v
```

## Credenciais padrão

| Onde | Usuário | Senha |
|------|---------|-------|
| Postgres | `netx` | `netx_dev_password` |
| RabbitMQ | `netx` | `netx_dev_password` |

Essas credenciais só valem em dev. Sobrescreva via `.env` antes de subir.
