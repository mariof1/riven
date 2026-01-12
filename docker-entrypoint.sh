#!/usr/bin/env bash
set -euo pipefail

# Container entrypoint (dev): starts embedded Postgres + backend + frontend,
# and optionally Plex, all inside a single container.
#
# Goals:
# - minimal required env (ideally none)
# - auto-generate and persist secrets under /riven/data
# - keep backend internal-only (localhost)

# -----------------------------
# UI helpers (minimal spam)
# -----------------------------

is_tty() { [ -t 1 ]; }
need_cmd() { command -v "$1" >/dev/null 2>&1; }

init_ui() {
  if is_tty && need_cmd tput; then
    BOLD="$(tput bold)"; DIM="$(tput dim)"; RESET="$(tput sgr0)"
    RED="$(tput setaf 1)"; GREEN="$(tput setaf 2)"; YELLOW="$(tput setaf 3)"; BLUE="$(tput setaf 4)"
  else
    BOLD=""; DIM=""; RESET=""; RED=""; GREEN=""; YELLOW=""; BLUE=""
  fi
}

say() { printf "%b\n" "$*" 1>&2; }
ok() { say "${GREEN}✔${RESET} $*"; }
warn() { say "${YELLOW}•${RESET} $*"; }
fail() { say "${RED}✖${RESET} $*"; }
step() { say "${BOLD}${BLUE}==>${RESET} ${BOLD}$*${RESET}"; }

# -----------------------------
# Paths / config
# -----------------------------

DATA_DIR="${RIVEN_DATA_DIR:-/riven/data}"
SECRETS_DIR="$DATA_DIR/secrets"
SECRETS_ENV="$SECRETS_DIR/riven.env"

FRONTEND_DATA_DIR="$DATA_DIR/frontend"
PLEX_DATA_DIR="$DATA_DIR/plex"

PGDATA="${PGDATA:-$DATA_DIR/postgres}"
PGHOST="127.0.0.1"
PGPORT="5432"

# Postgres DB/role used by backend
DB_NAME="${RIVEN_DB_NAME:-riven}"
DB_USER="${RIVEN_DB_USER:-riven}"

# Runtime feature selection
# - none (default)
# - plex
MEDIA_FLAVOR="${RIVEN_MEDIA_FLAVOR:-none}"

# -----------------------------
# Helpers
# -----------------------------

rand_hex() {
  local nbytes="$1"
  if need_cmd openssl; then
    openssl rand -hex "$nbytes"
  else
    python3 - <<PY
import secrets
print(secrets.token_hex(int("$nbytes")))
PY
  fi
}

ensure_dirs() {
  mkdir -p "$DATA_DIR" "$SECRETS_DIR" "$FRONTEND_DATA_DIR"
}

write_env_kv() {
  local key="$1" value="$2" file="$3"
  # Update or append KEY=VALUE
  if [ -f "$file" ] && grep -qE "^${key}=" "$file"; then
    # Use perl for safe in-place editing
    perl -0777 -pe "s/^${key}=.*$/\Q${key}\E=${value}/m" -i "$file"
  else
    printf "%s=%s\n" "$key" "$value" >>"$file"
  fi
}

load_or_init_secrets() {
  step "Secrets"
  ensure_dirs

  local pre_db_pass
  pre_db_pass="${RIVEN_DB_PASSWORD:-}"

  if [ ! -f "$SECRETS_ENV" ]; then
    umask 077
    : >"$SECRETS_ENV"

    local api_key auth_secret
    api_key="$(rand_hex 16)"          # 32 chars
    auth_secret="$(rand_hex 32)"      # 64 chars

    write_env_kv "RIVEN_API_KEY" "$api_key" "$SECRETS_ENV"
    write_env_kv "FRONTEND_AUTH_SECRET" "$auth_secret" "$SECRETS_ENV"

    ok "Generated secrets at $SECRETS_ENV"
  else
    ok "Using secrets at $SECRETS_ENV"
  fi

  # shellcheck disable=SC1090
  set -a
  . "$SECRETS_ENV"
  set +a

  # Prefer user-provided DB password from the container environment.
  if [ -n "${pre_db_pass:-}" ]; then
    export RIVEN_DB_PASSWORD="$pre_db_pass"
  fi

  # If no DB password was provided, generate and persist one.
  if [ -z "${RIVEN_DB_PASSWORD:-}" ]; then
    export RIVEN_DB_PASSWORD="$(rand_hex 32)"
    write_env_kv "RIVEN_DB_PASSWORD" "$RIVEN_DB_PASSWORD" "$SECRETS_ENV"
    ok "Generated database password"
  fi
}

configure_fuse() {
  # Allow -o allow_other if needed by rivenvfs
  if [ -f /etc/fuse.conf ]; then
    sed -i 's/^#\s*user_allow_other/user_allow_other/' /etc/fuse.conf || true
    if ! grep -q '^user_allow_other' /etc/fuse.conf; then
      echo 'user_allow_other' >>/etc/fuse.conf
    fi
  fi

  # Ensure mountpoint exists.
  mkdir -p /mount

  # User request: make mount propagation shared inside the container
  # (this only affects processes in this container's mount namespace).
  if mountpoint -q /mount 2>/dev/null; then
    :
  else
    # If /mount is not a mountpoint, bind-mount it to itself so we can change propagation.
    mount --bind /mount /mount 2>/dev/null || true
  fi
  mount --make-rshared /mount 2>/dev/null || true
}

postgres_bin_dir() {
  # Debian packages install versioned binaries under /usr/lib/postgresql/*/bin
  local dir
  dir="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n 1 || true)"
  if [ -z "$dir" ]; then
    return 1
  fi
  echo "$dir"
}

init_postgres() {
  step "Postgres"

  mkdir -p "$PGDATA"
  chown -R postgres:postgres "$PGDATA"
  chmod 700 "$PGDATA"

  local pg_bin
  pg_bin="$(postgres_bin_dir)"

  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    say "${DIM}Initializing database at $PGDATA…${RESET}"
    su -s /bin/bash postgres -c "'$pg_bin/initdb' -D '$PGDATA'" >/dev/null

    {
      echo "listen_addresses = '$PGHOST'";
      echo "port = $PGPORT";
    } >>"$PGDATA/postgresql.conf"

    {
      echo "local all all scram-sha-256";
      echo "host all all 127.0.0.1/32 scram-sha-256";
    } >>"$PGDATA/pg_hba.conf"
  fi
}

start_postgres() {
  local pg_bin
  pg_bin="$(postgres_bin_dir)"

  mkdir -p /run/postgresql
  chown postgres:postgres /run/postgresql
  chmod 775 /run/postgresql

  say "${DIM}Starting Postgres…${RESET}"
  su -s /bin/bash postgres -c "'$pg_bin/postgres' -D '$PGDATA' -k /run/postgresql -h '$PGHOST' -p '$PGPORT'" \
    >/dev/null 2>&1 &
  PG_PID=$!

  # Wait for readiness
  for _ in $(seq 1 60); do
    if su -s /bin/bash postgres -c "'$pg_bin/pg_isready' -h '$PGHOST' -p '$PGPORT'" >/dev/null 2>&1; then
      ok "Postgres ready"
      return
    fi
    sleep 1
  done

  fail "Postgres did not become ready"
  exit 1
}

escape_sql_literal() {
  printf "%s" "$1" | sed "s/'/''/g"
}

ensure_db_role_and_db() {
  local pg_bin
  pg_bin="$(postgres_bin_dir)"

  local user_lit pass_lit db_lit user_ident db_ident
  user_lit="$(escape_sql_literal "$DB_USER")"
  pass_lit="$(escape_sql_literal "${RIVEN_DB_PASSWORD}")"
  db_lit="$(escape_sql_literal "$DB_NAME")"

  # Quote identifiers
  user_ident="\"$(printf "%s" "$DB_USER" | sed 's/"/""/g')\""
  db_ident="\"$(printf "%s" "$DB_NAME" | sed 's/"/""/g')\""

  if su -s /bin/bash postgres -c "'$pg_bin/psql' --username=postgres --dbname=postgres -tAc \"SELECT 1 FROM pg_roles WHERE rolname='${user_lit}'\"" | grep -q 1; then
    su -s /bin/bash postgres -c "'$pg_bin/psql' -v ON_ERROR_STOP=1 --username=postgres --dbname=postgres -c \"ALTER ROLE ${user_ident} WITH PASSWORD '${pass_lit}';\"" >/dev/null
  else
    su -s /bin/bash postgres -c "'$pg_bin/psql' -v ON_ERROR_STOP=1 --username=postgres --dbname=postgres -c \"CREATE ROLE ${user_ident} LOGIN PASSWORD '${pass_lit}';\"" >/dev/null
  fi

  if ! su -s /bin/bash postgres -c "'$pg_bin/psql' --username=postgres --dbname=postgres -tAc \"SELECT 1 FROM pg_database WHERE datname='${db_lit}'\"" | grep -q 1; then
    su -s /bin/bash postgres -c "'$pg_bin/psql' -v ON_ERROR_STOP=1 --username=postgres --dbname=postgres -c \"CREATE DATABASE ${db_ident} OWNER ${user_ident};\"" >/dev/null
  fi

  ok "DB ready (${DB_NAME})"
}

start_backend() {
  step "Backend (internal only)"

  export RIVEN_FORCE_ENV=true
  # Filesystem mount path is fixed inside the container.
  export RIVEN_FILESYSTEM_MOUNT_PATH="/mount"
  export ORIGIN="http://127.0.0.1:8080"

  # Use embedded Postgres (internal)
  export RIVEN_DATABASE_HOST="postgresql+psycopg2://${DB_USER}:${RIVEN_DB_PASSWORD}@${PGHOST}:${PGPORT}/${DB_NAME}"

  # Backend API key used by frontend to talk to backend.
  export API_KEY="${RIVEN_API_KEY}"

  # Backend binds 0.0.0.0 by default; this is still "internal-only" as long as we
  # do not publish :8080 from the container.
  /riven/.venv/bin/python /riven/src/main.py --port 8080 &
  BACKEND_PID=$!
  ok "Backend started"
}

wait_for_backend() {
  say "${DIM}Waiting for backend…${RESET}"

  for _ in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:8080/openapi.json >/dev/null 2>&1; then
      ok "Backend ready"
      return
    fi
    sleep 1
  done

  warn "Backend did not become ready in time"
}

start_frontend() {
  step "Frontend"

  export ORIGIN="${FRONTEND_ORIGIN:-http://localhost:3000}"
  export BACKEND_URL="http://127.0.0.1:8080"
  export BACKEND_API_KEY="${RIVEN_API_KEY}"
  export AUTH_SECRET="${FRONTEND_AUTH_SECRET}"
  export DATABASE_URL="${FRONTEND_DATABASE_URL:-$FRONTEND_DATA_DIR/riven.db}"

  (
    cd /riven/frontend
    # Generate SvelteKit artifacts (e.g., .svelte-kit/tsconfig.json) for cleaner dev logs.
    npm run prepare >/dev/null 2>&1 || true
    npm run dev -- --host 0.0.0.0 --port 3000 --strictPort
  ) &
  FRONTEND_PID=$!
  ok "Frontend started"
}

install_plex_if_needed() {
  # Plex is proprietary: we do NOT ship it in the image.
  # For dev convenience, we can download and install it at runtime if user provides a URL.
  #
  # Required:
  # - PLEX_DEB_URL (direct URL to a Plex Media Server .deb)
  # Optional:
  # - PLEX_CLAIM (claim token)
  # - Any other PLEX_* env vars are passed through

  if [ "$MEDIA_FLAVOR" != "plex" ] && [ "$MEDIA_FLAVOR" != "all" ]; then
    return
  fi

  step "Plex (optional)"

  if [ -z "${PLEX_DEB_URL:-}" ]; then
    warn "Plex enabled but PLEX_DEB_URL is not set; skipping Plex install/start."
    warn "Provide a Plex .deb URL via PLEX_DEB_URL in your compose/env."
    return
  fi

  mkdir -p "$PLEX_DATA_DIR"

  say "${DIM}Installing Plex from PLEX_DEB_URL…${RESET}"
  tmp_deb="/tmp/plexmediaserver.deb"
  curl -fsSL "$PLEX_DEB_URL" -o "$tmp_deb"
  dpkg -i "$tmp_deb" >/dev/null 2>&1 || true
  apt-get update -y >/dev/null 2>&1
  apt-get install -y -f >/dev/null 2>&1
  rm -f "$tmp_deb"

  # Plex runs as its own user; ensure data dir exists and is writable.
  chown -R plex:plex "$PLEX_DATA_DIR" 2>/dev/null || true

  # Start plex. The package installs systemd unit; we run binary directly.
  # Common path: /usr/lib/plexmediaserver/Plex\ Media\ Server
  local plex_bin="/usr/lib/plexmediaserver/Plex Media Server"
  if [ ! -x "$plex_bin" ]; then
    # Some distros install in a different path.
    plex_bin="/usr/lib/plexmediaserver/Plex Media Server"
  fi

  if [ ! -x "$plex_bin" ]; then
    warn "Plex installed but executable not found at expected path; skipping start."
    return
  fi

  export PLEX_MEDIA_SERVER_APPLICATION_SUPPORT_DIR="$PLEX_DATA_DIR"

  # Pass-through any user-provided Plex env vars.
  # (They can set things like PLEX_CLAIM, ADVERTISE_IP, etc.)

  su -s /bin/bash plex -c "'$plex_bin'" &
  PLEX_PID=$!
  ok "Plex started"
}

shutdown() {
  say "${DIM}Shutting down…${RESET}"

  for pid in "${PLEX_PID:-}" "${FRONTEND_PID:-}" "${BACKEND_PID:-}" "${PG_PID:-}"; do
    if [ -n "$pid" ] && kill -0 "$pid" >/dev/null 2>&1; then
      kill -TERM "$pid" >/dev/null 2>&1 || true
    fi
  done

  wait || true
}

main() {
  init_ui
  trap shutdown INT TERM

  ensure_dirs
  configure_fuse
  load_or_init_secrets

  init_postgres
  start_postgres
  ensure_db_role_and_db

  start_backend
  wait_for_backend
  start_frontend

  install_plex_if_needed

  step "Ready"
  ok "UI: ${FRONTEND_ORIGIN:-http://localhost:3000}"
  warn "Backend API is internal-only (127.0.0.1:8080)"

  # Wait on frontend by default.
  wait "$FRONTEND_PID"
}

main "$@"
