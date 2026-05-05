# Multi-Service StremThru Unlockers Design

## Context

This is a greenfield hard fork of Amatsu. It does not need to preserve existing install URLs or legacy `rdKey` / `tbKey` configuration. The fork should support the same premium unlocker model as Comet and StremThru by using StremThru as the single debrid boundary.

Amatsu currently has provider-specific RealDebrid and TorBox paths in `lib/debrid.js`, `addon.js`, and `server.js`. Comet instead routes debrid availability and playback through StremThru's generic store API. StremThru supports the target torrent stores through `/v0/store/torz/*` endpoints selected by `X-StremThru-Store-Name`.

## Goals

- Replace provider-specific debrid branches with a generic StremThru-backed provider layer.
- Use Comet-style multi-service configuration entries.
- Support RealDebrid, TorBox, AllDebrid, Premiumize, Debrid-Link, Debrider, EasyDebrid, Offcloud, and PikPak.
- Keep Amatsu's existing Nyaa scraping, filtering, parser, sorting, P2P, waiting video, archive video, and subtitle-proxy behavior where they still apply.
- Avoid putting raw provider API keys as standalone route path segments in new playback URLs.

## Non-Goals

- Preserve legacy `rdKey` or `tbKey` payloads.
- Implement native provider APIs for each unlocker.
- Add StremThru's `stremthru` pseudo-store on day one.
- Guarantee Offcloud episode-level series matching when StremThru does not return per-file metadata.
- Preserve per-provider active download progress percentages in the first pass.

## Supported Service Registry

The fork should define one registry for labels, display names, API key help, and validation:

| Service | Code | Display Name |
| --- | --- | --- |
| `realdebrid` | `RD` | RealDebrid |
| `torbox` | `TB` | TorBox |
| `alldebrid` | `AD` | AllDebrid |
| `premiumize` | `PM` | Premiumize |
| `debridlink` | `DL` | Debrid-Link |
| `debrider` | `DB` | Debrider |
| `easydebrid` | `ED` | EasyDebrid |
| `offcloud` | `OC` | Offcloud |
| `pikpak` | `PP` | PikPak |

## Configuration Model

The configure page should emit only greenfield keys. Debrid credentials live in a `debridServices` array:

```json
{
  "debridServices": [
    { "service": "realdebrid", "apiKey": "..." },
    { "service": "premiumize", "apiKey": "..." }
  ],
  "enableP2P": true,
  "hideUncached": false,
  "language": ["ENG", "JPN"],
  "resolutions": ["1080p", "720p"]
}
```

Config normalization should drop malformed entries and unsupported service names. Multiple entries for the same service are allowed because they may represent different user accounts.

The Stremio manifest payload remains Base64 URL-safe JSON under the existing `Amatsu` config key unless the fork deliberately renames the addon/config key later.

## Provider Layer

Create a generic StremThru provider layer that owns all debrid API calls:

- `checkStoreTorz(hashes, entry, options)` calls `GET /v0/store/torz/check`.
- `addStoreTorz(magnet, entry, options)` calls `POST /v0/store/torz`.
- `generateStoreLink(link, entry, options)` calls `POST /v0/store/torz/link/generate`.
- `checkStoreUser(entry, options)` calls `GET /v0/store/user` for validation or account diagnostics when needed.

Each request sets:

- `X-StremThru-Store-Name: <entry.service>`
- `X-StremThru-Store-Authorization: Bearer <entry.apiKey>`
- `User-Agent: Amatsu/<version>`

The provider layer should handle request timeouts, short error caches, chunking, and mapping StremThru file data into Amatsu's file selector shape:

```js
{
  id: file.index,
  link: file.link,
  name: file.name || file.path || "Unknown",
  path: file.path,
  size: file.size
}
```

## Stream Flow

The stream handler should:

1. Parse and normalize `debridServices`.
2. Continue using Amatsu's existing metadata, Nyaa scraping, torrent filtering, language extraction, resolution extraction, and sorting.
3. Build the torrent hash list once.
4. Check StremThru torz availability for all configured services in parallel.
5. Generate streams by looping over each torrent and each configured service entry.

For a service entry:

- Cached with files: select the best video file with the existing parser and emit a cached stream.
- Cached but no matching episode file for a series: skip that stream.
- Cached with subtitle files: attach subtitle proxy URLs using the same subtitle extensions Amatsu already supports.
- Not cached and `hideUncached` is false: emit an uncached download stream.
- Not cached and `hideUncached` is true: skip the stream.

Stream labels should stay compact:

- `AMATSU [⚡ PM]` for cached Premiumize.
- `AMATSU [☁️ AD]` for uncached AllDebrid.
- `AMATSU [⚡ RD]` for cached RealDebrid.

Offcloud should be conservative in the first pass. If StremThru reports cached status without files, emit it for movie/raw-search requests only. Do not emit series episode streams without reliable per-file metadata.

## Playback Flow

Playback URLs should remain stateless by carrying the same opaque Base64 URL-safe config payload used by the manifest. They should reference the service entry index rather than embedding the service name and raw API key as standalone path segments:

```text
/resolve/:amatsuPayload/:serviceIndex/:hash/:episode?
```

The resolver should receive enough context to select files reliably. Include title context in query parameters when needed, but credentials must come from the decoded opaque config payload rather than from `/:provider/:apiKey/` style route segments.

The resolver should:

1. Decode `amatsuPayload`, normalize config, and find `debridServices[serviceIndex]`.
2. Build the magnet from the hash and available torrent title/trackers.
3. Add or fetch the torrent through `POST /v0/store/torz`.
4. If status is `queued`, `downloading`, `processing`, or `uploading`, return the waiting video.
5. If status is `failed`, `invalid`, or explicitly dead, return a 404.
6. If status is `cached` or `downloaded`, select the best video file.
7. Call `POST /v0/store/torz/link/generate` with the selected file link.
8. Redirect Stremio to the generated direct link.

The subtitle proxy should use the same service index model:

```text
/sub/:amatsuPayload/:serviceIndex/:hash/:fileId
```

It should resolve the file through StremThru and proxy the generated direct link with Amatsu's existing MIME correction and connection cleanup.

## Error Handling

All provider failures should be scoped to the affected service entry:

- Invalid key or expired subscription: skip that service's streams and log a clear provider-scoped error.
- Rate limit or temporary StremThru failure: return no cached results for that service and cache the failure briefly.
- Uncached torrent clicked: add the magnet and return the waiting video.
- Cached torrent without a playable file: return the archive video.
- Direct link generation failure: return the waiting video for temporary states and 404 for explicit failed/invalid torrents.

Provider failures should not prevent P2P streams or other configured debrid services from appearing.

## Testing

Add focused tests around the new generic boundaries:

- Config normalization accepts the supported service set and drops malformed entries.
- StremThru torz check responses map cached files into Amatsu's selector shape.
- Stream generation emits separate streams for multiple configured services.
- `hideUncached` is preserved per service.
- Resolve flow handles pending, failed, cached, and downloaded statuses.
- Resolve flow selects the best file and calls link generation.
- Offcloud series behavior does not promise episode selection without file metadata.

Manual verification should cover:

- Configure at least RealDebrid plus Premiumize.
- Confirm separate `[RD]` and `[PM]` stream names.
- Confirm cached streams resolve to direct links.
- Confirm uncached streams show the waiting video.
- Confirm P2P remains independent when enabled.

## Open Implementation Notes

- Prefer a small provider registry shared by frontend and backend if the project structure makes that practical; otherwise keep duplicated display metadata minimal and test the backend registry.
- Keep the first implementation focused on torrent playback through StremThru torz endpoints. Usenet and WebDL-specific flows are out of scope.
- Treat StremThru endpoint shape as the contract and avoid provider-specific conditionals except documented store limitations such as Offcloud missing files in torz checks.
