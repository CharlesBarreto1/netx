# device-gateway

O **único** serviço autorizado a falar com equipamentos (AGENTS.md §3–4). Consome jobs da
fila `device-jobs` (Redis/BullMQ), executa via PyEZ/NAPALM/Netmiko e devolve resultado
estruturado. A API (Node) nunca abre SSH/NETCONF — só enfileira.

## Dev

```bash
uv sync                    # deps base (Fase 0)
uv sync --extra devices    # + libs de equipamento (Fase 1: napalm, junos-eznc, netmiko, pysnmp)
uv run pytest              # testes
uv run ruff check .        # lint
uv run device-gateway      # sobe o worker
```

`contracts/*.schema.json` são gerados por `pnpm --filter @netx-nms/shared export:schema`
e validados aqui — não edite à mão.
