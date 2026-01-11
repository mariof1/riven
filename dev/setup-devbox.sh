#!/usr/bin/env bash
set -euo pipefail

# Dev box bootstrap for a vanilla Ubuntu/Debian server.
#
# Usage (from repo root):
#   bash dev/setup-devbox.sh
#
# What it does:
# - Installs system prerequisites + Docker Engine + docker compose plugin
# - Creates a local .env (not committed) with sane defaults + generated secrets
# - Prepares ./container_data folders with correct ownership
# - Builds and starts the monorepo dev stack (backend+frontend+embedded Postgres)

log() { printf "[%s] %s\n" "$(date +%H:%M:%S)" "$*"; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1
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

apt_install_prereqs() {
  require_sudo
  detect_os

  log "Installing prerequisites (git, curl, ca-certificates, gnupg, openssl)…"
  $SUDO apt-get update -y
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
    log "Docker already installed: $(docker --version)"
    return
  fi

  log "Installing Docker Engine + docker compose plugin…"

  $SUDO install -m 0755 -d /etc/apt/keyrings

  if [[ "$OS_ID" == "ubuntu" ]]; then
    DOCKER_REPO="https://download.docker.com/linux/ubuntu"
  else
    DOCKER_REPO="https://download.docker.com/linux/debian"
  fi

  curl -fsSL "$DOCKER_REPO/gpg" | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  $SUDO chmod a+r /etc/apt/keyrings/docker.gpg

  ARCH="$($SUDO dpkg --print-architecture)"
  echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] ${DOCKER_REPO} ${CODENAME} stable" \
    | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null

  $SUDO apt-get update -y
  $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  $SUDO systemctl enable --now docker >/dev/null 2>&1 || true

  if [ "$(id -u)" -ne 0 ]; then
    log "Adding current user to docker group…"
    $SUDO usermod -aG docker "$USER" || true
    log "Note: you may need to log out/in for docker group changes to apply."
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
    log "Using existing $env_path"
    return
  fi

  local puid pgid tz
  puid="$(id -u)"
  pgid="$(id -g)"
  tz="UTC"

  local api_key auth_secret
  api_key="$(openssl rand -hex 16)"         # 32 chars
  auth_secret="$(openssl rand -hex 32)"     # 64 chars

  log "Creating $env_path with generated secrets…"

  cat > "$env_path" <<EOF
# Local devbox env (auto-generated). Safe to edit.
PUID=$puid
PGID=$pgid
TZ=$tz

# Backend/Frontend shared API key (must match both sides)
RIVEN_API_KEY=$api_key

# Frontend auth secret (must be >= 32 chars)
FRONTEND_AUTH_SECRET=$auth_secret

# Optional overrides
# RIVEN_ORIGIN=http://localhost:8080
# FRONTEND_ORIGIN=http://localhost:3000

# Optional: set to ':rshared' if you need mount propagation and your host supports it
# RIVEN_MOUNT_BIND_OPTS=:rshared
EOF

  log "Wrote $env_path (gitignored via .env*)."
}

prepare_container_data() {
  log "Preparing ./container_data folders…"
  mkdir -p container_data/riven container_data/frontend container_data/mount

  local puid pgid
  puid="$(id -u)"
  pgid="$(id -g)"

  # Match the compose PUID/PGID defaults; most servers use 1000, but we set from .env.
  # These folders are bind-mounted into containers that may run as UID:GID.
  if [ "$(id -u)" -eq 0 ]; then
    chown -R "$puid:$pgid" container_data || true
  else
    require_sudo
    $SUDO chown -R "$puid:$pgid" container_data || true
  fi
}

compose_up() {
  local DOCKER
  DOCKER="$(docker_cmd)"

  log "Building and starting dev stack (backend+frontend+embedded Postgres)…"
  $DOCKER compose -f docker-compose-dev-full.yml up -d --build

  log "Smoke test: backend OpenAPI + frontend HTTP…"
  # Best-effort checks; don’t fail hard if curl isn’t installed yet.
  if need_cmd curl; then
    curl -fsS http://localhost:8080/openapi.json >/dev/null
    curl -fsS -o /dev/null -w "%{http_code}\n" -L http://localhost:3000/ | grep -qE '^(200|3..)$'
    log "OK: http://localhost:8080 and http://localhost:3000"
  else
    log "curl not found; skipping HTTP checks."
  fi
}

main() {
  if [ ! -f docker-compose-dev-full.yml ]; then
    echo "Run this from the repo root (missing docker-compose-dev-full.yml)." >&2
    exit 1
  fi

  apt_install_prereqs
  install_docker
  ensure_env_file
  prepare_container_data
  compose_up

  log "Done. If docker commands fail with permission denied, log out/in or run: newgrp docker"
}

main "$@"
