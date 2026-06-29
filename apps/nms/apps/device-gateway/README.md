# device-gateway

O **único** serviço autorizado a falar com equipamentos (AGENTS.md §3–4). Consome jobs da
fila `device-jobs` (Redis/BullMQ), executa via PyEZ/NAPALM/Netmiko e devolve resultado
estruturado. A API (Node) nunca abre SSH/NETCONF — só enfileira.

**Multi-vendor por driver** (`src/device_gateway/drivers/`): `juniper` (PyEZ/NETCONF) e
`mikrotik` (Netmiko/SSH). `get_driver(vendor)` resolve o driver; o worker escolhe a porta de
gerência por vendor (NETCONF/830 no Junos, SSH/22 no RouterOS). Escrita de config (`apply-config`)
usa rede de segurança: `commit confirmed` no Junos, backup + auto-revert agendado no RouterOS.
Ver `docs/MULTIVENDOR.md`.

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
