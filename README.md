# WLED Manager

A self-hosted web app for managing custom palettes and presets across multiple WLED controllers and keeping them in sync.

## Development

Tools are pinned with [mise](https://mise.jdx.dev) (`mise.toml`).

```sh
mise install
mise exec -- pnpm install
mise exec -- pnpm dev        # server on :8080, UI on :5173 (proxies /api)
mise exec -- pnpm mock       # fake WLED device on :8081 (MOCK_PORTS=8081,8082 for more)
mise exec -- pnpm test
```

After changing `apps/server/src/db/schema.ts`, generate a migration:

```sh
mise exec -- pnpm --filter @wled-manager/server db:generate
```

## Docker

```sh
docker compose up --build    # UI + API on http://localhost:8080, SQLite in ./data
```
