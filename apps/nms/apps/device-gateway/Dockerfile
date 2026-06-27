# NetX NMS — imagem do device-gateway (Python 3.12 + uv).
# ÚNICO serviço autorizado a falar com equipamento (AGENTS.md §3/§4). Inclui as libs `devices`.
# Build a partir da RAIZ do repo:
#   docker build -f apps/device-gateway/Dockerfile -t netx-nms-device-gateway .

FROM python:3.12-slim-bookworm AS runtime
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

# Libs de sistema p/ lxml (junos-eznc), paramiko/cryptography, cliente SSH e
# ferramentas de teste de rede (probe do host: job network-test ping/traceroute).
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libxml2-dev libxslt1-dev libssl-dev libffi-dev openssh-client \
    iputils-ping traceroute \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependências primeiro (cache): instala o grupo `devices` sem o projeto.
COPY apps/device-gateway/pyproject.toml apps/device-gateway/uv.lock ./
RUN uv sync --frozen --no-dev --extra devices --no-install-project

# Código + instalação do projeto.
COPY apps/device-gateway/src ./src
COPY apps/device-gateway/contracts ./contracts
RUN uv sync --frozen --no-dev --extra devices

# O gateway escuta o terminal em 0.0.0.0 para a API (outro container) alcançar.
ENV TELEGRAF_CONFIG_DIR=/etc/telegraf/telegraf.d \
    TERMINAL_HOST=0.0.0.0 \
    TERMINAL_PORT=8766
EXPOSE 8766
CMD ["uv", "run", "device-gateway"]
