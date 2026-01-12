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

rand_hex() {
  # Usage: rand_hex 16
  local nbytes="$1"
  if need_cmd openssl; then
    openssl rand -hex "$nbytes" 2>/dev/null
  else
    python3 - <<PY
import secrets
print(secrets.token_hex(int("$nbytes")))
PY
  fi
}

DEBUG=0

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

CREATE_SWAPFILE="n"
SWAPFILE_PATH="/swapfile"
SWAPFILE_SIZE_GB="4"

DOCKER_GROUP_ADDED="n"

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

usage() {
  cat 1>&2 <<EOF
Usage: ./dev/setup-devbox.sh [--debug]

Options:
  --debug, -d   Show all command output (no spinner)
  --help,  -h   Show this help
EOF
}

parse_args() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --debug|-d) DEBUG=1 ;;
      --help|-h) usage; exit 0 ;;
      *)
        say "Unknown argument: $arg"
        usage
        exit 2
        ;;
    esac
  done
}

is_interactive() {
  [ -r /dev/tty ] && [ -w /dev/tty ]
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
    say "${question} ${DIM}(leave blank to keep existing; input hidden)${RESET}"
    IFS= read -r -s answer </dev/tty || true
    printf "\n" >/dev/tty
    if [ -z "${answer:-}" ]; then
      answer="$existing_value"
    fi
  else
    while true; do
      say "${question} ${DIM}(input hidden)${RESET}"
      IFS= read -r -s answer </dev/tty || true
      printf "\n" >/dev/tty
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
  # NOTE: FUSE/AppArmor settings are defined in docker-compose.yml.
  # The override file should only contain port mappings.

  cat >"$override_path" <<EOF
services:
  riven:
    ports:
      - "${ui_port}:3000"
EOF

  if [ "$media_flavor" = "plex" ] && [ "$expose_plex" = "y" ]; then
    cat >>"$override_path" <<EOF
      - "${plex_port}:32400"
EOF
  fi
}

host_has_fuse() {
  [ -e /dev/fuse ]
}

meminfo_kb() {
  # Usage: meminfo_kb MemTotal|SwapTotal
  local key="$1"
  awk -v k="$key" '$1==k":" {print $2; exit}' /proc/meminfo 2>/dev/null || true
}

low_memory_build_risk() {
  # Heuristic: Vite/SvelteKit build inside Docker can exceed RAM on small VMs and get OOM-killed.
  # Return 0 when we should recommend swap.
  local mem_kb swap_kb
  mem_kb="$(meminfo_kb MemTotal)"
  swap_kb="$(meminfo_kb SwapTotal)"

  mem_kb="${mem_kb:-0}"
  swap_kb="${swap_kb:-0}"

  # Recommend swap if RAM < ~4GiB and swap < ~2GiB.
  [ "$mem_kb" -lt 4000000 ] && [ "$swap_kb" -lt 2000000 ]
}

prompt_swapfile_if_needed() {
  if ! is_interactive; then
    return
  fi

  if ! low_memory_build_risk; then
    return
  fi

  step "Memory"
  warn "Low memory detected; Docker build may be OOM-killed (exit 137)."
  say "${DIM}Recommendation: enable swap before building the image.${RESET}"

  if prompt_yn "Create and enable a ${SWAPFILE_SIZE_GB}G swapfile at ${SWAPFILE_PATH}?" "y"; then
    CREATE_SWAPFILE="y"
  fi
}

ensure_swapfile() {
  if [ "${CREATE_SWAPFILE}" != "y" ]; then
    return
  fi

  require_sudo

  step "Swap"

  # If swap already exists and is active, do nothing.
  if need_cmd swapon && swapon --show=NAME 2>/dev/null | grep -Fxq "$SWAPFILE_PATH"; then
    ok "Swap already active: $SWAPFILE_PATH"
    return
  fi

  if [ -e "$SWAPFILE_PATH" ]; then
    warn "$SWAPFILE_PATH already exists; will try enabling it"
  else
    spinner "Creating swapfile (${SWAPFILE_SIZE_GB}G)" $SUDO fallocate -l "${SWAPFILE_SIZE_GB}G" "$SWAPFILE_PATH"
    spinner "Setting swapfile permissions" $SUDO chmod 600 "$SWAPFILE_PATH"
    spinner "Formatting swapfile" $SUDO mkswap "$SWAPFILE_PATH"
  fi

  spinner "Enabling swap" $SUDO swapon "$SWAPFILE_PATH"

  # Persist across reboots.
  if ! grep -qE "^${SWAPFILE_PATH}[[:space:]]+" /etc/fstab 2>/dev/null; then
    spinner "Persisting swap in /etc/fstab" bash -lc "echo '${SWAPFILE_PATH} none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null"
  fi

  ok "Swap enabled"
}

spinner() {
  # Usage: spinner "Message" cmd arg...
  local message="$1"; shift
  local -a cmd=("$@")

  if [ "${DEBUG:-0}" = "1" ] || ! is_tty; then
    say "$message"
    set +e
    run_quiet "${cmd[@]}"
    local rc=$?
    set -e

    if [ "$rc" -eq 0 ]; then
      ok "$message"
    else
      fail "$message"
      fail "See log: ${LOG_FILE}"
      tail -n 80 "$LOG_FILE" 1>&2 || true
      exit "$rc"
    fi
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

dump_logs_tail() {
  # Best-effort helper for troubleshooting when the stack starts but UI isn't reachable.
  local name
  name="${1:-riven}"
  if need_cmd docker; then
    say "${DIM}--- recent container logs (${name}) ---${RESET}"
    docker logs --tail=200 "$name" 2>&1 | cat 1>&2 || true
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

  if [ "${DEBUG:-0}" = "1" ]; then
    local cmd_str
    cmd_str="$(printf "%q " "$@")"
    say "${DIM}$ ${cmd_str}${RESET}"
    if need_cmd tee; then
      "$@" 2>&1 | tee -a "$LOG_FILE"
    else
      "$@" 2>&1
    fi
  else
    "$@" >>"$LOG_FILE" 2>&1
  fi
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

COMPOSE_FILE_DEFAULT="docker-compose.yml"

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
  spinner "Installing packages (curl, ca-certificates, gnupg, openssl, util-linux)" \
    $SUDO apt-get install -y \
      ca-certificates \
      curl \
      gnupg \
      lsb-release \
      openssl \
      util-linux
}

install_docker() {
  require_sudo
  detect_os

  if need_cmd docker && docker --version >/dev/null 2>&1; then
    step "Docker"
    ok "Docker already installed: $(docker --version)"

    # Even if Docker is already installed, make sure the current user is in the
    # docker group so future shells can use docker without sudo.
    if [ "$(id -u)" -ne 0 ]; then
      if getent group docker >/dev/null 2>&1; then
        if ! user_in_group_db docker "${USER}"; then
          spinner "Adding current user to docker group" $SUDO usermod -aG docker "$USER"
          DOCKER_GROUP_ADDED="y"
        fi
      fi
    fi
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
    if ! getent group docker >/dev/null 2>&1; then
      spinner "Creating docker group" $SUDO groupadd docker
    fi

    if ! user_in_group_db docker "${USER}"; then
      spinner "Adding current user to docker group" $SUDO usermod -aG docker "$USER"
      DOCKER_GROUP_ADDED="y"
    fi

    if ! id -nG 2>/dev/null | tr ' ' '\n' | grep -Fxq docker; then
      if need_cmd sg && user_in_group_db docker "${USER}"; then
        ok "Picked up docker group via 'sg docker' for this run"
      else
        warn "You may need to log out/in (or run: newgrp docker)"
      fi
    fi
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

user_in_group_db() {
  # Usage: user_in_group_db group user
  local group="$1" user="$2"
  getent group "$group" 2>/dev/null | awk -F: '{print $4}' | tr ',' '\n' | grep -Fxq "$user"
}

docker_cmd_mode() {
  # Returns one of: direct | sg | sudo
  if [ "$(id -u)" -eq 0 ]; then
    echo direct
    return
  fi

  if docker info >/dev/null 2>&1; then
    echo direct
    return
  fi

  # If the user was just added to the docker group during this run, the current
  # process won't have it yet. Use `sg docker -c ...` so Docker works immediately.
  if need_cmd sg && user_in_group_db docker "${USER}"; then
    echo sg
    return
  fi

  echo sudo
}

docker_run_cmd_array() {
  # Populates an array variable with the best way to run docker.
  # Usage: docker_run_cmd_array out_array_name -- <docker args...>
  local -n out="$1"; shift
  [ "${1:-}" = "--" ] && shift

  local mode
  mode="$(docker_cmd_mode)"
  out=()

  if [ "$mode" = "direct" ]; then
    out=(docker "$@")
  elif [ "$mode" = "sg" ]; then
    local sg_cmd
    sg_cmd="$(printf '%q ' docker "$@")"
    out=(sg docker -c "$sg_cmd")
  else
    require_sudo
    out=($SUDO docker "$@")
  fi
}

docker_compose_cmd_array() {
  # Populates an array variable with the best way to run docker compose.
  # Usage: docker_compose_cmd_array out_array_name -- <compose args...>
  local -n out="$1"; shift
  [ "${1:-}" = "--" ] && shift

  local mode
  mode="$(docker_cmd_mode)"
  out=()

  if [ "$mode" = "direct" ]; then
    out=(docker compose "$@")
  elif [ "$mode" = "sg" ]; then
    local sg_cmd
    sg_cmd="$(printf '%q ' docker compose "$@")"
    out=(sg docker -c "$sg_cmd")
  else
    require_sudo
    out=($SUDO docker compose "$@")
  fi
}

docker_runtime_check() {
  step "Docker runtime"
  say "${DIM}Verifying containers can start…${RESET}"

  # Use a tiny image to validate runtime. This also surfaces common host issues
  # (unprivileged LXC, rootless limitations, daemon default sysctls).
  local -a cmd
  docker_run_cmd_array cmd -- run --rm --pull=always alpine:3.20 true

  set +e
  local out rc
  out="$("${cmd[@]}" 2>&1)"
  rc=$?
  set -e

  if [ "$rc" -eq 0 ]; then
    ok "Docker containers can start"
    return
  fi

  fail "Docker containers failed to start"
  say "$out" 1>&2

  if echo "$out" | grep -qi "ip_unprivileged_port_start"; then
    warn "This host appears to block container sysctl setup (net.ipv4.ip_unprivileged_port_start)."
    warn "Common causes: running Docker inside an unprivileged LXC/container, or a Docker daemon configured with default sysctls."
    warn "Fix options:"
    warn "- If this is LXC/Proxmox: enable nesting + keyctl on the host and allow sysctls."
    warn "- Check /etc/docker/daemon.json for 'default-sysctls' and remove that entry, then: sudo systemctl restart docker"
  fi

  exit 1
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
  local ui_port plex_port expose_plex frontend_origin frontend_origin_current
  local enable_plex_signup
  local admin_username admin_email admin_password

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
    if [ -z "${db_password:-}" ]; then
      if prompt_yn "Set RIVEN_DB_PASSWORD? (optional)" "n"; then
        db_password="$(prompt_secret "Enter RIVEN_DB_PASSWORD" "")"
      fi
    else
      if prompt_yn "Change RIVEN_DB_PASSWORD? (currently: (set))" "n"; then
        db_password="$(prompt_secret "Enter new RIVEN_DB_PASSWORD" "")"
      fi
    fi
  fi

  ui_port="$(maybe_change_port "Host port for Riven UI" "$(env_get "$env_path" RIVEN_UI_PORT "3000")" "3000")"

  # Public URL for auth/OAuth callbacks. Default to localhost, but offer LAN IP as a convenient option.
  frontend_origin_current="$(env_get "$env_path" FRONTEND_ORIGIN "")"
  if [ -z "${frontend_origin_current:-}" ]; then
    frontend_origin_current="http://localhost:${ui_port}"
  fi

  local lan_ip
  lan_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  if [ -n "${lan_ip:-}" ] && [ "${lan_ip}" != "127.0.0.1" ]; then
    if is_interactive && prompt_yn "Set FRONTEND_ORIGIN for LAN access (OAuth callbacks)?" "y"; then
      frontend_origin_current="http://${lan_ip}:${ui_port}"
    fi
  fi

  frontend_origin="$(maybe_change_value "FRONTEND_ORIGIN (public URL for auth/OAuth)" "$frontend_origin_current" "http://localhost:${ui_port}")"

  plex_port="$(env_get "$env_path" PLEX_PORT "32400")"
  expose_plex="$(env_get "$env_path" PLEX_EXPOSE_PORT "n")"

  plex_deb_url="$(env_get "$env_path" PLEX_DEB_URL "")"
  plex_claim="$(env_get "$env_path" PLEX_CLAIM "")"

  # Allow first-time signup via Plex OAuth by default (devbox-friendly).
  enable_plex_signup="$(env_get "$env_path" ENABLE_PLEX_SIGNUP "true")"

  # Bootstrap admin creds (used only when no users exist in the auth DB).
  admin_username="$(env_get "$env_path" RIVEN_ADMIN_USERNAME "admin")"
  admin_email="$(env_get "$env_path" RIVEN_ADMIN_EMAIL "admin@example.com")"
  admin_password="$(env_get "$env_path" RIVEN_ADMIN_PASSWORD "")"

  if is_interactive; then
    if prompt_yn "Bootstrap a local admin user from env on first run? (RIVEN_ADMIN_*)" "y"; then
      admin_username="$(maybe_change_value "RIVEN_ADMIN_USERNAME" "$admin_username" "admin")"
      admin_email="$(maybe_change_value "RIVEN_ADMIN_EMAIL" "$admin_email" "admin@example.com")"

      if [ -z "${admin_password:-}" ]; then
        if prompt_yn "Generate a random RIVEN_ADMIN_PASSWORD now?" "y"; then
          admin_password="$(rand_hex 16)"
        else
          admin_password="$(prompt_secret "Enter RIVEN_ADMIN_PASSWORD" "")"
        fi
      else
        if prompt_yn "Change RIVEN_ADMIN_PASSWORD? (currently: (set))" "n"; then
          admin_password="$(prompt_secret "Enter new RIVEN_ADMIN_PASSWORD" "")"
        fi
      fi
    else
      admin_username=""
      admin_email=""
      admin_password=""
    fi
  else
    # Non-interactive defaults: keep existing if present, else generate a password.
    if [ -z "${admin_password:-}" ]; then
      admin_password="$(rand_hex 16)"
    fi
  fi

  if [ "$media_flavor" = "plex" ]; then
    say "${DIM}Plex is proprietary; you must supply a direct .deb URL to install it at runtime.${RESET}"

    if is_interactive; then
      local plex_signup_default
      if [ "${enable_plex_signup}" = "true" ]; then
        plex_signup_default="y"
      else
        plex_signup_default="n"
      fi

      if prompt_yn "Allow Plex OAuth to create users on first login? (ENABLE_PLEX_SIGNUP)" "$plex_signup_default"; then
        enable_plex_signup="true"
      else
        enable_plex_signup="false"
      fi
    fi

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

  # (db_password is guaranteed non-empty here)

  cat > "$env_path" <<EOF
# Local devbox env (auto-generated). Safe to edit.
TZ=$tz

# User-provided password for the embedded Postgres role used by Riven.
# This is passed into the container as RIVEN_DB_PASSWORD.
RIVEN_DB_PASSWORD=$db_password

# Host port mapping for the UI container port 3000.
RIVEN_UI_PORT=$ui_port

# Public URL used by the frontend auth/OAuth flows (Better Auth baseURL + allowed origin).
# IMPORTANT: set this to the URL you use in your browser (e.g. http://10.10.101.102:3000)
FRONTEND_ORIGIN=$frontend_origin

# Feature selection:
# - none (default)
# - plex
RIVEN_MEDIA_FLAVOR=$media_flavor

# Optional: enable Plex (proprietary) by providing a .deb URL + claim token.
# If you enable Plex, also expose port 32400 via the override file.
PLEX_DEB_URL=$plex_deb_url
PLEX_CLAIM=$plex_claim

# Allow Plex OAuth to create users on first login.
# Set to false if you want to require admin-created users / existing accounts.
ENABLE_PLEX_SIGNUP=$enable_plex_signup

# Local admin bootstrap (used only if no users exist yet).
RIVEN_ADMIN_USERNAME=$admin_username
RIVEN_ADMIN_EMAIL=$admin_email
RIVEN_ADMIN_PASSWORD=$admin_password

# Host port mapping for Plex container port 32400 (only used if Plex is enabled + exposed).
PLEX_PORT=$plex_port
PLEX_EXPOSE_PORT=$expose_plex

# Pin Node tarball version used in the final stage.
NODE_VERSION=$node_version
EOF

  ok "Wrote $env_path (gitignored via .env*)."
}

maybe_regenerate_secrets() {
  # Secrets are persisted under ./container_data/riven and include the backend API key
  # used by the frontend. Keep this interactive and upfront.
  if ! is_interactive; then
    return
  fi

  step "Secrets"
  if prompt_yn "Regenerate secrets (API key/auth secret)?" "n"; then
    rm -f container_data/riven/secrets/riven.env 2>/dev/null || true
    ok "Deleted container_data/riven/secrets/riven.env (will be re-generated on next start)"
  else
    ok "Keeping existing secrets"
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

  # Offer swapfile creation during the interactive phase (helps small VMs).
  prompt_swapfile_if_needed

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
  mkdir -p container_data/riven

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
  ok "Prepared ./container_data"
}

compose_up() {
  local ui_port media_flavor plex_port expose_plex
  ui_port="$(env_get .env RIVEN_UI_PORT 3000)"
  media_flavor="$(env_get .env RIVEN_MEDIA_FLAVOR none)"
  plex_port="$(env_get .env PLEX_PORT 32400)"
  expose_plex="$(env_get .env PLEX_EXPOSE_PORT n)"

  # Prefer BuildKit for local builds.
  export DOCKER_BUILDKIT="${DOCKER_BUILDKIT:-1}"

  local override_file
  override_file="${COMPOSE_OVERRIDE_FILE:-/tmp/riven-dev.override.yml}"

  if ! host_has_fuse; then
    fail "Host is missing /dev/fuse; this setup requires FUSE for RivenVFS."
    fail "Install fuse3 (e.g. sudo apt-get install fuse3), load the module (sudo modprobe fuse), then re-run."
    exit 1
  fi

  write_compose_override "$override_file" "$ui_port" "$media_flavor" "$plex_port" "$expose_plex"

  step "Build + start containers"
  local -a compose_cmd
  docker_compose_cmd_array compose_cmd -- -f "$COMPOSE_FILE_DEFAULT" -f "$override_file" up -d --build
  spinner "docker compose up (build + start)" "${compose_cmd[@]}"

  step "Smoke test"
  if need_cmd curl; then
    set +e
    spinner "Frontend reachable" bash -lc '
      set -e
      url="http://localhost:'"${ui_port}"'/"
      for i in $(seq 1 60); do
        code="$(curl -fsS -o /dev/null -w "%{http_code}" -L "$url" 2>/dev/null || true)"
        if echo "$code" | grep -qE "^(200|3..)$"; then
          exit 0
        fi
        sleep 2
      done
      exit 1
    '
    rc=$?
    set -e
    if [ "$rc" -eq 0 ]; then
      ok "OK: http://localhost:${ui_port}"
    else
      dump_logs_tail riven
      exit "$rc"
    fi
  else
    warn "curl not found; skipping HTTP checks."
  fi
}

main() {
  init_ui
  parse_args "$@"
  trap on_err ERR
  trap cleanup EXIT

  say "${BOLD}Riven devbox setup${RESET} ${DIM}(this will install Docker + start containers)${RESET}"
  say "${DIM}Log: ${LOG_FILE}${RESET}"
  if [ "${DEBUG:-0}" = "1" ]; then
    warn "Debug enabled: showing all command output"
  fi

  validate_repo_root
  validate_prereqs

  # OS detection early for clearer errors.
  detect_os
  require_sudo
  ensure_sudo_cached

  # === Interactive phase (all prompts up-front) ===
  ensure_env_file
  maybe_regenerate_secrets
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
  docker_runtime_check
  ensure_swapfile
  prepare_container_data
  if [ "${AUTO_START_CONTAINERS}" = "y" ]; then
    compose_up
  else
    ok "Skipping container start"
    warn "Run later from repo root: docker compose up -d --build"
  fi

  say ""
  ok "Done"

  # Only show docker-group hints if they're actually relevant.
  case "$(docker_cmd_mode)" in
    direct)
      :
      ;;
    sg)
      warn "Docker group is set but not active in this shell yet; run: newgrp docker (or log out/in)"
      ;;
    sudo)
      if [ "${DOCKER_GROUP_ADDED}" = "y" ]; then
        warn "Docker group was updated; log out/in (or run: newgrp docker) to use docker without sudo"
      else
        warn "Docker still requires sudo in this shell; add your user to the docker group or use sudo"
      fi
      ;;
  esac
}

main "$@"
