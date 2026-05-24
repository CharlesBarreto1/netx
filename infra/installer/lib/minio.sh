# shellcheck shell=bash
# =============================================================================
# minio.sh — MinIO (S3-compatible) pra fotos/uploads do app NetX Mobile
# =============================================================================
# Instala MinIO via binário oficial (Debian não tem pacote APT mantido),
# cria systemd unit, gera access/secret keys, garante bucket netx-photos.
#
# Bind: 127.0.0.1:9000 (API) + 127.0.0.1:9001 (console). nginx faz reverse
# proxy de /minio/* → API. Console fica restrito a tunnel SSH (porta interna).
#
# Storage local em /var/lib/netx/minio. Backups: o netx-backup.sh já cobre
# /var/lib/netx via tar — fotos entram no mesmo dump.
# =============================================================================

NETX_MINIO_USER="${NETX_MINIO_USER:-minio-user}"
NETX_MINIO_DATA_DIR="${NETX_VAR}/minio"
NETX_MINIO_BIN="/usr/local/bin/minio"
NETX_MINIO_MC_BIN="/usr/local/bin/mc"
NETX_MINIO_BUCKET="${NETX_MINIO_BUCKET:-netx-photos}"

minio_setup() {
  # 1) System user pra MinIO (não-login, sem shell)
  if ! id -u "${NETX_MINIO_USER}" >/dev/null 2>&1; then
    log_info "Criando system user ${NETX_MINIO_USER}"
    useradd --system --no-create-home --shell /usr/sbin/nologin "${NETX_MINIO_USER}"
  fi

  install -d -o "${NETX_MINIO_USER}" -g "${NETX_MINIO_USER}" -m 0750 "${NETX_MINIO_DATA_DIR}"

  # 2) Binários MinIO + mc (CLI)
  local arch="${MINIO_ARCH:-amd64}"
  case "$(uname -m)" in
    aarch64|arm64) arch="arm64" ;;
    x86_64|amd64)  arch="amd64" ;;
  esac

  if [[ ! -x "${NETX_MINIO_BIN}" ]]; then
    log_info "Baixando MinIO server (${arch})"
    curl -fsSL "https://dl.min.io/server/minio/release/linux-${arch}/minio" -o "${NETX_MINIO_BIN}"
    chmod +x "${NETX_MINIO_BIN}"
  else
    log_dim "MinIO server já presente em ${NETX_MINIO_BIN}"
  fi

  if [[ ! -x "${NETX_MINIO_MC_BIN}" ]]; then
    log_info "Baixando MinIO Client (mc)"
    curl -fsSL "https://dl.min.io/client/mc/release/linux-${arch}/mc" -o "${NETX_MINIO_MC_BIN}"
    chmod +x "${NETX_MINIO_MC_BIN}"
  fi

  # 3) Credenciais root — persistidas em .secrets
  local access_key secret_key
  access_key=$(secret_get_or_create NETX_MINIO_ACCESS_KEY 24)
  secret_key=$(secret_get_or_create NETX_MINIO_SECRET_KEY 40)
  export NETX_MINIO_ACCESS_KEY="${access_key}"
  export NETX_MINIO_SECRET_KEY="${secret_key}"

  # 4) Config /etc/default/minio (consumido pelo systemd unit)
  local conf=/etc/default/minio
  cat > "${conf}" <<EOF
MINIO_ROOT_USER=${access_key}
MINIO_ROOT_PASSWORD=${secret_key}
MINIO_VOLUMES="${NETX_MINIO_DATA_DIR}"
MINIO_OPTS="--address 127.0.0.1:9000 --console-address 127.0.0.1:9001"
MINIO_BROWSER=on
EOF
  chmod 640 "${conf}"
  chown root:"${NETX_MINIO_USER}" "${conf}"

  # 5) systemd unit
  local unit=/etc/systemd/system/minio.service
  cat > "${unit}" <<EOF
[Unit]
Description=MinIO object storage (NetX uploads)
Documentation=https://min.io/docs/minio/linux/index.html
Wants=network-online.target
After=network-online.target
AssertFileIsExecutable=${NETX_MINIO_BIN}

[Service]
Type=notify
User=${NETX_MINIO_USER}
Group=${NETX_MINIO_USER}
EnvironmentFile=${conf}
ExecStart=${NETX_MINIO_BIN} server \$MINIO_OPTS \$MINIO_VOLUMES
Restart=on-failure
RestartSec=5
LimitNOFILE=65536
TasksMax=infinity
TimeoutStopSec=infinity
SendSIGKILL=no

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable minio
  systemctl restart minio

  # Espera o MinIO subir (até 30s)
  local i=0
  while ! curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; do
    i=$((i + 1))
    if (( i >= 30 )); then
      log_error "MinIO não respondeu em 30s. Confere: journalctl -u minio"
      exit 1
    fi
    sleep 1
  done

  # 6) Cria/atualiza alias `mc` apontando pro server local + cria bucket
  "${NETX_MINIO_MC_BIN}" alias set netx-local http://127.0.0.1:9000 \
    "${access_key}" "${secret_key}" --api S3v4 >/dev/null

  if "${NETX_MINIO_MC_BIN}" ls "netx-local/${NETX_MINIO_BUCKET}" >/dev/null 2>&1; then
    log_dim "Bucket ${NETX_MINIO_BUCKET} já existe"
  else
    log_info "Criando bucket ${NETX_MINIO_BUCKET}"
    "${NETX_MINIO_MC_BIN}" mb "netx-local/${NETX_MINIO_BUCKET}"
  fi

  # Policy: bucket privado (presigned URLs cuidam do acesso)
  "${NETX_MINIO_MC_BIN}" anonymous set none "netx-local/${NETX_MINIO_BUCKET}" >/dev/null 2>&1 || true

  export NETX_MINIO_ENDPOINT="http://127.0.0.1:9000"
  export NETX_MINIO_BUCKET="${NETX_MINIO_BUCKET}"
  # URL pública via nginx — o que mobile/web usam pra baixar fotos via
  # presigned URL. Em prod com TLS, o certbot vai trocar pra https://.
  # Sem domínio configurado (instância PY rodando por IP), usa o IP.
  local host="${NETX_NGINX_SERVER_NAME:-${NETX_DOMAIN:-127.0.0.1}}"
  if [[ -z "${host}" || "${host}" == "_" ]]; then
    host="127.0.0.1"
  fi
  export NETX_MINIO_PUBLIC_URL="http://${host}/minio"

  log_ok "MinIO em ${NETX_MINIO_ENDPOINT} (bucket: ${NETX_MINIO_BUCKET}, public: ${NETX_MINIO_PUBLIC_URL})"
}
