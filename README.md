<p align="center">
  <img src="apps/web/public/icons/icon-512x512.png" alt="Mixarr" width="128" height="128">
</p>

<h1 align="center">Mixarr</h1>

<p align="center">
  <strong>Music Discovery & Management for Lidarr</strong>
</p>

<p align="center">
  <a href="https://aquantumofdonuts.github.io/mixarr/"><img src="https://img.shields.io/badge/Website-mixarr-00d4aa?style=flat-square" alt="Website"></a>
  <a href="https://github.com/aquantumofdonuts/mixarr/releases/tag/v3.0.0"><img src="https://img.shields.io/badge/Release-v3.0.0-bf7a56?style=flat-square" alt="Release v3.0.0"></a>
  <a href="https://github.com/aquantumofdonuts/mixarr"><img src="https://img.shields.io/github/stars/aquantumofdonuts/mixarr?style=flat-square" alt="GitHub"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPLv3-blue?style=flat-square" alt="License"></a>
</p>

Mixarr is a self-hosted music discovery and catalog companion for Lidarr. Bring playlists, charts, listening history, and recommendations together; inspect artists and their sources; review discoveries; and send your choices to Lidarr. Explore recording credits with Collaboration Constellation, schedule 56 subscription types, and optionally use AI recommendations.

**v3.0.0 is available** for AMD64 and ARM64, in unified and slim images. This major release adds a compact catalog, shared artist inspector, clearer acquisition outcomes, and direct upgrades from released v2 schemas. [Read the release announcement](https://github.com/aquantumofdonuts/mixarr/releases/tag/v3.0.0) · [Upgrade an existing installation](#upgrading) · [Full changelog](CHANGELOG.md)

![Mixarr v3.0.0 discovery catalog](website/img/mixarr-discover.png)

Screenshots use fictional demonstration data. Provider availability depends on each service's API and authorization; see [known limitations](#known-limitations).

## Quick Start

### Docker Compose (Recommended)

For a **new installation**, create a `.env` file. Generate a session secret once with `openssl rand -hex 32`, replace the placeholder below, and keep this file for future upgrades:

```dotenv
SESSION_SECRET=replace_with_your_generated_secret
BASE_URL=https://YOUR-IP:3443
FRONTEND_URL=https://YOUR-IP:3443
```

Create a `docker-compose.yml`:

```yaml
services:
  mixarr:
    image: ghcr.io/aquantumofdonuts/mixarr:v3.0.0
    container_name: mixarr
    ports:
      - "3443:443"  # HTTPS Access
      - "3010:3000" # Web UI (HTTP, bypasses Caddy)
    volumes:
      - /path/to/data:/data
    environment:
      SESSION_SECRET: ${SESSION_SECRET:?Set SESSION_SECRET in .env}
      BASE_URL: ${BASE_URL:?Set BASE_URL in .env}
      FRONTEND_URL: ${BASE_URL}
    restart: unless-stopped
```

Run it:

```bash
docker compose up -d
```

### Docker Run

Use the same saved `.env` file from the new-install instructions above:

```bash
docker run -d \
  --name mixarr \
  -p 3443:443 \
  -p 3010:3000 \
  -v ~/mixarr-data:/data \
  --env-file .env \
  ghcr.io/aquantumofdonuts/mixarr:v3.0.0
```

> **Note**: Access the web interface at **`https://YOUR-IP:3443`**.

---

## Deployment Options

Both image variants are published for `linux/amd64` and `linux/arm64`:

| Versioned image | Moving stable alias | Contents | Best for |
| --- | --- | --- | --- |
| `ghcr.io/aquantumofdonuts/mixarr:v3.0.0` | `:latest` | API, web, MariaDB, Redis, Caddy | One container with persistent `/data` |
| `ghcr.io/aquantumofdonuts/mixarr:v3.0.0-slim` | `:slim` | API and web | Separate database and Redis services |

The examples pin v3.0.0 for a repeatable installation. `latest` and `slim` track stable releases and can advance to a newer version.

### Option 1: Unified Image (Default)

Everything in one container - the examples above use this approach.

### Option 2: Slim Image with Compose

For a new slim installation, use separate application, database, and Redis containers:

```bash
curl -fsSL https://raw.githubusercontent.com/aquantumofdonuts/mixarr/prod/docker-compose.slim.yml -o docker-compose.yml
# Set SESSION_SECRET in .env and change the database passwords in the Compose file.
docker compose up -d
```

The supplied Compose file uses `v3.0.0-slim`. Open `http://YOUR-IP:3000`; no `API_URL` override is needed for the bundled web/API connection. Complete the Base URL setting during setup, using the URL you actually browse.

### Option 3: Slim Image with Existing Infrastructure

For users with existing MariaDB/MySQL and Redis:

```bash
docker run -d \
  --name mixarr \
  -p 3000:3000 \
  --env-file .env \
  -v ~/mixarr-data:/data \
  ghcr.io/aquantumofdonuts/mixarr:v3.0.0-slim
```

For this option, add `DATABASE_URL=mysql://user:pass@your-db:3306/mixarr` and `REDIS_URL=redis://your-redis:6379` to the saved `.env` file, along with `SESSION_SECRET`, `BASE_URL`, and `FRONTEND_URL`. See [docker-compose.byo.yml](docker-compose.byo.yml) for the Compose equivalent. Keep the database and Redis data persistent as well.

### Unraid

Use the [v3.0.0 Unraid template](deploy/unraid.xml), or enter the unified image's ports, persistent `/data` mapping, and environment variables in Unraid's Docker UI. Preserve the existing data mapping and session secret when updating an installed container.

---
## Post-Installation Setup

1.  **Create Admin Account**: Follow the prompts on first launch.
2.  **Global Settings**: Go to **Settings > Global** and ensure `Base URL` is set correctly (e.g., `https://192.168.1.10:3443`). This is critical for OAuth callbacks.
3.  **Connect Lidarr**: Open **Connections** and add your Lidarr URL and API Key.
4.  **Add Services**: Connect Spotify, Tidal, or Last.fm to start discovering music.

---

## Features

*   **Compact Catalog & Artist Inspector** — artwork rows, source provenance, persistent filters, and artist identity, library membership, and release chronology without losing your place.
*   **56 Subscription Types** across 12 services — playlists, charts, tags, recommendations, user libraries, followed artists, and more. Set them to run on a schedule and forget about it.
*   **Review Queue & Clear Outcomes** — choose preview, queue, or automatic handling per subscription. Review discoveries, undo eligible rejections, and distinguish added, already present, failed, uncertain, and identity-required outcomes.
*   **SkyHook Cache Warming** — pre-warms MusicBrainz metadata to reduce transient Lidarr add failures.
*   **Multi-Service Support**:
    *   **Spotify** — playlists, new releases, saved albums/tracks, followed artists, top artists, recommendations, search
    *   **TIDAL** — playlists, favorites, followed artists, discovery mixes, new arrivals
    *   **Last.fm** — charts, tags, similar artists, user library, weekly charts, related tags
    *   **ListenBrainz** — top listens, similar users, recommendations, fresh releases, weekly jams, playlists, radio
    *   **Deezer** — playlists, charts, editorial picks, user favorites, flow, recommendations
    *   **Discogs** — label/style discovery and recording credits for Collaboration Constellation
    *   **Plex & Jellyfin** — recommendations based on listening history
    *   **MusicBrainz** — tag-based discovery
    *   **Bandcamp** — tag and search discovery
*   **AI Recommendations** — OpenAI, Anthropic, Google Gemini, or local Ollama. Analyzes your library and suggests what's missing.
*   **Library Health** — tools to analyze and repair your Lidarr library. Fix missing metadata with one click.
*   **Collaboration Constellation** — an interactive graph of credited album personnel. Start from an artist, explore who-actually-recorded-with-whom, and send discoveries to Lidarr. See below.

---

## Collaboration Constellation

An interactive, force-directed graph of **credited album personnel** — the musicians, producers, songwriters, and engineers who actually appear in the liner notes. Start from an artist, explore outward through who-actually-recorded-with-whom, and send discoveries straight to Lidarr. Reachable at the `/constellation` route (under **Discovery** in the nav).

Edges mean **"credited together on a record"** — never "listeners of X also like Y." This surfaces throughlines no recommendation engine can: a rock bassist → his solo LP → its flutist → a string quartet. Genuine dead-ends are allowed — an obscure session player with two credits is a real leaf, not a loading bug.

> **Plex Pass is not required.** Sonic analysis is explicitly out of scope — Plexamp owns "what sounds like this." Genre coloring here comes from Discogs/MusicBrainz tags, not from listening to the audio.

### Live API vs. local index (the key operational decision)

Collaboration data can come from live APIs or a local index. This is a global toggle (`constellationIndexEnabled`, see *Settings* below), and it's the one real decision to make:

| | **Live API (default, OFF)** | **Local index (ON)** |
|---|---|---|
| Setup | None | Downloads + parses the Discogs data dump |
| Footprint | Light | Large disk + hours of parsing |
| Exploration speed | Slower (rate-limited) | Fast, offline |
| Genre node coloring | Unavailable (neutral nodes) | Available |

*   **Live API (OFF — the default):** queries Discogs/MusicBrainz live. No setup, light footprint. Exploration is slower because it's rate-limited, and **genre-based node coloring is unavailable** on the live path (nodes render neutral). Everything else — collaboration edges, tie-strength weights, bridge scoring, shortest-path, and the "in your library" ring — still works.
*   **Local index (ON):** builds a **credit-only index** from the Discogs CC0 monthly data dump. Fast, offline exploration plus genre coloring. **Honest cost:** the resulting index is small, but *building* it downloads and stream-parses the **full Discogs releases dump (~10GB compressed, ~100GB+ uncompressed)** — hours of parsing, repeated on each refresh. A real disk-and-time commitment, aimed at power users. Automatic index refresh is unavailable; saving the refresh preference does not start or stop an import.

### Integrations it uses

*   **Deezer** — 30-second track previews (no auth required).
*   **Lidarr** — send-to-library. An artist must exist in MusicBrainz to be auto-added; if it doesn't, that's an honest "not in MusicBrainz" dead-end — the node stays fully browsable and playable, but its subscribe action is disabled with a tooltip.
*   **Plex / Jellyfin / Lidarr** — power the "in your library" ring that highlights nodes you already own.
*   **YouTube** — a **link-out** only (no in-app embed or API), used as the fallback when a Deezer preview is unavailable. Library ownership is a badge, not an in-app stream.

### Honest limitations

*   **Real leaf nodes.** A true collaboration graph has dead-ends; a settled leaf is a fact about a career, not a bug.
*   **Genre color only on the index (ON) path.** On the live path, nodes render neutral.
*   **Node size reflects credit ubiquity, not fame.** A ubiquitous session player sizes by how much they're credited, not by listener count.
*   **YouTube is a link-out,** not in-app playback.
*   **Artist seeds only** for now — seeding from a specific album is not yet supported.
*   **No sonic/audio analysis** — genre color is tag-derived, never from the audio itself.

### Background orbit warm and budgets

Opening the constellation starts a low-priority background crawl of your **taste orbit**: seed artists come from your Last.fm and ListenBrainz top artists (7-day, 30-day, all-time) and your Lidarr library, nearest tier first, and their collaborators are materialized into the cache so later exploration is fast. The crawl is bounded two ways and both are settings:

| Setting | Default | Bounds |
|---|---|---|
| `orbitEdgeBudget` | 250000 | Edges materialized per crawl |
| `dailyApiBudget` | 5000 | Live Discogs requests per UTC day, shared by the crawl and interactive expansion |

A settled orbit is left alone; it is re-walked once a week (daily 04:00 UTC check), or sooner if the previous crawl ran out of API budget. When the daily API budget is spent, background crawling pauses until the next day and interactive expansion returns only what is already cached.

### Settings

Admins configure all seven constellation preferences under **Settings → Constellation**, with a separate Save button and today's charged API reservations (`used / limit`, resetting at `00:00 UTC`). Admitted requests remain charged if they fail; denied reservations are not charged; lowering the limit does not reduce the recorded count. Each expansion returns up to 49 neighbors within a 50-person subgraph; the interactive view retains up to **300 visible people** as you explore. Shortest paths use the configured degree bound capped at 10; interesting paths may use up to two extra hops.

Automatic index refresh is unavailable; saving this preference does not start or stop an import.

For automation, the same admin-only API remains available:

```
GET /api/settings/constellation
PUT /api/settings/constellation   # partial settings update
GET /api/settings/constellation/usage
```

Keys: `constellationIndexEnabled`, `constellationIndexPath`, `orbitEdgeBudget`, `dailyApiBudget`, `fanoutN`, `pathMaxDegrees`, `indexRefresh` (`monthly` or `off`).

---

## AI Configuration

### Using Ollama or Custom Providers

Mixarr supports any OpenAI-compatible API endpoint, plus native Anthropic and Google Gemini:

| Provider | Base URL | Model Example |
|----------|----------|---------------|
| OpenAI (default) | _(leave empty)_ | `gpt-4o-mini` |
| Anthropic | _(leave empty, select Anthropic provider)_ | `claude-sonnet-4-20250514` |
| Google Gemini | _(leave empty, select Gemini provider)_ | `gemini-2.0-flash` |
| Ollama | `http://localhost:11434/v1` | `llama3.2` |
| LiteLLM | `http://localhost:4000/v1` | `gpt-4` |
| OpenRouter | `https://openrouter.ai/api/v1` | `meta-llama/llama-3-8b` |

**Note**: For local Ollama, no API key is required.

Configure these in **Settings → AI**.

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SESSION_SECRET` | **Required.** Persistent random secret for signing sessions. Keep unchanged when upgrading. | - |
| `BASE_URL` | **Required.** The full URL to access Mixarr. Used for OAuth redirects. | - |
| `FRONTEND_URL` | Optional. If behind a reverse proxy, set this to the public URL. | - |
| `TZ` | Timezone for scheduled tasks. | `UTC` |
| `IPV6_PROBE_HOST` | Host probed at startup over IPv6 to detect broken v6 egress. If the probe fails, Mixarr prefers IPv4 for outbound fetches. | `musicbrainz.org` |
| `MIXARR_SKIP_NETWORK_PREFLIGHT` | Set to `1` to skip the IPv6 egress probe entirely (e.g. on air-gapped hosts or when you want to force Node's default Happy Eyeballs behaviour). | - |

### Ports

| Host port | Container port | Protocol | Usage |
|-----------|----------------|----------|-------|
| `3443` | `443` | HTTPS | **Primary Access**. Secured via internal Caddy. |
| `3010` | `3000` | HTTP | Direct Node.js access (useful for reverse proxies like Traefik/Nginx). |

### Volumes

| Path | Description |
|------|-------------|
| `/data` | Stores MariaDB database, Redis persistence, Caddy certs, and logs. |

---

## Development

To build from source:

```bash
git clone --branch dev https://github.com/aquantumofdonuts/mixarr.git
cd mixarr
cp .env.example .env
npm ci
docker compose -f docker-compose.dev.yml up -d
npm run dev
```

The stack includes Next.js (Frontend), Express (API), Redis (Queue), and MySQL (Dev DB).

---

## Upgrading

**v3.0.0 images are published and ready to use.** Back up your database and persistent data before upgrading. For a unified deployment this includes `/data`; for slim deployments also back up the external database and Redis persistence. Keep the same volume mounts, connection configuration, and `SESSION_SECRET`. Generate no new session secret during an upgrade.

For an existing Compose installation whose application service is named `mixarr`:

1. Change only its image to `ghcr.io/aquantumofdonuts/mixarr:v3.0.0` (unified) or `ghcr.io/aquantumofdonuts/mixarr:v3.0.0-slim` (slim). Keep your existing Compose file, `.env`, volumes, and database/Redis services.
2. Pull and recreate the application container:

   ```bash
   docker compose pull mixarr
   docker compose up -d --no-deps mixarr
   docker compose logs --tail=100 mixarr
   ```

3. Wait for startup to finish, refresh the browser, and check your connections and subscriptions. Read the [v3.0.0 release notes](https://github.com/aquantumofdonuts/mixarr/releases/tag/v3.0.0), including the custom API changes below.

Docker Run and Unraid users should recreate/update the existing application container with the versioned image and the same saved environment and data mappings. Do not delete volumes or run `docker compose down -v` as part of an upgrade.

Existing v2.0, v2.1–v2.2, v2.3, and already-current schemas are verified and baselined automatically; no intermediate version is required. Checked enum expansions and new constellation tables preserve existing records, OAuth/connection configuration, accounts, history, and unmanaged tables. A fresh installation uses the same checked migration chain.

Unified and slim images apply migrations before starting the application; source Compose uses the same deployment script. For a source deployment, run `npm ci`, `npm run db:generate`, then `npm run db:deploy --workspace=@mixarr/api` before starting the API. Use `prisma migrate deploy` through this script for production; `db:push` is a development command and does not accept data loss automatically. The archived `apps/api/prisma/legacy-migrations/` files are historical partial changes and are not an executable baseline.

Startup stops on an unresolved migration failure, unsupported schema drift, or schedule-initialization failure. Inspect the error and your backup before repairing a modified database; do not run `migrate reset`, destructive `db push`, or manually mark an unverified baseline as applied. Incompatible or partially-created constellation schemas require operator inspection. After a failed applied migration, inspect `prisma migrate status` and repair/resolve that specific failure before retrying. Concurrent first-time baseline adoption can cause one instance to fail safely; deploy migrations once, then start replicas.

Queue workers start and the API accepts requests only after database/Redis readiness and restoration of persisted schedules. Allow for a brief application restart; this is not a zero-downtime migration procedure.

### Custom API clients

- Review decisions accept `approved` or `rejected`; restore an eligible rejection with its Undo token instead of setting `pending` directly.
- Bulk review requests accept at most 100 IDs. Read per-record `outcomes` and separate counts; HTTP 200 does not confirm that every item was added. The old `failedItems` shape is removed.
- Label pagination advances by release offset using `releasesProcessed`, `totalReleases`, and `nextReleaseOffset`.

See the [full breaking-change notes](CHANGELOG.md#breaking-changes-and-upgrade-notes).

### Rollback

Restore the pre-upgrade database and persistent-data backup together with the previous image and saved configuration. An in-place downgrade to v2.3.5 is unsafe: its old schema-sync path can remove the new tables.

## Known limitations

Live provider verification is separate from release and UI testing. TIDAL endpoint compatibility ([#81](https://github.com/aquantumofdonuts/mixarr/issues/81)), Jellyfin authentication compatibility ([#87](https://github.com/aquantumofdonuts/mixarr/issues/87)), and other integration/security findings remain tracked in [known issues](docs/ISSUES.md). v3.0.0 does not claim to resolve them. Some Deezer subscription types require OAuth access that is currently unavailable. Constellation's local Discogs index is optional; automatic index refresh is unavailable.

## License

GPLv3. See [LICENSE](LICENSE) for details.
