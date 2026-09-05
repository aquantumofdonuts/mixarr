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
      - "3010:3000" # Web UI (HTTP, bypasses Caddy)
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
  -p 3010:3000 \
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