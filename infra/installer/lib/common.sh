# shellcheck shell=bash
# =============================================================================
# common.sh — primitivas de logging, helpers, gerenciamento de estado
# =============================================================================

# Cores ANSI (só se TTY)
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'
  C_RED=$'\033[1;31m'
  C_GREEN=$'\033[1;32m'
  C_YELLOW=$'\033[1;33m'
  C_BLUE=$'\033[1;34m'
  C_CYAN=$'\033[1;36m'
  C_DIM=$'\033[2m'
else
  C_RESET="" C_RED="" C_GREEN="" C_YELLOW="" C_BLUE="" C_CYAN="" C_DIM=""
fi

log_info()  { echo "${C_BLUE}[INFO]${C_RESET}  $*"; }
log_ok()    { echo "${C_GREEN}[ OK ]${C_RESET}  $*"; }
log_warn()  { echo "${C_YELLOW}[WARN]${C_RESET}  $*"; }
log_error() { echo "${C_RED}[FAIL]${C_RESET}  $*" >&2; }
log_dim()   { echo "${C_DIM}$*${C_RESET}"; }

log_banner() {
  local msg=$1
  local len=${#msg}
  local line
  printf -v line '%*s' $((len + 4)) ''
  echo
  echo "${C_CYAN}${line// /=}${C_RESET}"
  echo "${C_CYAN}  ${msg}  ${C_RESET}"
  echo "${C_CYAN}${line// /=}${C_RESET}"
  echo
}

# step <id> <fn> — executa fn() e marca como concluído em ${NETX_STATE_DIR}/<id>
# Pulado se já concluído antes (a menos que NETX_FORCE=1).
step() {
  local id=$1
  local fn=$2
  local marker="${NETX_STATE_DIR}/${id}.done"

  mkdir -p "${NETX_STATE_DIR}"

  if [[ -f "${marker}" && "${NETX_FORCE}" != "1" ]]; then
    log_dim "→ ${id}: já concluído (skip — set NETX_FORCE=1 pra refazer)"
    return 0
  fi

  echo
  log_info "→ ${id}: iniciando..."
  local t0
  t0=$(date +%s)

  "${fn}"

  local t1
  t1=$(date +%s)
  log_ok  "← ${id}: concluído em $((t1 - t0))s"
  : > "${marker}"
}

# Gera string aleatória [0-9a-zA-Z], default 32 chars.
#
# A versão antiga era `tr -dc 'A-Za-z0-9' </dev/urandom | head -c LEN`. Em
# Debian 13 com bash 5.2 + pipefail ativo, o `head -c` lê N bytes e fecha o
# pipe — o `tr` lendo `/dev/urandom` infinito recebe SIGPIPE (exit 141) e
# o script morre no `set -e`. Em Debian 12 funcionava por timing.
#
# Solução: usar `openssl rand` que produz output finito (não é stream
# infinito), gerando ~1.5× mais bytes que precisamos (base64 perde alguns
# chars não-alfanuméricos como '+', '/', '=') e cortando no tamanho exato.
gen_secret() {
  local len=${1:-32}
  # openssl rand sempre disponível (instalado por padrão em Debian).
  # base64 produz [A-Za-z0-9+/=]; filtramos pros alfanuméricos.
  local need=$((len * 2))
  openssl rand -base64 "${need}" 2>/dev/null \
    | tr -d '\n+/=' \
    | head -c "${len}"
  echo
}

# Gera HEX (0-9a-f) com N chars exatos. Usado pra KMS_MASTER_KEY que tem regex
# `^[0-9a-f]{64}$` no Zod schema. `gen_secret` (base62) NÃO atende — alfanumérico
# inclui [a-z][A-Z][0-9] e quebra a validação.
#
# `openssl rand -hex N` gera 2N chars hex. Pra obter 64 chars hex (32 bytes),
# precisamos passar `len/2`.
gen_hex_secret() {
  local len=${1:-64}
  local bytes=$((len / 2))
  openssl rand -hex "${bytes}"
}

# Mesma semântica do `secret_get_or_create`, mas usa hex generator. Reuso da
# lógica de persistência via leitura/escrita em ${NETX_ETC}/.secrets.
#
# DEFESA contra valores legados inválidos: se o segredo existente NÃO bater
# com `[0-9a-f]{len}`, regenera e SOBRESCREVE o valor no .secrets. Isso protege
# contra installs que rodaram antes do fix de `secret_get_or_create_hex` (que
# usavam `gen_secret` alfanumérico — quebra Zod regex `^[0-9a-f]{64}$`).
#
# IMPORTANTE: regeneração só é válida quando o valor antigo nunca foi usado
# pra cifrar nada (cenário do bug). Pra KMS_MASTER_KEY ATIVA com dados
# cifrados, NUNCA regerar — torna senhas irrecuperáveis. Por isso a checagem
# é "valor é hex válido" (legado-com-bug = não-hex → regenera; legado-OK
# = hex → preserva).
secret_get_or_create_hex() {
  local key=$1
  local len=${2:-64}
  local file="${NETX_ETC}/.secrets"

  mkdir -p "${NETX_ETC}"
  touch "${file}"
  chmod 600 "${file}"
  chown root:root "${file}"

  local existing
  existing=$(grep -E "^${key}=" "${file}" | cut -d= -f2- || true)
  if [[ -n "${existing}" ]]; then
    # Valida formato. Se está OK (hex com tamanho exato), preserva.
    if [[ "${existing}" =~ ^[0-9a-fA-F]{${len}}$ ]]; then
      echo -n "${existing}"
      return
    fi
    # Valor legado em formato inválido — regenera e substitui no arquivo.
    log_warn "Regenerando ${key} (valor existente não é hex válido — bug de installer antigo)"
    local newval
    newval=$(gen_hex_secret "${len}")
    # Substitui in-place no .secrets (sed -i é seguro porque o arquivo é
    # root-only e nada mais escreve nele em paralelo).
    sed -i "s|^${key}=.*|${key}=${newval}|" "${file}"
    echo -n "${newval}"
    return
  fi

  local value
  value=$(gen_hex_secret "${len}")
  printf '%s=%s\n' "${key}" "${value}" >> "${file}"
  echo -n "${value}"
}

# Slugify — converte "Minha ISP, Ltda" → "minha-isp-ltda".
# Bate com a `slugify()` em scripts/seed-admin.ts pra que o slug do tenant
# criado pelo seed seja o mesmo gravado em DEFAULT_TENANT_SLUG.
slugify() {
  local input=$1
  # 1) lowercase
  # 2) strip diacríticos via iconv (ASCII//TRANSLIT)
  # 3) sanitiza: tudo fora de [a-z0-9] vira '-'
  # 4) compacta '-' duplos e remove dos extremos
  # 5) limita a 50 chars
  local out
  out=$(printf '%s' "${input}" | iconv -f UTF-8 -t ASCII//TRANSLIT 2>/dev/null \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' \
    | head -c 50)
  if [[ -z "${out}" ]]; then
    out='tenant'
  fi
  printf '%s' "${out}"
}

# Substitui ${VAR} no template por env vars (envsubst). Usa variáveis listadas
# explicitamente pra não vazar nada inesperado.
render_template() {
  local src=$1
  local dst=$2
  shift 2
  local vars
  vars=$(printf '${%s} ' "$@")

  if [[ ! -f "${src}" ]]; then
    log_error "Template ausente: ${src}"
    return 1
  fi
  envsubst "${vars}" < "${src}" > "${dst}.tmp"
  mv "${dst}.tmp" "${dst}"
}

# Backup de arquivo antes de modificar (idempotente: backup só uma vez)
backup_file() {
  local f=$1
  if [[ -f "${f}" && ! -f "${f}.netx-orig" ]]; then
    cp -a "${f}" "${f}.netx-orig"
  fi
}

# Persiste segredo em /etc/netx/.secrets (root only). Salva uma vez só;
# leituras subsequentes pegam o mesmo valor.
secret_get_or_create() {
  local key=$1
  local len=${2:-32}
  local file="${NETX_ETC}/.secrets"

  mkdir -p "${NETX_ETC}"
  touch "${file}"
  chmod 600 "${file}"
  chown root:root "${file}"

  local existing
  existing=$(grep -E "^${key}=" "${file}" | cut -d= -f2- || true)
  if [[ -n "${existing}" ]]; then
    echo -n "${existing}"
    return
  fi

  local value
  value=$(gen_secret "${len}")
  printf '%s=%s\n' "${key}" "${value}" >> "${file}"
  echo -n "${value}"
}

# Roda um comando como o user netx
as_netx() {
  install -d -o "${NETX_USER}" -g "${NETX_USER}" "${NETX_HOME}"
  sudo -u "${NETX_USER}" -H bash -lc "$*"
}

# psql como superuser local (peer auth)
psql_super() {
  sudo -u postgres psql -v ON_ERROR_STOP=1 "$@"
}

# Detecta IP público (best effort, pra mostrar no summary)
detect_public_ip() {
  local ip
  ip=$(ip -4 -o route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}') || true
  if [[ -z "${ip}" ]]; then
    ip=$(hostname -I 2>/dev/null | awk '{print $1}') || true
  fi
  echo -n "${ip:-127.0.0.1}"
}

# Verifica se um serviço systemd está active
service_is_active() {
  systemctl is-active --quiet "$1" 2>/dev/null
}

# Aguarda porta TCP aceitar conexões (timeout segs)
wait_port() {
  local host=$1 port=$2 timeout=${3:-30}
  local i=0
  while ! (echo > "/dev/tcp/${host}/${port}") 2>/dev/null; do
    i=$((i + 1))
    if (( i >= timeout )); then
      return 1
    fi
    sleep 1
  done
  return 0
}

# Imprime resumo final ao usuário.
#
# Divide o output em duas partes:
#
# 1) "Public summary" — vai pra stdout (que é tee'd pra `${NETX_INSTALL_LOG}`,
#    chmod 640, legível pelo grupo `adm` por padrão no Debian). NÃO contém
#    secrets — só URL, email do admin, nome do tenant.
#
# 2) "Sensitive summary" — vai pra `/dev/tty` (NÃO é capturado pelo tee, porque
#    o exec redirect inicial só interceptou file descriptor 1/2 do processo).
#    Contém a senha do admin em texto puro. Se não houver tty (instalação
#    headless via curl|bash sem terminal interativo), persiste num arquivo
#    `${NETX_ETC}/install-credentials.txt` chmod 600 root:root e instrui o
#    operador a lê-lo.
print_summary() {
  local ip
  ip=$(detect_public_ip)
  local url="${NETX_DOMAIN:-${ip}}"

  cat <<EOF

${C_GREEN}NetX está rodando.${C_RESET}

  ${C_CYAN}URL:${C_RESET}            http://${url}/
  ${C_CYAN}Admin:${C_RESET}          ${NETX_ADMIN_EMAIL}
  ${C_CYAN}Tenant:${C_RESET}         ${NETX_TENANT_NAME} (${NETX_TENANT_COUNTRY})

  ${C_CYAN}Logs install:${C_RESET}   ${NETX_INSTALL_LOG}
  ${C_CYAN}Config:${C_RESET}         ${NETX_ETC}/.env
  ${C_CYAN}Secrets:${C_RESET}        ${NETX_ETC}/.secrets (root only)
  ${C_CYAN}App:${C_RESET}            ${NETX_HOME}

Serviços systemd:
  systemctl status netx-core-service netx-api-gateway netx-web freeradius
EOF

  # Senha admin: nunca escrever no log. Imprime no terminal real OU persiste
  # em arquivo root-only, conforme disponibilidade do TTY.
  local creds_file="${NETX_ETC}/install-credentials.txt"
  local creds_msg
  printf -v creds_msg '%s\nAdmin email: %s\nAdmin senha: %s\nTenant:      %s\nURL:         http://%s/\n' \
    "Credenciais do primeiro login (gerado pelo installer):" \
    "${NETX_ADMIN_EMAIL}" \
    "${NETX_ADMIN_PASSWORD}" \
    "${NETX_TENANT_NAME}" \
    "${url}"

  if [[ -w /dev/tty ]]; then
    printf '\n%s%s%s\n' "${C_YELLOW}" "${creds_msg}" "${C_RESET}" > /dev/tty
    echo "${C_DIM}(senha não foi gravada em ${NETX_INSTALL_LOG} — anote agora ou re-leia em ${creds_file})${C_RESET}" > /dev/tty
  fi

  # Persistir num arquivo root-only é defesa-em-profundidade: se o operador
  # rodou via `curl|bash` num shell sem TTY anexado, ele ainda consegue
  # recuperar a senha sem precisar de db reset.
  umask 077
  printf '%s' "${creds_msg}" > "${creds_file}"
  chmod 600 "${creds_file}"
  chown root:root "${creds_file}"

  echo
  echo "${C_DIM}Credenciais de admin salvas em ${creds_file} (root only, chmod 600).${C_RESET}"
}
