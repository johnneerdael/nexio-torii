<p align="center">
  <img src="https://raw.githubusercontent.com/johnneerdael/nexio-torii/main/static/nexio-torii.png" width="420" alt="Nexio Torii">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Stremio-Addon-8a5a9e?style=for-the-badge&logo=stremio" alt="Stremio Addon">
  <img src="https://img.shields.io/badge/GHCR-Ready-2496ED?style=for-the-badge&logo=docker" alt="GHCR Ready">
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License MIT">
</p>

Nexio Torii is a hard fork of Amatsu for Stremio anime streams. It keeps the Nyaa search, episode parsing, subtitle proxy, P2P fallback, and stateless manifest configuration model, then routes premium unlockers through StremThru so one addon can support multiple stores.

Supported premium unlockers:

- RealDebrid
- TorBox
- AllDebrid
- Premiumize
- Debrid-Link
- Debrider
- EasyDebrid
- Offcloud
- PikPak

The default StremThru remote is `https://stremthrufortheweak.nhyira.dev/`.

## Quick Start

1. Run or deploy Nexio Torii.
2. Open `/configure` on your deployment.
3. Add one or more premium unlocker accounts under Providers & Access, or enable Simple P2P.
4. Pick language, resolution, and catalog preferences.
5. Install the generated manifest URL in Stremio.

Configuration stays stateless. Provider keys are encoded into the private Stremio manifest URL under the `NexioTorii` config key and are not written to a database.

## Docker

Build locally:

```bash
docker build -t ghcr.io/johnneerdael/nexio-torii:local .
```

Run locally:

```bash
docker run --rm \
  -p 7002:7002 \
  -e BASE_URL=http://127.0.0.1:7002 \
  -e STREMTHRU_URL=https://stremthrufortheweak.nhyira.dev/ \
  ghcr.io/johnneerdael/nexio-torii:local
```

Docker Compose:

```yaml
services:
  nexio-torii:
    image: ghcr.io/johnneerdael/nexio-torii:latest
    container_name: nexio_torii
    restart: unless-stopped
    ports:
      - "7002:7002"
    environment:
      - NODE_ENV=production
      - PORT=7002
      - BASE_URL=https://your-domain.example
      - STREMTHRU_URL=https://stremthrufortheweak.nhyira.dev/
    volumes:
      - nexio-torii-cache:/app/data

volumes:
  nexio-torii-cache:
```

## Cache Behavior

Nexio Torii uses a SQLite cache at `data/nexio-cache.sqlite` by default. The cache is designed to make stream requests return from local data whenever possible, then refresh tracker results in the background when cached data becomes stale.

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CACHE_DB_PATH` | `data/nexio-cache.sqlite` | SQLite database path |
| `TORRENT_CACHE_FRESH_MS` | `21600000` | Time torrent results are considered fresh |
| `TORRENT_CACHE_STALE_MS` | `604800000` | Time stale torrent results can still be returned while refreshing |
| `EMPTY_SEARCH_CACHE_TTL_MS` | `300000` | Time no-result searches are remembered to avoid repeated tracker misses |
| `DEBRID_CACHE_TTL_MS` | `86400000` | Time StremThru availability is cached per service/hash/episode |
| `STREAM_HTTP_MAX_AGE_SECONDS` | `1800` | Browser stream response cache TTL |
| `STREAM_HTTP_S_MAXAGE_SECONDS` | `3600` | CDN stream response cache TTL |
| `STREAM_HTTP_STALE_REVALIDATE_SECONDS` | `21600` | CDN stale-while-revalidate window |
| `STREAM_HTTP_STALE_ERROR_SECONDS` | `300` | CDN stale-if-error window |

Scrape coordination uses SQLite-backed locks in the same cache database, so multiple containers sharing the same `/app/data` volume avoid duplicate foreground scrapes for the same media key.

Stream and manifest responses include CDN-friendly `Cache-Control` headers and ETags for both direct and configured Stremio routes.

The current source set remains Nyaa, AnimeTosho, and TokyoTosho. SubsPlease, TokyoTosho account-specific behavior, and Beatrice-Raws are intentionally deferred until the cache layer is stable.

## Local Torrent Catalog Phase 1

The catalog builder is a standalone ingestion path. It populates `catalog.sqlite` from Nyaa, AnimeTosho, and TokyoTosho, but it does not change the Stremio addon runtime yet.

Initialize an empty catalog:

```bash
npm run catalog:ingest -- --source none --db data/catalog.sqlite
```

Run live source parser validation:

```bash
LIVE_CATALOG_TESTS=1 node --test tests/catalog-live.test.js
```

Run a small live ingestion sample:

```bash
ANIME_MAP_PATH=/Users/jneerdael/Scripts/nexio/app/src/main/assets/anime/nexio-anime-map-v1.json \
npm run catalog:ingest -- --source all --mode daily --limit 10 --live --db data/catalog.sqlite
```

Inspect the local SQLite catalog:

```bash
npm run catalog:validate -- --db data/catalog.sqlite --require-source nyaa --require-source animetosho --require-source tokyotosho
```

Docker ingestion uses the same `/app/data` volume as the addon, but it does not change runtime stream behavior.

Copy or mount the anime map into the data volume before first run:

```bash
mkdir -p data/anime
cp /Users/jneerdael/Scripts/nexio/app/src/main/assets/anime/nexio-anime-map-v1.json data/anime/nexio-anime-map-v1.json
```

Run the one-shot ingestion container:

```bash
docker compose --profile ingest up nexio-torii-ingest
```

Validate all three sources from logs:

```bash
docker compose logs nexio-torii-ingest | rg 'source=nyaa .*upserted=[1-9]'
docker compose logs nexio-torii-ingest | rg 'source=animetosho .*upserted=[1-9]'
docker compose logs nexio-torii-ingest | rg 'source=tokyotosho .*upserted=[1-9]'
```

Validate the SQLite catalog from Docker:

```bash
docker compose run --rm nexio-torii-ingest npm run catalog:validate -- --db /app/data/catalog.sqlite --require-source nyaa --require-source animetosho --require-source tokyotosho
```

## GHCR Publishing

The GitHub Actions workflow in `.github/workflows/deploy.yml` builds and pushes:

- `ghcr.io/johnneerdael/nexio-torii:latest`
- `ghcr.io/johnneerdael/nexio-torii:<commit-sha>`

Publishing requires the repository workflow token to have `packages: write`, which is already declared in the workflow.

## Environment

`BASE_URL`: Required in production. Public URL of your deployment, without a trailing slash.

`STREMTHRU_URL`: Optional. StremThru instance used for premium unlocker calls. Defaults to `https://stremthrufortheweak.nhyira.dev/`.

`PORT`: Optional. Defaults to `7002`.

`NYAA_DOMAIN`: Optional. Custom Nyaa mirror. Defaults to `https://nyaa.iss.one`.

`PROXY_URL`: Optional. Proxy URL for tracker or metadata access in restricted networks.

## Notes

- Uncached premium streams return the waiting video while the provider caches the torrent. Back out and retry after the provider finishes caching.
- Simple P2P bypasses premium unlockers and streams through BitTorrent. Use a VPN if exposing your IP address to peers is not acceptable.
- Legacy Amatsu manifest payloads are accepted during migration, but new configure-page URLs use the `NexioTorii` key.
