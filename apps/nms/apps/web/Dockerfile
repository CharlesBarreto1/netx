# NetX NMS — imagem do front (Vite build servido por nginx, que faz proxy /api e /ws/terminal).
# Build a partir da RAIZ do repo:
#   docker build -f apps/web/Dockerfile -t netx-nms-web .

FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Ver nota no Dockerfile da api: libera build scripts no build limpo do pnpm 11.
RUN pnpm install --frozen-lockfile --config.dangerouslyAllowAllBuilds=true
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @netx-nms/shared build \
  && pnpm --filter @netx-nms/web build

# ── Runtime: nginx servindo os estáticos ─────────────────────────────────────
FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
