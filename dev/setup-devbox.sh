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

  wait "$cmd_pid"
  local rc=$?
  printf "\r" 1>&2

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
  if [ -f "$env_path" ]; then
    step "Environment (.env)"
    ok "Using existing $env_path"
    return
  fi

  step "Environment (.env)"
  say "${DIM}Creating $env_path with generated secrets…${RESET}"

  local tz
  tz="UTC"

  cat > "$env_path" <<EOF
# Local devbox env (auto-generated). Safe to edit.
TZ=$tz

# Monolith feature selection:
# - none (default)
# - plex
RIVEN_MEDIA_FLAVOR=none

# Optional: enable Plex (proprietary) by providing a .deb URL + claim token.
# PLEX_DEB_URL=https://downloads.plex.tv/.../plexmediaserver_*.deb
# PLEX_CLAIM=claim-xxxx
# (Other Plex settings can be added as PLEX_* vars.)

# Optional: pin Node tarball version used in the monolith build.
# NODE_VERSION=24.0.0
EOF

  ok "Wrote $env_path (gitignored via .env*)."
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

  step "Build + start containers"
  spinner "docker compose up (build + start)" \
    $DOCKER compose -f "$COMPOSE_FILE_DEFAULT" up -d --build

  step "Smoke test"
  if need_cmd curl; then
    spinner "Frontend reachable" bash -lc "curl -fsS -o /dev/null -w '%{http_code}\n' -L http://localhost:3000/ | grep -qE '^(200|3..)$'"
    ok "OK: http://localhost:3000"
  else
    warn "curl not found; skipping HTTP checks."
  fi
}

main() {
  init_ui
  trap on_err ERR

  say "${BOLD}Riven devbox setup${RESET} ${DIM}(this will install Docker + start containers)${RESET}"
  say "${DIM}Log: ${LOG_FILE}${RESET}"

  validate_repo_root
  validate_prereqs

  # OS detection early for clearer errors.
  detect_os
  require_sudo

  validate_network
  apt_install_prereqs
  install_docker
  ensure_env_file
  prepare_container_data
  compose_up

  say ""
  ok "Done"
  warn "If docker commands fail with permission denied: log out/in or run: newgrp docker"
}

main "$@"
