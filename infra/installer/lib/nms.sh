# shellcheck shell=bash
# =============================================================================
# nms.sh — módulo NMS (Docker) — stack do ecossistema via apps/nms/infra/up-netx.sh
# =============================================================================
# Sobe a API do NMS em 127.0.0.1:3300 — exatamente onde o api-gateway aponta
# (NMS_SERVICE_PORT default). Sem ela no ar, /v1/nms responde "NMS fora do ar".
# Mesmo caminho que o netx-update usa (update_nms), pra fresh install já sair
# com o módulo funcionando em vez de esperar o primeiro update.
#
# Best-effort: sem Docker (ex.: NETX_SKIP_WHATSAPP=1 pulou a instalação) ou com
# falha na subida, o resto do NetX segue normal. Pule com NETX_NMS_SKIP=1.

nms_setup() {
  if [[ "${NETX_NMS_SKIP:-0}" == "1" ]]; then
    log_dim "NMS: pulado (NETX_NMS_SKIP=1)"
    return 0
  fi
  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    log_warn "NMS: Docker/compose indisponível — módulo não subiu (depois: sudo netx-update)"
    return 0
  fi
  local eco="${NETX_HOME}/apps/nms/infra/up-netx.sh"
  if [[ ! -f "${eco}" ]]; then
    log_dim "NMS: ${eco} ausente no repo — pulando"
    return 0
  fi

  log_info "Subindo módulo NMS (Docker — API em 127.0.0.1:3300)"
  # env -i: o installer carrega .env/.secrets no shell (WEB_PORT, NETX_DB_* etc)
  # e no `docker compose` variável de ambiente SOBREPÕE o --env-file — sem
  # isolar, a stack do NMS interpolaria valores da PLATAFORMA (a web do NMS
  # colidiria na :3200 e creds do banco vazariam). Mesmo racional do netx-update.
  if env -i \
       PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
       HOME="${HOME:-/root}" \
       GITHUB_TOKEN="${GITHUB_TOKEN:-}" \
       bash "${eco}"; then
    log_ok "NMS no ar (stack do ecossistema; API em 127.0.0.1:3300)"
  else
    log_warn "NMS: up-netx.sh falhou — não-fatal. Investigue com:"
    log_warn "  docker compose -f ${NETX_HOME}/apps/nms/infra/docker-compose.netx.yml --env-file ${NETX_HOME}/apps/nms/infra/.env.netx logs api"
    log_warn "  (ou re-tente com: sudo netx-update)"
  fi
}
