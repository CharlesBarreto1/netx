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

  # Precisamos do terminal real. Em `curl | sudo bash` o stdin é o pipe do curl
  # (não é TTY) e o install.sh redireciona stdout/stderr pro tee do log — então
  # falamos DIRETO com /dev/tty (o terminal da sessão), que existe mesmo em modo
  # pipe. Sem /dev/tty (cron/CI/provisionamento headless) → defaults/env.
  if [[ ! -r /dev/tty || ! -w /dev/tty ]]; then
    log_warn "sem terminal interativo (/dev/tty indisponível) — pulando wizard, usando defaults/env"
    wizard_apply_defaults
    return
  fi

  wizard_prompts
  log_ok "Wizard concluído"
}

# ── Helpers de prompt (texto puro via /dev/tty, fd 3) ────────────────────────
# Trocamos o whiptail por prompts de texto: whiptail quebra ao COLAR (terminais
# modernos usam "bracketed paste" e envolvem o texto em escapes que ele não
# entende, corrompendo a tela). Texto puro é robusto em qualquer terminal/SSH e
# não depende de pacote nenhum. Tudo lê/escreve no fd 3 (=/dev/tty).

# Pergunta de texto: _ask VARNAME "Pergunta" "default"
_wz_ask() {
  local __var=$1 __prompt=$2 __def=${3:-} __ans=""
  if [[ -n "${__def}" ]]; then
    printf '%s [%s]: ' "${__prompt}" "${__def}" >&3
  else
    printf '%s: ' "${__prompt}" >&3
  fi
  # read com IFS default já apara espaços nas pontas; -r preserva backslashes.
  read -r __ans <&3 || __ans=""
  __ans="${__ans%$'\r'}"                 # remove CR (PuTTY/Windows paste)
  [[ -z "${__ans}" ]] && __ans="${__def}"
  printf -v "${__var}" '%s' "${__ans}"
}

# Senha sem eco, com confirmação e tamanho mínimo: _ask_password VARNAME
_wz_ask_password() {
  local __var=$1 __p1="" __p2=""
  while true; do
    printf 'Senha do admin (mín. 8 caracteres): ' >&3
    read -rs __p1 <&3 || __p1=""; printf '\n' >&3
    printf 'Confirme a senha: ' >&3
    read -rs __p2 <&3 || __p2=""; printf '\n' >&3
    if [[ "${__p1}" != "${__p2}" ]]; then
      printf '  → as senhas não conferem, tente de novo.\n' >&3; continue
    fi
    if [[ ${#__p1} -lt 8 ]]; then
      printf '  → mínimo 8 caracteres, tente de novo.\n' >&3; continue
    fi
    printf -v "${__var}" '%s' "${__p1}"
    return
  done
}

# Prompts interativos do wizard. Abre fd 3 no terminal real e desliga o
# bracketed-paste mode (a causa do "bug ao colar"). NÃO usa log_* aqui (essas
# vão pro tee/arquivo) — escreve direto no fd 3 pra aparecer na tela.
wizard_prompts() {
  exec 3<>/dev/tty
  printf '\033[?2004l' >&3   # desliga bracketed paste — colar vira texto limpo

  {
    printf '\n'
    printf '═══════════════════════════════════════════════════════════\n'
    printf '  NetX — Configuração inicial\n'
    printf '  (Enter aceita o valor entre [colchetes])\n'
    printf '═══════════════════════════════════════════════════════════\n\n'
  } >&3

  # Domínio (opcional)
  if [[ -z "${NETX_DOMAIN}" ]]; then
    printf 'Domínio onde o NetX vai responder (ex: netx.suaempresa.com).\n' >&3
    printf 'Deixe vazio pra usar o IP do servidor (sem HTTPS automático).\n' >&3
    _wz_ask NETX_DOMAIN "Domínio" ""
  fi
  export NETX_DOMAIN

  # E-mail Let's Encrypt — só se houver domínio
  if [[ -n "${NETX_DOMAIN}" && -z "${NETX_LETSENCRYPT_EMAIL}" ]]; then
    _wz_ask NETX_LETSENCRYPT_EMAIL "E-mail pro certificado SSL (Let's Encrypt)" \
      "${NETX_ADMIN_EMAIL:-admin@${NETX_DOMAIN}}"
  fi
  export NETX_LETSENCRYPT_EMAIL

  # E-mail do admin (valida formato básico)
  if [[ -z "${NETX_ADMIN_EMAIL}" ]]; then
    while true; do
      _wz_ask NETX_ADMIN_EMAIL "E-mail do admin inicial" "admin@netx.local"
      [[ "${NETX_ADMIN_EMAIL}" == *@*.* || "${NETX_ADMIN_EMAIL}" == *@* ]] && break
      printf '  → e-mail inválido, tente de novo.\n' >&3
    done
  fi
  export NETX_ADMIN_EMAIL

  # Senha do admin
  if [[ -z "${NETX_ADMIN_PASSWORD}" ]]; then
    local pwchoice=""
    printf '\nSenha do admin:\n' >&3
    printf '  1) Gerar aleatória (recomendado)\n' >&3
    printf '  2) Definir agora\n' >&3
    _wz_ask pwchoice "Escolha" "1"
    if [[ "${pwchoice}" == "2" ]]; then
      _wz_ask_password NETX_ADMIN_PASSWORD
    else
      NETX_ADMIN_PASSWORD="$(gen_secret 16)Aa1!"
      printf '  → senha aleatória gerada (aparece no resumo final).\n' >&3
    fi
  fi
  export NETX_ADMIN_PASSWORD

  # Empresa (ISP)
  if [[ "${NETX_TENANT_NAME}" == "NetX Default" ]]; then
    _wz_ask NETX_TENANT_NAME "Nome da sua empresa (ISP)" "Minha ISP"
  fi
  export NETX_TENANT_NAME

  # País → locale/moeda
  local country=""
  printf '\nPaís da operação:\n' >&3
  printf '  1) Paraguai  (es-PY, PYG)\n' >&3
  printf '  2) Brasil    (pt-BR, BRL)\n' >&3
  printf '  3) Argentina (es-AR, ARS)\n' >&3
  printf '  4) Outro     (preenche depois)\n' >&3
  _wz_ask country "Escolha" "1"
  case "${country}" in
    1|PY|py) NETX_TENANT_COUNTRY="PY"; NETX_TENANT_LOCALE="es-PY"; NETX_TENANT_CURRENCY="PYG" ;;
    2|BR|br) NETX_TENANT_COUNTRY="BR"; NETX_TENANT_LOCALE="pt-BR"; NETX_TENANT_CURRENCY="BRL" ;;
    3|AR|ar) NETX_TENANT_COUNTRY="AR"; NETX_TENANT_LOCALE="es-AR"; NETX_TENANT_CURRENCY="ARS" ;;
    *)       NETX_TENANT_COUNTRY="PY"; NETX_TENANT_LOCALE="es-PY"; NETX_TENANT_CURRENCY="PYG" ;;
  esac
  export NETX_TENANT_COUNTRY NETX_TENANT_LOCALE NETX_TENANT_CURRENCY

  # Confirmação
  {
    printf '\n───────────────────────────────────────────────────────────\n'
    printf '  Domínio:  %s\n' "${NETX_DOMAIN:-(IP do servidor)}"
    printf '  Admin:    %s\n' "${NETX_ADMIN_EMAIL}"
    printf '  Empresa:  %s (%s/%s/%s)\n' \
      "${NETX_TENANT_NAME}" "${NETX_TENANT_COUNTRY}" "${NETX_TENANT_LOCALE}" "${NETX_TENANT_CURRENCY}"
    printf '───────────────────────────────────────────────────────────\n'
  } >&3
  local confirm=""
  _wz_ask confirm "Confirma e inicia a instalação? (s/N)" "s"
  case "${confirm}" in
    s|S|sim|y|Y|yes) : ;;
    *)
      printf '  Instalação cancelada. Rode o installer de novo quando quiser.\n' >&3
      exec 3<&- 3>&-
      log_warn "Instalação cancelada no wizard."
      exit 1
      ;;
  esac

  exec 3<&- 3>&-

  # Persiste config em .secrets pra re-runs idempotentes
  mkdir -p "${NETX_ETC}"
  touch "${NETX_ETC}/.secrets"
  chmod 600 "${NETX_ETC}/.secrets"
  sed -i '/^NETX_ADMIN_EMAIL=/d;/^NETX_ADMIN_PASSWORD=/d;/^NETX_DOMAIN=/d;/^NETX_LETSENCRYPT_EMAIL=/d' "${NETX_ETC}/.secrets" 2>/dev/null || true
  printf 'NETX_ADMIN_EMAIL=%s\nNETX_ADMIN_PASSWORD=%s\nNETX_DOMAIN=%s\nNETX_LETSENCRYPT_EMAIL=%s\n' \
    "${NETX_ADMIN_EMAIL}" "${NETX_ADMIN_PASSWORD}" "${NETX_DOMAIN}" "${NETX_LETSENCRYPT_EMAIL}" >> "${NETX_ETC}/.secrets"
}

wizard_apply_defaults() {
  mkdir -p "${NETX_ETC}"
  touch "${NETX_ETC}/.secrets"
  chmod 600 "${NETX_ETC}/.secrets"

  # 1) Email — usa env, ou recupera do .secrets, ou default.
  # `|| true` evita disparar errexit quando .secrets está vazio (primeira run):
  # grep sem match retorna 1, pipefail propaga, e `VAR=$(failing_pipeline)`
  # mata o installer ANTES de aplicar o default. Já fui mordido por isso.
  if [[ -z "${NETX_ADMIN_EMAIL}" ]]; then
    NETX_ADMIN_EMAIL=$(grep '^NETX_ADMIN_EMAIL=' "${NETX_ETC}/.secrets" 2>/dev/null | cut -d= -f2- || true)
    [[ -z "${NETX_ADMIN_EMAIL}" ]] && NETX_ADMIN_EMAIL="admin@netx.local"
  fi

  # 2) Password — usa env, ou recupera do .secrets, ou gera novo
  if [[ -z "${NETX_ADMIN_PASSWORD}" ]]; then
    NETX_ADMIN_PASSWORD=$(grep '^NETX_ADMIN_PASSWORD=' "${NETX_ETC}/.secrets" 2>/dev/null | cut -d= -f2- || true)
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
