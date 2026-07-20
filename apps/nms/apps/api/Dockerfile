# NetX NMS — imagem da API (NestJS + Prisma).
# Build a partir da RAIZ do repo (monorepo pnpm):
#   docker build -f apps/api/Dockerfile -t netx-nms-api .

FROM node:22-bookworm-slim AS build
RUN corepack enable && apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# Manifests primeiro para cache de dependências.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Build limpo: o pnpm 11 exige aprovação explícita dos build scripts (prisma/esbuild/etc.).
# Aqui são deps fixas e já verificadas pelo lockfile, então liberamos no contexto do build.
RUN pnpm install --frozen-lockfile --config.dangerouslyAllowAllBuilds=true

# Código + build (shared → prisma client → api).
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @netx-nms/shared build \
  && pnpm --filter @netx-nms/api exec prisma generate \
  && pnpm --filter @netx-nms/api build

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
# `git` NÃO é opcional: o backup de config versiona cada snapshot num repo git
# (backup-git.ts). Sem o binário, todo backup morre com `spawn git ENOENT` DEPOIS
# de já ter puxado a config do equipamento — o job parece ter dado certo e nada é salvo.
RUN corepack enable && apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates wget git \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
# Copia o workspace já instalado e compilado (inclui o Prisma Client gerado).
COPY --from=build /repo /repo
WORKDIR /repo/apps/api

EXPOSE 3000
# Healthcheck bate no endpoint público /health.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=10 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

# O entrypoint roda `prisma migrate deploy` antes de subir a API (idempotente).
ENTRYPOINT ["./docker-entrypoint.sh"]
