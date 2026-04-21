#!/usr/bin/env bash
#
# preflight.sh — rodar antes de git push para prevenir deploy quebrado.
#
# Uso:
#   ./scripts/preflight.sh              # faz tudo (shared + todos os apps)
#   ./scripts/preflight.sh web          # shared + web
#   ./scripts/preflight.sh core-service # shared + core
#   ./scripts/preflight.sh api-gateway  # shared + gateway
#
# Sai com código != 0 se qualquer passo falhar. Projetado pra ser rápido
# quando você mexeu num app só.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TARGET="${1:-all}"
STEP=0
step() {
  STEP=$((STEP+1))
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "[$STEP] $*"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

fail() {
  echo ""
  echo "❌ preflight falhou no passo $STEP: $*" >&2
  exit 1
}

# ── 1) Lockfile em sincronia com package.json ────────────────────────────────
step "Verificando lockfile"
# npm install é idempotente; se nada mudou, não grava nada.
if npm install --no-audit --no-fund --loglevel=warn >/dev/null 2>&1; then
  :
else
  fail "npm install falhou — veja output do npm"
fi
if ! git diff --quiet -- package-lock.json; then
  echo "⚠️  package-lock.json foi modificado pelo npm install."
  echo "    Você provavelmente adicionou/removeu uma dep sem atualizar o lock."
  echo "    Rode:"
  echo "      git add package-lock.json"
  echo "      git commit -m 'chore: update lockfile'"
  fail "lockfile fora de sincronia — commit antes de push"
fi
echo "✅ lockfile ok"

# ── 2) Build do pacote compartilhado (apps consomem o .d.ts/.js emitido) ─────
step "Build de @netx/shared"
npm run build --workspace @netx/shared || fail "build de @netx/shared"

# ── 3) Build dos apps conforme alvo ──────────────────────────────────────────
build_app() {
  local app="$1"
  step "Build de $app"
  npm run build --workspace "$app" || fail "build de $app"
}

case "$TARGET" in
  all)
    build_app core-service
    build_app api-gateway
    build_app web
    ;;
  web|core-service|api-gateway)
    build_app "$TARGET"
    ;;
  *)
    fail "alvo desconhecido: '$TARGET' (use web | core-service | api-gateway | all)"
    ;;
esac

# ── 4) Lint do monorepo ──────────────────────────────────────────────────────
step "Lint"
npm run lint --silent || fail "lint"

echo ""
echo "✅ preflight ok — pode dar git push."
