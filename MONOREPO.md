# Monorepo (dev branch)

This branch vendors the Riven frontend under `frontend/` so you can keep backend + frontend in a single repository checkout.

## Layout

- Backend (Python/FUSE): repo root (this project)
- Frontend (SvelteKit/Node): `frontend/`

## Build locally (two images)

From the repo root:

- Backend image:
  - `docker build -t lanadmin/riven:dev .`

- Frontend image:
  - `docker build -t lanadmin/riven-frontend:dev ./frontend`

## Run locally (docker compose)

- `docker compose -f docker-compose-dev-full.yml up -d --build`

This starts:
- Backend on `http://localhost:8080`
- Frontend on `http://localhost:3000`

Notes:
- The backend requires PostgreSQL, but in this dev setup Postgres is run **inside** the frontend container (embedded Postgres).
- Embedded Postgres data persists under `./container_data/frontend/postgres` (inside the container it's `${PGDATA:-/riven/data/postgres}`).

## Dev box bootstrap (fresh Debian/Ubuntu)

From the repo root:

- `bash dev/setup-devbox.sh`

This installs Docker/Compose, generates a local `.env`, prepares `./container_data/`, then builds/starts the stack.

## Frontend source provenance

The `frontend/` folder is vendored from `mariof1/riven-frontend` (which is a fork of `rivenmedia/riven-frontend`).

Because `git subtree` is not available in this environment, the folder is copied in (no git history inside `frontend/`).
