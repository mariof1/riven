#!/bin/sh

set -eu

export PROTOCOL_HEADER=x-forwarded-proto
export HOST_HEADER=x-forwarded-host

if [ -z "${ORIGIN:-}" ]; then
    echo "ORIGIN is not set"
else
    export ORIGIN="${ORIGIN}"
fi

# -----------------------------------------------------------------------------
# Embedded Postgres (dev)
# -----------------------------------------------------------------------------

PGDATA="${PGDATA:-/riven/data/postgres}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-riven}"

mkdir -p "$PGDATA"
chown -R postgres:postgres "$PGDATA"
chmod 700 "$PGDATA"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
    echo "Initializing Postgres data directory at $PGDATA"
    su-exec postgres initdb -D "$PGDATA" >/dev/null

    # Dev-only auth/network settings
    {
        echo "listen_addresses='*'";
    } >> "$PGDATA/postgresql.conf"

    {
        echo "host all all 0.0.0.0/0 scram-sha-256";
        echo "host all all ::/0 scram-sha-256";
    } >> "$PGDATA/pg_hba.conf"
fi

echo "Starting embedded Postgres..."
mkdir -p /run/postgresql
chown postgres:postgres /run/postgresql
chmod 775 /run/postgresql
su-exec postgres postgres -D "$PGDATA" -p 5432 >/dev/null 2>&1 &
pg_pid=$!

# Wait for Postgres to accept connections
for i in $(seq 1 60); do
    if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

escape_sql_literal() {
    # Escape single quotes for SQL string literals
    printf "%s" "$1" | sed "s/'/''/g"
}

escape_sql_ident() {
    # Double-quote and escape identifier double quotes
    ident_escaped=$(printf "%s" "$1" | sed 's/"/""/g')
    printf '"%s"' "$ident_escaped"
}

pg_user_lit=$(escape_sql_literal "$POSTGRES_USER")
pg_pass_lit=$(escape_sql_literal "$POSTGRES_PASSWORD")
pg_db_lit=$(escape_sql_literal "$POSTGRES_DB")
pg_user_ident=$(escape_sql_ident "$POSTGRES_USER")
pg_db_ident=$(escape_sql_ident "$POSTGRES_DB")

# Ensure user/db exist (idempotent)
su-exec postgres psql -v ON_ERROR_STOP=1 --username=postgres --dbname=postgres \
    -c "DO \$\$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${pg_user_lit}') THEN
        EXECUTE 'CREATE ROLE ${pg_user_ident} LOGIN PASSWORD ''${pg_pass_lit}''';
    ELSE
        EXECUTE 'ALTER ROLE ${pg_user_ident} WITH PASSWORD ''${pg_pass_lit}''';
    END IF;
END
\$\$;" \
    >/dev/null

if ! su-exec postgres psql --username=postgres --dbname=postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${pg_db_lit}'" | grep -q 1; then
    su-exec postgres psql -v ON_ERROR_STOP=1 --username=postgres --dbname=postgres \
        -c "CREATE DATABASE ${pg_db_ident} OWNER ${pg_user_ident};" >/dev/null
fi

term_handler() {
    echo "Shutting down..."
    kill -TERM "$pg_pid" 2>/dev/null || true
    if [ -n "${app_pid:-}" ]; then
        kill -TERM "$app_pid" 2>/dev/null || true
    fi
}

trap term_handler INT TERM

"$@" &
app_pid=$!

wait "$app_pid"
exit_code=$?

kill -TERM "$pg_pid" 2>/dev/null || true
wait "$pg_pid" 2>/dev/null || true

exit "$exit_code"