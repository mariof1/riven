# Riven Frontend (Rewrite)

This is a fresh, lightweight frontend built with Vite + React + Tailwind.

## Dev

From repo root, the container entrypoint starts the UI on port 3000.

For local dev:

```bash
cd frontend
pnpm install
pnpm dev -- --host 0.0.0.0 --port 3000 --strictPort
```

## Backend calls

The UI uses a dev proxy so browser code can call the backend via relative URLs:

- `GET /api/openapi.json` → `${BACKEND_URL}/openapi.json`

The proxy target is controlled by the Node process env var `BACKEND_URL` (set by `docker-entrypoint.sh`).
