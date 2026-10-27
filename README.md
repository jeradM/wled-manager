# WLED Manager

[![CI](https://github.com/jeradM/wled-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/jeradM/wled-manager/actions/workflows/ci.yml)

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

## Configuration

| Env var | Default | |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `./data` | SQLite location |
| `POLL_INTERVAL_MS` | `30000` | Default controller status poll interval (`0` disables); a value saved on the Settings page takes precedence |

## Docker

Build and run from source:

```sh
docker compose up --build    # UI + API on http://localhost:8080, SQLite in ./data
```

Or run a published image (linux/amd64 and linux/arm64):

```sh
docker run -d -p 8080:8080 -v ./data:/data --restart unless-stopped ghcr.io/jeradm/wled-manager:latest
```


## CI and releases

- **CI** (`.github/workflows/ci.yml`) typechecks, tests and builds on every push.
- **Publish Docker image** (`.github/workflows/docker-publish.yml`) is run by hand from the Actions tab. It runs CI,
  then pushes `ghcr.io/jeradm/wled-manager` tagged `sha-<commit>`, plus an optional version tag and `latest`.
  After the first publish, check the package's visibility under *Package settings* and set it to public if needed.
