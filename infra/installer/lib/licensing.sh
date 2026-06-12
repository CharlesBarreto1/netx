# shellcheck shell=bash
# =============================================================================
# licensing.sh — enrollment da instância no licenciamento da NetX.
#
# Roda ANTES do netx_app (que renderiza o .env lendo estas vars):
#   - NETX_INSTANCE_ID: uuid estável desta instalação. Gerado uma vez e
#     persistido em /etc/netx/.secrets (re-runs mantêm o mesmo id).
#   - NETX_HUB_URL / NETX_LICENSE_KEY: credenciais do Hub. Vêm por env
#     (instalação unattended provisionada) ou ficam vazias → licenciamento
#     DESLIGADO (fail-open, padrão). Em produção, o enrollment real é feito
#     no cadastro do licenciado no Hub; aqui só persistimos o que veio.
#
# Idempotente: re-rodar não regenera o instanceId nem apaga credenciais já
# salvas. Ver docs/licensing.md.
# =============================================================================

# Lê valor de uma chave do .secrets (vazio se ausente).
_lic_secret_get() {
  local key=$1 file="${NETX_ETC}/.secrets"
  [[ -f "${file}" ]] || return 0
  grep -E "^${key}=" "${file}" | cut -d= -f2- | head -n1 || true
}

# Grava/atualiza key=value no .secrets (upsert).
_lic_secret_set() {
  local key=$1 value=$2 file="${NETX_ETC}/.secrets"
  mkdir -p "${NETX_ETC}"
  touch "${file}"; chmod 600 "${file}"; chown root:root "${file}"
  sed -i "/^${key}=/d" "${file}" 2>/dev/null || true
  printf '%s=%s\n' "${key}" "${value}" >> "${file}"
}

licensing_enroll() {
  mkdir -p "${NETX_ETC}"

  # ── Instance ID (uuid estável) ───────────────────────────────────────────
  local instance
  instance=$(_lic_secret_get NETX_INSTANCE_ID)
  if [[ -z "${instance}" ]]; then
    # /proc/.../uuid sempre existe no Linux; uuidgen como fallback.
    if [[ -r /proc/sys/kernel/random/uuid ]]; then
      instance=$(cat /proc/sys/kernel/random/uuid)
    elif command -v uuidgen >/dev/null 2>&1; then
      instance=$(uuidgen)
    else
      instance=$(openssl rand -hex 16 | sed -E 's/(.{8})(.{4})(.{4})(.{4})(.{12})/\1-\2-\3-\4-\5/')
    fi
    _lic_secret_set NETX_INSTANCE_ID "${instance}"
    log_info "Instance ID gerado: ${instance}"
  else
    log_dim "→ instance id já existe: ${instance}"
  fi
  export NETX_INSTANCE_ID="${instance}"

  # ── Hub URL + License Key ────────────────────────────────────────────────
  # Prioridade: env (provisionamento) > .secrets (re-run) > vazio (off).
  local hub key
  hub="${NETX_HUB_URL:-$(_lic_secret_get NETX_HUB_URL)}"
  key="${NETX_LICENSE_KEY:-$(_lic_secret_get NETX_LICENSE_KEY)}"
  [[ -n "${hub}" ]] && _lic_secret_set NETX_HUB_URL "${hub}"
  [[ -n "${key}" ]] && _lic_secret_set NETX_LICENSE_KEY "${key}"
  export NETX_HUB_URL="${hub}"
  export NETX_LICENSE_KEY="${key}"

  if [[ -n "${hub}" && -n "${key}" ]]; then
    log_ok "Licenciamento LIGADO (hub: ${hub})"
  else
    log_dim "→ licenciamento desligado (sem NETX_HUB_URL/NETX_LICENSE_KEY) — fail-open"
  fi
}
