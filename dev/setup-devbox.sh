#!/usr/bin/env bash
set -euo pipefail

# Dev box bootstrap for a vanilla Ubuntu/Debian server.
#
# Usage (from repo root):
#   bash dev/setup-devbox.sh
#
# What it does:
# - Installs system prerequisites + Docker Engine + docker compose plugin
# - Creates a local .env (not committed) with minimal defaults (no required secrets)
# - Prepares ./container_data folders with correct ownership
# - Builds and starts the monorepo dev stack (backend+frontend+embedded Postgres)

# User-friendly output + minimal spam:
# - Writes full command output to a log file
# - Shows a spinner for long-running steps

need_cmd() { command -v "$1" >/dev/null 2>&1; }

is_tty() {
  [ -t 1 ]
}

init_ui() {
  if is_tty && need_cmd tput; then
    BOLD="$(tput bold)"
    DIM="$(tput dim)"
    RESET="$(tput sgr0)"
    RED="$(tput setaf 1)"
    GREEN="$(tput setaf 2)"
    YELLOW="$(tput setaf 3)"
    BLUE="$(tput setaf 4)"
  else
    BOLD=""; DIM=""; RESET=""; RED=""; GREEN=""; YELLOW=""; BLUE=""
  fi

  LOG_FILE="${LOG_FILE:-/tmp/riven-devbox-setup.$(date +%Y%m%d-%H%M%S).log}"
}

SUDO_KEEPALIVE_PID=""

AUTO_START_CONTAINERS="y"
AUTO_CONTINUE="y"

cleanup() {
  if [ -n "${SUDO_KEEPALIVE_PID:-}" ] && kill -0 "$SUDO_KEEPALIVE_PID" >/dev/null 2>&1; then
    kill "$SUDO_KEEPALIVE_PID" >/dev/null 2>&1 || true
  fi
}

say() {
  # shellcheck disable=SC2059
  printf "%b\n" "$*" 1>&2
}

ok() { say "${GREEN}✔${RESET} $*"; }
warn() { say "${YELLOW}•${RESET} $*"; }
fail() { say "${RED}✖${RESET} $*"; }

step() {
  say "${BOLD}${BLUE}==>${RESET} ${BOLD}$*${RESET}"
}

is_interactive() {
  is_tty && [ -r /dev/tty ]
}

prompt() {
  # Usage: prompt "Question" "default"  -> prints answer
  local question="$1"
  local default_value="$2"

  if ! is_interactive; then
    printf "%s" "$default_value"
    return
  fi

  local answer
  read -r -p "${question} [${default_value}]: " answer </dev/tty || true
  if [ -z "${answer:-}" ]; then
    answer="$default_value"
  fi
  printf "%s" "$answer"
}

prompt_secret() {
  # Usage: prompt_secret "Question" "existing_or_empty" -> prints answer (hidden input)
  local question="$1"
  local existing_value="$2"

  if ! is_interactive; then
    printf "%s" "$existing_value"
    return
  fi

  local answer
  if [ -n "${existing_value:-}" ]; then
    read -r -s -p "${question} (leave blank to keep existing): " answer </dev/tty || true
    printf "\n" 1>&2
    if [ -z "${answer:-}" ]; then
      answer="$existing_value"
    fi
  else
    while true; do
      read -r -s -p "${question}: " answer </dev/tty || true
      printf "\n" 1>&2
      if [ -n "${answer:-}" ]; then
        break
      fi
      warn "Value cannot be empty"
    done
  fi

  printf "%s" "$answer"
}

maybe_change_value() {
  # Usage: maybe_change_value "Label" "current" "default" -> prints chosen value
  local label="$1"
  local current_value="$2"
  local default_value="$3"

  if ! is_interactive; then
    if [ -n "${current_value:-}" ]; then
      printf "%s" "$current_value"
    else
      printf "%s" "$default_value"
    fi
    return
  fi

  local shown
  shown="$current_value"
  if [ -z "${shown:-}" ]; then
    shown="(empty)"
  fi

  if prompt_yn "Change ${label}? (currently: ${shown})" "n"; then
    printf "%s" "$(prompt "${label}" "${current_value:-$default_value}")"
  else
    printf "%s" "$current_value"
  fi
}

maybe_change_port() {
  # Usage: maybe_change_port "Label" "current" "default" -> prints chosen port
  local label="$1"
  local current_value="$2"
  local default_value="$3"

  if ! is_interactive; then
    if [ -n "${current_value:-}" ]; then
      printf "%s" "$current_value"
    else
      printf "%s" "$default_value"
    fi
    return
  fi

  local shown
  shown="$current_value"
  if [ -z "${shown:-}" ]; then
    shown="(empty)"
  fi

  if prompt_yn "Change ${label}? (currently: ${shown})" "n"; then
    printf "%s" "$(prompt_port "${label}" "${current_value:-$default_value}")"
  else
    printf "%s" "$current_value"
  fi
}

prompt_yn() {
  # Usage: prompt_yn "Question" "y"|"n" -> returns 0 for yes, 1 for no
  local question="$1"
  local default_yn="$2"
  local suffix
  local answer

  if ! is_interactive; then
    [ "$default_yn" = "y" ]
    return
  fi

  if [ "$default_yn" = "y" ]; then
    suffix="Y/n"
  else
    suffix="y/N"
  fi

  while true; do
    read -r -p "${question} [${suffix}]: " answer </dev/tty || true
    answer="${answer:-}"
    if [ -z "$answer" ]; then
      [ "$default_yn" = "y" ]
      return
    fi
    case "$answer" in
      y|Y|yes|YES) return 0 ;;
      n|N|no|NO) return 1 ;;
      *) say "${YELLOW}•${RESET} Please answer y/n." ;;
    esac
  done
}

is_valid_port() {
  local p="$1"
  [[ "$p" =~ ^[0-9]+$ ]] && [ "$p" -ge 1 ] && [ "$p" -le 65535 ]
}

prompt_port() {
  # Usage: prompt_port "Question" default
  local question="$1"
  local default_value="$2"
  local answer

  while true; do
    answer="$(prompt "$question" "$default_value")"
    if is_valid_port "$answer"; then
      printf "%s" "$answer"
      return
    fi
    warn "Invalid port '$answer' (must be 1-65535)"
    if ! is_interactive; then
      printf "%s" "$default_value"
      return
    fi
  done
}

env_get() {
  # Usage: env_get .env KEY default
  local file="$1" key="$2" default_value="$3"
  if [ -f "$file" ] && grep -qE "^${key}=" "$file"; then
    awk -F= -v k="$key" '$1==k {sub(/^[^=]*=/, ""); print; exit}' "$file"
  else
    printf "%s" "$default_value"
  fi
}

write_compose_override() {
  # Writes a tiny compose override with the desired host port mappings.
  # We keep this outside the repo so it doesn't need gitignore changes.
  local override_path="$1"
  local ui_port="$2"
  local media_flavor="$3"
  local plex_port="$4"
  local expose_plex="$5"

  cat >"$override_path" <<EOF
services:
  riven_monolith:
    ports:
      - "${ui_port}:3000"
EOF

  if [ "$media_flavor" = "plex" ] && [ "$expose_plex" = "y" ]; then
    cat >>"$override_path" <<EOF
      - "${plex_port}:32400"
EOF
  fi
}

spinner() {
  # Usage: spinner "Message" cmd arg...
  local message="$1"; shift
  local -a cmd=("$@")

  if ! is_tty; then
    say "$message"
    run_quiet "${cmd[@]}"
    return
  fi

  local spin='|/-\\'
  local i=0

  # Run command in background, logging output.
  run_quiet "${cmd[@]}" &
  local cmd_pid=$!

  while kill -0 "$cmd_pid" >/dev/null 2>&1; do
    i=$(( (i + 1) % 4 ))
    printf "\r${DIM}%s %s${RESET}" "${spin:$i:1}" "$message" 1>&2
    sleep 0.12
  done

  # `wait` can return non-zero; with `set -e` that would abort before we can
  # print a useful error. Capture it explicitly.
  set +e
  wait "$cmd_pid"
  local rc=$?
  set -e

  # Clear the spinner line so the prompt doesn't appear on it.
  printf "\r\033[K" 1>&2

  if [ "$rc" -eq 0 ]; then
    ok "$message"
  else
    fail "$message"
    fail "See log: ${LOG_FILE}"
    tail -n 80 "$LOG_FILE" 1>&2 || true
    exit "$rc"
  fi
}

run_quiet() {
  # Runs a command, appending stdout/stderr to LOG_FILE.
  # Do not echo the command itself (avoid spam), but keep it in the log.
  {
    printf "\n[%s] $ " "$(date +%H:%M:%S)"
    printf "%q " "$@"
    printf "\n"
  } >>"$LOG_FILE"

  "$@" >>"$LOG_FILE" 2>&1
}

on_err() {
  local rc=$?
  fail "Setup failed (exit $rc)."
  fail "Log: ${LOG_FILE}"
  tail -n 80 "$LOG_FILE" 1>&2 || true
  exit "$rc"
}

require_sudo() {
  if [ "$(id -u)" -eq 0 ]; then
    SUDO=""
    return
  fi

  if need_cmd sudo; then
    SUDO="sudo"
    return
  fi

  echo "This script needs root privileges (installing packages), but 'sudo' is not available." >&2
  echo "Run as root or install sudo first." >&2
  exit 1
}

ensure_sudo_cached() {
  # Ensure sudo credentials are cached so later spinner/background steps don't
  # hide an interactive password prompt.
  if [ -z "${SUDO:-}" ] || [ "$SUDO" != "sudo" ]; then
    return
  fi

  if [ "$(id -u)" -eq 0 ]; then
    return
  fi

  step "Privileges"
  say "${DIM}This setup needs sudo for package installs and Docker setup.${RESET}"
  say "${DIM}You'll be prompted for your password once (if needed).${RESET}"

  # Run in foreground so the password prompt is visible.
  sudo -v

  # Keep sudo alive while the script runs.
  ( while true; do sudo -n true 2>/dev/null || exit 0; sleep 60; done ) &
  SUDO_KEEPALIVE_PID=$!
}

detect_os() {
  if [ ! -f /etc/os-release ]; then
    echo "Unsupported system (missing /etc/os-release)." >&2
    exit 1
  fi

  # shellcheck disable=SC1091
  . /etc/os-release

  OS_ID="${ID:-}"
  OS_LIKE="${ID_LIKE:-}"
  CODENAME="${VERSION_CODENAME:-}"

  case "$OS_ID" in
    ubuntu|debian) : ;;
    *)
      if [[ "$OS_LIKE" == *debian* ]]; then
        :
      else
        echo "Unsupported OS: ID=$OS_ID ID_LIKE=$OS_LIKE" >&2
        echo "This script currently supports Debian/Ubuntu." >&2
        exit 1
      fi
      ;;
  esac

  if [ -z "$CODENAME" ]; then
    CODENAME="stable"
  fi
}

COMPOSE_FILE_DEFAULT="docker-compose-dev-monolith.yml"

validate_repo_root() {
  if [ ! -f "$COMPOSE_FILE_DEFAULT" ]; then
    fail "Run this from the repo root (missing $COMPOSE_FILE_DEFAULT)."
    exit 1
  fi
}

validate_network() {
  if need_cmd curl; then
    spinner "Checking network access" curl -fsSL https://download.docker.com/ -o /dev/null
  else
    warn "curl not installed yet; skipping network check."
  fi
}

validate_prereqs() {
  if ! need_cmd bash; then
    fail "bash not found (unexpected)."
    exit 1
  fi
}

apt_install_prereqs() {
  require_sudo
  detect_os

  step "Installing prerequisites"
  spinner "Updating apt index" $SUDO apt-get update -y
  spinner "Installing packages (git, curl, ca-certificates, gnupg, openssl)" \
    $SUDO apt-get install -y \
      ca-certificates \
      curl \
      git \
      gnupg \
      lsb-release \
      openssl
}

install_docker() {
  require_sudo
  detect_os

  if need_cmd docker && docker --version >/dev/null 2>&1; then
    step "Docker"
    ok "Docker already installed: $(docker --version)"
    return
  fi

  step "Installing Docker Engine + docker compose plugin"

  spinner "Preparing apt keyrings" $SUDO install -m 0755 -d /etc/apt/keyrings

  if [[ "$OS_ID" == "ubuntu" ]]; then
    DOCKER_REPO="https://download.docker.com/linux/ubuntu"
  else
    DOCKER_REPO="https://download.docker.com/linux/debian"
  fi

  spinner "Adding Docker apt repository GPG key" bash -lc \
    "curl -fsSL '$DOCKER_REPO/gpg' | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg"
  spinner "Setting key permissions" $SUDO chmod a+r /etc/apt/keyrings/docker.gpg

  ARCH="$($SUDO dpkg --print-architecture)"
  spinner "Adding Docker apt source" bash -lc \
    "echo 'deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] ${DOCKER_REPO} ${CODENAME} stable' | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null"

  spinner "Updating apt index (Docker repo)" $SUDO apt-get update -y
  spinner "Installing docker-ce + compose plugin" \
    $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  spinner "Enabling Docker service" $SUDO systemctl enable --now docker

  if [ "$(id -u)" -ne 0 ]; then
    spinner "Adding current user to docker group" $SUDO usermod -aG docker "$USER"
    warn "You may need to log out/in (or run: newgrp docker)"
  fi
}

docker_cmd() {
  # Prefer non-sudo docker when possible; fall back to sudo.
  if docker info >/dev/null 2>&1; then
    echo docker
    return
  fi

  if [ "$(id -u)" -eq 0 ]; then
    echo docker
    return
  fi

  require_sudo
  echo "$SUDO docker"
}

ensure_env_file() {
  local env_path=".env"

  step "Environment (.env)"

  if [ -f "$env_path" ]; then
    ok "Found existing $env_path"
    if is_interactive; then
      if ! prompt_yn "Edit $env_path now?" "y"; then
        ok "Keeping existing $env_path"
        return
      fi
    else
      ok "Using existing $env_path"
      return
    fi
  else
    say "${DIM}Creating $env_path…${RESET}"
  fi

  local tz_default
  if [ -f /etc/timezone ]; then
    tz_default="$(cat /etc/timezone 2>/dev/null || true)"
  else
    tz_default="UTC"
  fi
  tz_default="${tz_default:-UTC}"

  local tz media_flavor node_version plex_deb_url plex_claim db_password
  local tz_current media_flavor_current node_version_current
  local ui_port plex_port expose_plex

  tz_current="$(env_get "$env_path" TZ "$tz_default")"
  media_flavor_current="$(env_get "$env_path" RIVEN_MEDIA_FLAVOR "none")"
  node_version_current="$(env_get "$env_path" NODE_VERSION "24.0.0")"

  tz="$(maybe_change_value "Timezone (TZ)" "$tz_current" "$tz_default")"

  # Minimal feature selection for now.
  media_flavor="$(maybe_change_value "Media flavor (none|plex)" "$media_flavor_current" "none")"
  case "$media_flavor" in
    none|plex) : ;;
    *)
      warn "Unknown media flavor '$media_flavor'; defaulting to none"
      media_flavor="none"
      ;;
  esac

  node_version="$(maybe_change_value "Node runtime version (NODE_VERSION)" "$node_version_current" "24.0.0")"

  db_password="$(env_get "$env_path" RIVEN_DB_PASSWORD "")"
  if is_interactive; then
    local db_shown
    db_shown="(set)"
    if [ -z "${db_password:-}" ]; then
      db_shown="(empty)"
    fi
    if prompt_yn "Change RIVEN_DB_PASSWORD? (currently: ${db_shown})" "n"; then
      db_password="$(prompt_secret "RIVEN_DB_PASSWORD (embedded Postgres role password)" "")"
    fi
  fi

  ui_port="$(maybe_change_port "Host port for Riven UI" "$(env_get "$env_path" RIVEN_UI_PORT "3000")" "3000")"
  plex_port="$(env_get "$env_path" PLEX_PORT "32400")"
  expose_plex="$(env_get "$env_path" PLEX_EXPOSE_PORT "n")"

  plex_deb_url="$(env_get "$env_path" PLEX_DEB_URL "")"
  plex_claim="$(env_get "$env_path" PLEX_CLAIM "")"

  if [ "$media_flavor" = "plex" ]; then
    say "${DIM}Plex is proprietary; you must supply a direct .deb URL to install it at runtime.${RESET}"
    plex_deb_url="$(maybe_change_value "PLEX_DEB_URL (required for Plex)" "$plex_deb_url" "https://downloads.plex.tv/.../plexmediaserver_*.deb")"
    plex_claim="$(maybe_change_value "PLEX_CLAIM (optional)" "$plex_claim" "")"

    if is_interactive; then
      if prompt_yn "Expose Plex port on the host?" "y"; then
        expose_plex="y"
        plex_port="$(maybe_change_port "Host port for Plex" "$(env_get "$env_path" PLEX_PORT "32400")" "32400")"
      else
        expose_plex="n"
      fi
    else
      expose_plex="${expose_plex:-n}"
    fi
  fi

  if [ -z "${db_password:-}" ]; then
    warn "RIVEN_DB_PASSWORD is empty; container start will fail until you set it."
  fi

  cat > "$env_path" <<EOF
# Local devbox env (auto-generated). Safe to edit.
TZ=$tz

# User-provided password for the embedded Postgres role used by Riven.
# This is passed into the monolith container as RIVEN_DB_PASSWORD.
RIVEN_DB_PASSWORD=$db_password

# Host port mapping for the UI container port 3000.
RIVEN_UI_PORT=$ui_port

# Monolith feature selection:
# - none (default)
# - plex
RIVEN_MEDIA_FLAVOR=$media_flavor

# Optional: enable Plex (proprietary) by providing a .deb URL + claim token.
# If you enable Plex, also expose port 32400 in docker-compose-dev-monolith.yml.
PLEX_DEB_URL=$plex_deb_url
PLEX_CLAIM=$plex_claim

# Host port mapping for Plex container port 32400 (only used if Plex is enabled + exposed).
PLEX_PORT=$plex_port
PLEX_EXPOSE_PORT=$expose_plex

# Pin Node tarball version used in the monolith final stage.
NODE_VERSION=$node_version
EOF

  ok "Wrote $env_path (gitignored via .env*)."
}

maybe_regenerate_monolith_secrets() {
  # Secrets are persisted under ./container_data/monolith and include the backend API key
  # used by the frontend. Keep this interactive and upfront.
  if ! is_interactive; then
    return
  fi

  step "Secrets"
  if prompt_yn "Regenerate monolith secrets (API key/auth/db password)?" "n"; then
    rm -f container_data/monolith/secrets/monolith.env 2>/dev/null || true
    ok "Deleted container_data/monolith/secrets/monolith.env (will be re-generated on next start)"
  else
    ok "Keeping existing monolith secrets"
  fi
}

confirm_run_unattended() {
  # After the interactive phase, the script should run unattended.
  if ! is_interactive; then
    return
  fi

  step "Confirmation"
  say "${DIM}All prompts are complete. Next steps are non-interactive:${RESET}"
  say "${DIM}- apt installs (if needed)${RESET}"
  say "${DIM}- Docker install (if needed)${RESET}"
  say "${DIM}- build + start containers${RESET}"

  if ! prompt_yn "Continue with setup steps now?" "y"; then
    AUTO_CONTINUE="n"
    return
  fi

  if ! prompt_yn "Start containers at the end?" "y"; then
    AUTO_START_CONTAINERS="n"
  fi
}

prepare_container_data() {
  step "Local data directories"
  mkdir -p container_data/monolith

  local puid pgid
  puid="$(id -u)"
  pgid="$(id -g)"

  # Match the compose PUID/PGID defaults; most servers use 1000, but we set from .env.
  # These folders are bind-mounted into containers that may run as UID:GID.
  if [ "$(id -u)" -eq 0 ]; then
    run_quiet chown -R "$puid:$pgid" container_data || true
  else
    require_sudo
    run_quiet $SUDO chown -R "$puid:$pgid" container_data || true
  fi
  ok "Prepared ./container_data/monolith"
}

compose_up() {
  local DOCKER
  DOCKER="$(docker_cmd)"

  local ui_port media_flavor plex_port expose_plex
  ui_port="$(env_get .env RIVEN_UI_PORT 3000)"
  media_flavor="$(env_get .env RIVEN_MEDIA_FLAVOR none)"
  plex_port="$(env_get .env PLEX_PORT 32400)"
  expose_plex="$(env_get .env PLEX_EXPOSE_PORT n)"

  local override_file
  override_file="${COMPOSE_OVERRIDE_FILE:-/tmp/riven-dev-monolith.override.yml}"
  write_compose_override "$override_file" "$ui_port" "$media_flavor" "$plex_port" "$expose_plex"

  step "Build + start containers"
  spinner "docker compose up (build + start)" \
    $DOCKER compose -f "$COMPOSE_FILE_DEFAULT" -f "$override_file" up -d --build

  step "Smoke test"
  if need_cmd curl; then
    spinner "Frontend reachable" bash -lc "curl -fsS -o /dev/null -w '%{http_code}\n' -L http://localhost:${ui_port}/ | grep -qE '^(200|3..)$'"
    ok "OK: http://localhost:${ui_port}"
  else
    warn "curl not found; skipping HTTP checks."
  fi
}

main() {
  init_ui
  trap on_err ERR
  trap cleanup EXIT

  say "${BOLD}Riven devbox setup${RESET} ${DIM}(this will install Docker + start containers)${RESET}"
  say "${DIM}Log: ${LOG_FILE}${RESET}"

  validate_repo_root
  validate_prereqs

  # OS detection early for clearer errors.
  detect_os
  require_sudo
  ensure_sudo_cached

  # === Interactive phase (all prompts up-front) ===
  ensure_env_file
  maybe_regenerate_monolith_secrets
  confirm_run_unattended

  if [ "${AUTO_CONTINUE}" != "y" ]; then
    ok "Stopped before installing/building/starting"
    warn "Re-run any time: ./dev/setup-devbox.sh"
    return
  fi

  # === Unattended phase ===
  validate_network
  apt_install_prereqs
  install_docker
  prepare_container_data
  if [ "${AUTO_START_CONTAINERS}" = "y" ]; then
    compose_up
  else
    ok "Skipping container start"
    warn "Run later from repo root: docker compose -f docker-compose-dev-monolith.yml up -d --build"
  fi

  say ""
  ok "Done"
  warn "If docker commands fail with permission denied: log out/in or run: newgrp docker"
}

main "$@"
