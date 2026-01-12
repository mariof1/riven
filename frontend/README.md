# Riven Frontend (Rewrite)

This is a fresh, lightweight frontend built with Vite + React + Tailwind.

## Dev

From repo root, the container entrypoint starts the UI on port 3000.

For local dev:

```bash
cd frontend
pnpm install
pnpm dev -- --host 0.0.0.0
```

## Backend calls

The UI uses a dev proxy so browser code can call the backend via relative URLs:

- `GET /openapi.json` → `${BACKEND_URL}/openapi.json`
- `GET /api/v1/*` → `${BACKEND_URL}/api/v1/*`

The proxy target is controlled by the Node process env var `BACKEND_URL` (set by `docker-entrypoint.sh`).

## Authentication

This rewrite restores the old `origin/dev` auth behavior using Better Auth:

- Auth endpoints are served by the Vite dev server at `/api/auth/*`.
- Plex PIN OAuth helper endpoints are served at `/api/plex/authorize` and `/api/plex/callback`.

Env vars (Docker entrypoint sets these automatically):

- `ORIGIN` (public URL for callbacks)
- `AUTH_SECRET`
- `DATABASE_URL` (sqlite path)
- Optional bootstrap: `RIVEN_ADMIN_USERNAME`, `RIVEN_ADMIN_EMAIL`, `RIVEN_ADMIN_PASSWORD`
