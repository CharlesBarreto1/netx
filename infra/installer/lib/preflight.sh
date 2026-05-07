# shellcheck shell=bash
# =============================================================================
# preflight.sh — checks de ambiente antes de tocar em nada
# =============================================================================

preflight_check() {
  preflight_root
  preflight_os
  preflight_arch
  preflight_resources
  preflight_network
  preflight_required_tools
}

preflight_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    log_error "Esse instalador precisa rodar como root (use sudo)."
    exit 1
  fi
}

preflight_os() {
  if [[ ! -r /etc/os-release ]]; then
    log_error "/etc/os-release não encontrado — não é Debian?"
    exit 1
  fi
  # shellcheck disable=SC1091
  . /etc/os-release

  if [[ "${ID:-}" != "debian" ]]; then
    log_warn "Distro detectada: ${ID:-?} ${VERSION_ID:-?}"
    log_warn "Esse instalador é testado em Debian 13 (Trixie). Continuando mesmo assim..."
    return 0
  fi

  local major="${VERSION_ID%%.*}"
  if [[ -z "${major}" ]]; then
    # Trixie ainda como testing pode não ter VERSION_ID
    if [[ "${VERSION_CODENAME:-}" == "trixie" ]]; then
      log_ok "Debian Trixie detectado"
      return 0
    fi
    log_warn "VERSION_ID ausente — tipicamente Debian testing/sid. Seguindo."
    return 0
  fi

  if (( major < 12 )); then
    log_error "Debian ${major} é antigo demais. Recomendado: 13 (Trixie). Mínimo: 12 (Bookworm)."
    exit 1
  fi
  log_ok "Debian ${VERSION_ID} (${VERSION_CODENAME:-?}) suportado"
}

preflight_arch() {
  local arch
  arch=$(dpkg --print-architecture)
  case "${arch}" in
    amd64|arm64) log_ok "Arquitetura ${arch} suportada" ;;
    *) log_error "Arquitetura ${arch} não suportada (precisa amd64 ou arm64)"; exit 1 ;;
  esac
}

preflight_resources() {
  local mem_kb
  mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
  local mem_gb=$(( mem_kb / 1024 / 1024 ))
  if (( mem_gb < 2 )); then
    log_warn "RAM detectada: ${mem_gb} GB. Recomendado: 4 GB+ pra produção."
  else
    log_ok "RAM: ${mem_gb} GB"
  fi

  local disk_avail_gb
  disk_avail_gb=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
  if (( disk_avail_gb < 5 )); then
    log_error "Disco livre em /: ${disk_avail_gb} GB. Mínimo 5 GB."
    exit 1
  fi
  log_ok "Disco livre em /: ${disk_avail_gb} GB"
}

preflight_network() {
  if ! getent hosts deb.debian.org >/dev/null 2>&1; then
    log_error "Sem resolução DNS pra deb.debian.org — confere /etc/resolv.conf"
    exit 1
  fi
  log_ok "DNS funcionando"
}

preflight_required_tools() {
  # Garante o básico — apt vai instalar o resto depois
  local missing=()
  for cmd in apt-get curl ca-certificates; do
    if ! command -v "${cmd}" >/dev/null 2>&1 && ! dpkg -s "${cmd}" >/dev/null 2>&1; then
      missing+=("${cmd}")
    fi
  done
  if (( ${#missing[@]} > 0 )); then
    log_info "Instalando ferramentas básicas: ${missing[*]}"
    apt-get update -qq
    apt-get install -y -qq "${missing[@]}"
  fi
  log_ok "Ferramentas básicas presentes"
}
