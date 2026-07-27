<p align="center">
  <img src="apps/web/public/icons/icon-512x512.png" alt="Mixarr" width="128" height="128">
</p>

<h1 align="center">Mixarr</h1>

<p align="center">
  <strong>Music Discovery & Management for Lidarr</strong>
</p>

<p align="center">
  <a href="https://aquantumofdonuts.github.io/mixarr/"><img src="https://img.shields.io/badge/Website-mixarr-00d4aa?style=flat-square" alt="Website"></a>
  <a href="https://github.com/aquantumofdonuts/mixarr"><img src="https://img.shields.io/github/stars/aquantumofdonuts/mixarr?style=flat-square" alt="GitHub"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPLv3-blue?style=flat-square" alt="License"></a>
</p>

Mixarr is a self-hosted music discovery companion for Lidarr. It connects to Spotify, TIDAL, Last.fm, Deezer, ListenBrainz, Plex, Jellyfin, Discogs, Bandcamp, and MusicBrainz to automatically discover new artists and add them to your library. 56 subscription types, a review queue, and optional AI recommendations. Deploy with Docker in minutes.

![Mixarr Dashboard](website/img/mixarr-dashboard.png)

## Quick Start

### Docker Compose (Recommended)

Create a `docker-compose.yml`:

```yaml
version: "3"
services:
  mixarr:
    image: ghcr.io/aquantumofdonuts/mixarr:latest
    container_name: mixarr
    ports:
      - "3443:443"  # HTTPS Access
      - "3010:3010" # Web UI (HTTP)
    volumes:
      - /path/to/data:/data
    environment:
      - SESSION_SECRET=replace_with_long_random_string
      - BASE_URL=https://YOUR_IP:3443
    restart: unless-stopped
```

Run it:
```bash
docker compose up -d
```

### Docker Run

```bash
docker run -d \
  --name mixarr \
  -p 3443:443 \
  -p 3010:3010 \
  -v ~/mixarr-data:/data \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e BASE_URL="https://YOUR-IP:3443" \
  ghcr.io/aquantumofdonuts/mixarr:latest
```

> **Note**: Access the web interface at **`https://YOUR-IP:3443`**.

---

## Deployment Options

Mixarr offers two Docker image variants:

| Image | Size | Contents | Best For |
|-------|------|----------|----------|
| `mixarr:latest` | Full stack (API, Web, MariaDB, Redis, Caddy) | Docker, single-container setups |
| `mixarr:slim` | API + Web only | Production, Kubernetes, existing infrastructure |

### Option 1: Unified Image (Default)

Everything in one container - the examples above use this approach.

### Option 2: Slim Image with Compose

Separate containers for better reliability and scalability:

```bash
curl -sSL https://raw.githubusercontent.com/aquantumofdonuts/mixarr/prod/docker-compose.slim.yml -o docker-compose.yml
docker compose up -d
```

### Option 3: Slim Image with Existing Infrastructure

For users with existing MariaDB/MySQL and Redis:

```bash
docker run -d \
  --name mixarr \
  -p 3000:3000 -p 3005:3005 \
  -e DATABASE_URL=mysql://user:pass@your-db:3306/mixarr \
  -e REDIS_URL=redis://your-redis:6379 \
  -e SESSION_SECRET=your-secret-here \
  ghcr.io/aquantumofdonuts/mixarr:slim
```


---
## Post-Installation Setup

1.  **Create Admin Account**: Follow the prompts on first launch.
2.  **Global Settings**: Go to **Settings > Global** and ensure `Base URL` is set correctly (e.g., `https://192.168.1.10:3443`). This is critical for OAuth callbacks.
3.  **Connect Lidarr**: Go to **Settings > Connections** and add your Lidarr URL and API Key.
4.  **Add Services**: Connect Spotify, Tidal, or Last.fm to start discovering music.

---

## Features

*   **56 Subscription Types** across 12 services — playlists, charts, tags, recommendations, user libraries, followed artists, and more. Set them to run on a schedule and forget about it.
*   **Review Queue** — discovered artists land in a queue for approval before anything gets added to Lidarr.
*   **SkyHook Cache Warming** — pre-warms MusicBrainz metadata so Lidarr adds don't fail with 503 errors.
*   **Multi-Service Support**:
    *   **Spotify** — playlists, new releases, saved albums/tracks, followed artists, top artists, recommendations, search
    *   **TIDAL** — playlists, favorites, followed artists, discovery mixes, new arrivals
    *   **Last.fm** — charts, tags, similar artists, user library, weekly charts, related tags
    *   **ListenBrainz** — top listens, similar users, recommendations, fresh releases, weekly jams, playlists, radio
    *   **Deezer** — playlists, charts, editorial picks, user favorites, flow, recommendations
    *   **Discogs** — collection, wantlist
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

Collaboration data can come from live APIs or a local index. This is a global toggle in **Settings → Constellation**, and it's the one real decision to make:

| | **Live API (default, OFF)** | **Local index (ON)** |
|---|---|---|
| Setup | None | Downloads + parses the Discogs data dump |
| Footprint | Light | Large disk + hours of parsing |
| Exploration speed | Slower (rate-limited) | Fast, offline |
| Genre node coloring | Unavailable (neutral nodes) | Available |

*   **Live API (OFF — the default):** queries Discogs/MusicBrainz live. No setup, light footprint. Exploration is slower because it's rate-limited, and **genre-based node coloring is unavailable** on the live path (nodes render neutral). Everything else — collaboration edges, tie-strength weights, bridge scoring, shortest-path, and the "in your library" ring — still works.
*   **Local index (ON):** builds a **credit-only index** from the Discogs CC0 monthly data dump. Fast, offline exploration plus genre coloring. **Honest cost:** the resulting index is small, but *building* it downloads and stream-parses the **full Discogs releases dump (~10GB compressed, ~100GB+ uncompressed)** — hours of parsing, repeated on each refresh. A real disk-and-time commitment, aimed at power users. Refresh cadence is configurable (monthly) or you can build once and never refresh.

### Integrations it uses

*   **Deezer** — 30-second track previews (no auth required).
*   **Lidarr** — send-to-library. An artist must exist in MusicBrainz to be auto-added; if it doesn't, that's an honest "not in MusicBrainz" dead-end — the node stays fully browsable and playable, but its subscribe action is disabled with a tooltip.
*   **Plex / Jellyfin / Lidarr** — power the "in your library" ring that highlights nodes you already own.
*   **YouTube** — a **link-out** only (no in-app embed or API), used as the final fallback in the player after owned playback and Deezer preview.

### Honest limitations

*   **Real leaf nodes.** A true collaboration graph has dead-ends; a settled leaf is a fact about a career, not a bug.
*   **Genre color only on the index (ON) path.** On the live path, nodes render neutral.
*   **Node size reflects credit ubiquity, not fame.** A ubiquitous session player sizes by how much they're credited, not by listener count.
*   **YouTube is a link-out,** not in-app playback.
*   **Artist seeds only** for now — seeding from a specific album is not yet supported.
*   **No sonic/audio analysis** — genre color is tag-derived, never from the audio itself.

The index toggle and the crawl/API budgets live in **Settings → Constellation** (admin).

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
| `SESSION_SECRET` | **Required.** Random string for session encryption. | - |
| `BASE_URL` | **Required.** The full URL to access Mixarr. Used for OAuth redirects. | - |
| `FRONTEND_URL` | Optional. If behind a reverse proxy, set this to the public URL. | - |
| `TZ` | Timezone for scheduled tasks. | `UTC` |
| `IPV6_PROBE_HOST` | Host probed at startup over IPv6 to detect broken v6 egress. If the probe fails, Mixarr prefers IPv4 for outbound fetches. | `musicbrainz.org` |
| `MIXARR_SKIP_NETWORK_PREFLIGHT` | Set to `1` to skip the IPv6 egress probe entirely (e.g. on air-gapped hosts or when you want to force Node's default Happy Eyeballs behaviour). | - |

### Ports

| Port | Protocol | Usage |
|------|----------|-------|
| `3443` | HTTPS | **Primary Access**. Secured via internal Caddy. |
| `3010` | HTTP | Direct Node.js access (useful for reverse proxies like Traefik/Nginx). |

### Volumes

| Path | Description |
|------|-------------|
| `/data` | Stores MariaDB database, Redis persistence, Caddy certs, and logs. |

---

## Development

To build from source:

```bash
git clone https://github.com/aquantumofdonuts/mixarr.git
cd mixarr
cp .env.example .env
npm install
docker compose -f docker-compose.dev.yml up -d
npm run dev
```

The stack includes Next.js (Frontend), Express (API), Redis (Queue), and MySQL (Dev DB).

---

## License

GPLv3. See [LICENSE](LICENSE) for details.