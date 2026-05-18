# shellcheck shell=bash
# =============================================================================
# wizard.sh — coleta interativa de dados (domínio, admin, tenant)
# =============================================================================

wizard_run() {
  if [[ "${NETX_SKIP_WIZARD}" == "1" ]]; then
    log_info "NETX_SKIP_WIZARD=1 — usando defaults/env vars"
    wizard_apply_defaults
    return
  fi

  if [[ ! -t 0 ]]; then
    log_warn "stdin não é TTY — pulando wizard, usando defaults/env"
    wizard_apply_defaults
    return
  fi

  if ! command -v whiptail >/dev/null 2>&1; then
    log_warn "whiptail ausente — usando defaults/env"
    wizard_apply_defaults
    return
  fi

  log_banner "Configuração inicial"

  # Domínio
  if [[ -z "${NETX_DOMAIN}" ]]; then
    NETX_DOMAIN=$(whiptail --inputbox \
      "Domínio onde o NetX vai responder (ex: netx.suaempresa.com).\nDeixe vazio pra usar IP.\nO instalador configura HTTPS via Let's Encrypt automaticamente." \
      11 70 "" --title "Domínio" 3>&1 1>&2 2>&3) || NETX_DOMAIN=""
  fi
  export NETX_DOMAIN

  # Email pra Let's Encrypt — só pergunta se domínio foi setado
  if [[ -n "${NETX_DOMAIN}" && -z "${NETX_LETSENCRYPT_EMAIL}" ]]; then
    NETX_LETSENCRYPT_EMAIL=$(whiptail --inputbox \
      "E-mail pra notificações do certificado SSL (Let's Encrypt):\n(Use o mesmo do admin se preferir)" \
      10 70 "${NETX_ADMIN_EMAIL:-admin@${NETX_DOMAIN}}" --title "Let's Encrypt" 3>&1 1>&2 2>&3) || NETX_LETSENCRYPT_EMAIL=""
  fi
  export NETX_LETSENCRYPT_EMAIL

  # Admin email
  if [[ -z "${NETX_ADMIN_EMAIL}" ]]; then
    NETX_ADMIN_EMAIL=$(whiptail --inputbox \
      "E-mail do admin inicial:" \
      10 70 "admin@netx.local" --title "Admin" 3>&1 1>&2 2>&3) || NETX_ADMIN_EMAIL="admin@netx.local"
  fi
  export NETX_ADMIN_EMAIL

  # Admin senha
  if [[ -z "${NETX_ADMIN_PASSWORD}" ]]; then
    local choice
    choice=$(whiptail --menu "Senha do admin:" 12 60 2 \
      "auto" "Gerar aleatória (recomendado)" \
      "manual" "Definir agora" \
      --title "Senha admin" 3>&1 1>&2 2>&3) || choice="auto"

    if [[ "${choice}" == "manual" ]]; then
      while true; do
        local p1 p2
        p1=$(whiptail --passwordbox "Digite a senha (mínimo 8 chars, com maiúscula, minúscula, número e símbolo):" \
          10 70 --title "Senha admin" 3>&1 1>&2 2>&3) || p1=""
        p2=$(whiptail --passwordbox "Confirme a senha:" \
          10 70 --title "Senha admin" 3>&1 1>&2 2>&3) || p2=""
        if [[ "${p1}" == "${p2}" && ${#p1} -ge 8 ]]; then
          NETX_ADMIN_PASSWORD="${p1}"
          break
        fi
        whiptail --msgbox "Senhas não conferem ou muito curtas. Tenta de novo." 8 60
      done
    else
      NETX_ADMIN_PASSWORD="$(gen_secret 16)Aa1!"
    fi
  fi
  export NETX_ADMIN_PASSWORD

  # Operação (= empresa/ISP). Cada instância NetX atende UMA empresa.
  if [[ "${NETX_TENANT_NAME}" == "NetX Default" ]]; then
    NETX_TENANT_NAME=$(whiptail --inputbox \
      "Nome da sua empresa (ISP) — ex: 'NET Telecom Asunción':" \
      10 70 "Minha ISP" --title "Operação" 3>&1 1>&2 2>&3) || NETX_TENANT_NAME="Minha ISP"
  fi
  export NETX_TENANT_NAME

  # País / locale / moeda
  local country
  country=$(whiptail --menu "País do tenant:" 14 60 4 \
    "PY" "Paraguai (es-PY, PYG)" \
    "BR" "Brasil (pt-BR, BRL)" \
    "AR" "Argentina (es-AR, ARS)" \
    "OTHER" "Outro (preenche depois)" \
    --title "País" 3>&1 1>&2 2>&3) || country="${NETX_TENANT_COUNTRY}"

  case "${country}" in
    PY) NETX_TENANT_LOCALE="es-PY"; NETX_TENANT_CURRENCY="PYG" ;;
    BR) NETX_TENANT_LOCALE="pt-BR"; NETX_TENANT_CURRENCY="BRL" ;;
    AR) NETX_TENANT_LOCALE="es-AR"; NETX_TENANT_CURRENCY="ARS" ;;
    *)  NETX_TENANT_LOCALE="es-PY"; NETX_TENANT_CURRENCY="PYG" ;;
  esac
  NETX_TENANT_COUNTRY="${country}"
  export NETX_TENANT_COUNTRY NETX_TENANT_LOCALE NETX_TENANT_CURRENCY

  # Confirmação
  whiptail --yesno "Configuração:

Domínio:    ${NETX_DOMAIN:-(IP do servidor)}
Admin:      ${NETX_ADMIN_EMAIL}
Empresa:    ${NETX_TENANT_NAME} (${NETX_TENANT_COUNTRY}/${NETX_TENANT_LOCALE}/${NETX_TENANT_CURRENCY})

Confirma e inicia instalação?" 14 70 --title "Confirmar"

  # Persiste config em .secrets pra re-runs idempotentes
  mkdir -p "${NETX_ETC}"
  touch "${NETX_ETC}/.secrets"
  chmod 600 "${NETX_ETC}/.secrets"
  sed -i '/^NETX_ADMIN_EMAIL=/d;/^NETX_ADMIN_PASSWORD=/d;/^NETX_DOMAIN=/d;/^NETX_LETSENCRYPT_EMAIL=/d' "${NETX_ETC}/.secrets" 2>/dev/null || true
  printf 'NETX_ADMIN_EMAIL=%s\nNETX_ADMIN_PASSWORD=%s\nNETX_DOMAIN=%s\nNETX_LETSENCRYPT_EMAIL=%s\n' \
    "${NETX_ADMIN_EMAIL}" "${NETX_ADMIN_PASSWORD}" "${NETX_DOMAIN}" "${NETX_LETSENCRYPT_EMAIL}" >> "${NETX_ETC}/.secrets"

  log_ok "Wizard concluído"
}

wizard_apply_defaults() {
  mkdir -p "${NETX_ETC}"
  touch "${NETX_ETC}/.secrets"
  chmod 600 "${NETX_ETC}/.secrets"

  # 1) Email — usa env, ou recupera do .secrets, ou default
  if [[ -z "${NETX_ADMIN_EMAIL}" ]]; then
    NETX_ADMIN_EMAIL=$(grep '^NETX_ADMIN_EMAIL=' "${NETX_ETC}/.secrets" 2>/dev/null | cut -d= -f2-)
    [[ -z "${NETX_ADMIN_EMAIL}" ]] && NETX_ADMIN_EMAIL="admin@netx.local"
  fi

  # 2) Password — usa env, ou recupera do .secrets, ou gera novo
  if [[ -z "${NETX_ADMIN_PASSWORD}" ]]; then
    NETX_ADMIN_PASSWORD=$(grep '^NETX_ADMIN_PASSWORD=' "${NETX_ETC}/.secrets" 2>/dev/null | cut -d= -f2-)
    if [[ -z "${NETX_ADMIN_PASSWORD}" ]]; then
      NETX_ADMIN_PASSWORD="$(gen_secret 16)Aa1!"
      log_warn ""
      log_warn "============================================================"
      log_warn "  CREDENCIAIS DE ADMIN GERADAS AUTOMATICAMENTE (wizard skip)"
      log_warn "  email: ${NETX_ADMIN_EMAIL}"
      log_warn "  senha: ${NETX_ADMIN_PASSWORD}"
      log_warn "============================================================"
      log_warn ""
    fi
  fi

  # Persiste em .secrets pra re-runs futuros + print_summary recuperar
  sed -i '/^NETX_ADMIN_EMAIL=/d;/^NETX_ADMIN_PASSWORD=/d' "${NETX_ETC}/.secrets" 2>/dev/null || true
  printf 'NETX_ADMIN_EMAIL=%s\nNETX_ADMIN_PASSWORD=%s\n' \
    "${NETX_ADMIN_EMAIL}" "${NETX_ADMIN_PASSWORD}" >> "${NETX_ETC}/.secrets"

  export NETX_ADMIN_EMAIL NETX_ADMIN_PASSWORD
}
