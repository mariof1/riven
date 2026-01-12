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

- `docker compose up -d --build`

This starts:
- Frontend on `http://localhost:3000`

Notes:
- Backend API is internal-only (localhost inside the container).
- Postgres runs inside the same container.
- Persistent data lives under `./container_data/riven`.

## Dev box bootstrap (fresh Debian/Ubuntu)

From the repo root:

- `bash dev/setup-devbox.sh`

This installs Docker/Compose, generates a local `.env`, prepares `./container_data/`, then builds/starts the stack.

## Frontend source provenance

The `frontend/` folder is vendored from `mariof1/riven-frontend` (which is a fork of `rivenmedia/riven-frontend`).

Because `git subtree` is not available in this environment, the folder is copied in (no git history inside `frontend/`).
