# Mixarr - Music Discovery for Lidarr

[![Website](https://img.shields.io/badge/Website-mixarr-00d4aa?style=for-the-badge)](https://aquantumofdonuts.github.io/mixarr/)
[![GitHub](https://img.shields.io/github/stars/aquantumofdonuts/mixarr?style=for-the-badge)](https://github.com/aquantumofdonuts/mixarr)
[![License](https://img.shields.io/badge/License-GPLv3-blue?style=for-the-badge)](LICENSE)

**The missing piece for Lidarr.** Connect your music services, get AI-powered recommendations, and grow your collection on autopilot.

🌐 **[Visit the Website](https://aquantumofdonuts.github.io/mixarr/)** | 📖 **[Documentation](https://github.com/aquantumofdonuts/mixarr/wiki)**

![Mixarr AI Discovery](website/img/mixarr-discover.png)

## Features

- **Multi-Service Integration**: Spotify, TIDAL, Deezer, Last.fm, MusicBrainz, Plex/Tautulli, Jellyfin, ListenBrainz
- **Automated Subscriptions**: Scheduled discovery from connected services (37+ sources)
- **System Dashboard**: Overview of subscriptions, recent artists, and system health
- **Modern Stack**: Next.js 14 + Express.js + TypeScript
- **PWA Support**: Installable, offline-capable, push notifications
- **Multi-User**: Authentication with admin/user roles
- **AI Recommendations**: LLM-powered discovery using OpenAI, Anthropic, or Ollama
- **Library Health**: Analyze and maintain your Lidarr library
- **Review Queue**: Manual approval for discovered artists
- **SSO Authentication**: Google OAuth, LDAP/AD, SAML 2.0, Plex SSO

### Running Without Lidarr

Mixarr can operate as a recommendation engine without Lidarr:
- Subscriptions work in `preview` and `queue` modes (auto degrades to queue)
- Search returns results without library status
- Discover requires Lidarr
- Imports work in preview/queue modes

Skip Lidarr connection during setup to use this mode.

## Installation

### From Docker Image

```bash
docker pull ghcr.io/aquantumofdonuts/mixarr:v1.1.1

docker run -d \
  --name mixarr \
  -p 3443:443 \
  -v ~/mixarr-data:/data \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e FRONTEND_URL="https://YOUR-SERVER-IP:3443" \
  -e BASE_URL="https://YOUR-SERVER-IP:3443" \
  ghcr.io/aquantumofdonuts/mixarr:v1.1.1
```

### Build from Source

```bash
git clone https://github.com/aquantumofdonuts/mixarr.git
cd mixarr
git checkout v1.1.1
cp .env.example .env
# Edit .env with your settings (SESSION_SECRET, etc.)

docker compose up -d --build
docker compose logs -f
```

Access:
- **HTTPS**: https://your-ip:3443 (recommended, via Caddy)
- **HTTP**: http://your-ip:3010 (direct API)

Create an admin account on first login, then connect Lidarr and services.

**Updating**: `git fetch --tags && git checkout v1.1.1` then `docker compose up -d --build`

## Supported Music Services

### Spotify
Full OAuth integration.
- Followed artists, saved albums, liked songs
- Any playlist by URL/ID
- New releases, featured playlists, categories
- Personalized playlists (Discover Weekly, Release Radar, Daily Mix, On Repeat)

*Note*: Personalized playlists must be followed/saved in Spotify first.

### TIDAL
Full OAuth integration for HiFi.
- Followed artists, favorite tracks
- Playlists (individual or all)
- Discovery mixes, personalized mixes
- New arrivals

### Deezer
Public API (OAuth unavailable).
- Top charts, genres, search (no login required)
- Favorites, history, Flow require OAuth (unavailable)

### Last.fm
Scrobble-based discovery.
- Global/country charts, genre/tag artists
- Geographic top artists
- Personal library (top scrobbled artists)
- Similar artists

### Plex/Tautulli
Similar artists based on Plex listening history via Tautulli.

### Jellyfin
Similar artists based on Jellyfin listening history (direct API).

### MusicBrainz
New release discovery and artist metadata.

### ListenBrainz
Top artists, recommendations, similar users' favorites.

### AI Recommendations
LLM-powered suggestions based on your library.

## Subscription Sources

- **Last.fm**: Top charts, country charts, genre artists, geographic, library top
- **Spotify**: Followed artists, saved albums, liked songs, playlists, new releases, featured, categories, related, radio, personalized mixes
- **Deezer**: Favorites/history (OAuth), charts/genres/search (public)
- **TIDAL**: Followed, favorites, playlists, discovery mixes, personal mixes, new arrivals
- **MusicBrainz**: New releases
- **ListenBrainz**: Top artists, recommendations, similar users
- **AI**: LLM recommendations
- **Plex/Tautulli**: Listening history similar
- **Jellyfin**: Listening history similar

## Project Structure

```
├── apps/
│   ├── web/           # Next.js 14 frontend
│   │   ├── src/app/   # App Router pages
│   │   ├── src/components/  # UI components
│   │   └── src/lib/   # Utilities, API client, hooks
│   └── api/           # Express.js backend
│       ├── src/routes/    # API endpoints
│       ├── src/services/  # Business logic
│       ├── src/jobs/      # Background workers
│       └── prisma/        # Database schema
├── packages/
│   ├── shared-types/  # TypeScript interfaces
│   └── config/        # Shared ESLint/TypeScript configs
├── docker-compose.yml # Production stack
├── docker-compose.dev.yml # Development stack
└── turbo.json         # Monorepo orchestration
```

## Development Setup

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- npm 10+

### Local Development

```bash
git clone https://github.com/aquantumofdonuts/mixarr.git
cd mixarr
npm install
docker compose -f docker-compose.dev.yml up -d db redis
npm run db:generate
npm run db:push
npm run dev
```

Access:
- Frontend: http://localhost:3000
- API: http://localhost:3010
- Health: http://localhost:3010/api/health

### Docker Development

```bash
./start-dev.sh
```

Access:
- **HTTPS**: https://localhost:3443 (via Caddy)
- **HTTP**: http://your-ip:3010 (no SSL)

## Onboarding

1. **Create Admin Account**: Prompted on first launch.

2. **Configure Base URL**: Settings → Global Settings → Set to `https://your-ip:3443` (required for OAuth).

3. **Connect Lidarr**: Connections → Add Lidarr → URL and API key. Test connection.

   *Recommended*: In Lidarr Settings → Media Management, set "Rescan Artist Folder after Refresh" to Never.

4. **Add Last.fm** (recommended): Get free API key at last.fm/api, enter key/secret/username.

5. **Configure AI** (optional): Add OpenAI/Anthropic API key or Ollama URL.

6. **Add Music Services** (optional):
   - Spotify/TIDAL: Create app, set redirect URI to `https://your-ip:3443/api/connections/{id}/spotify/callback` (or tidal)
   - Plex/Tautulli: Add URL and API key
   - Jellyfin: Add URL and API key
   - ListenBrainz: Add user token

7. **Create Subscription**: Subscriptions → Add → Choose source (e.g., Last.fm Top Charts, Spotify Playlist, AI).

Artists go to Review Queue for approval before adding to Lidarr.

### Quick Verification
- Dashboard shows Lidarr stats
- Search works across services
- Subscription runs successfully

## Production Deployment

### Prerequisites
1. Generate session secret: `openssl rand -base64 32`
2. Create `.env`:
   ```
   SESSION_SECRET=<secret>
   MYSQL_ROOT_PASSWORD=<strong-password>
   MYSQL_PASSWORD=<strong-password>
   ```

### Start Production

```bash
docker compose up -d --build
```

### Development Mode

```bash
docker compose -f docker-compose.dev.yml up -d --build
```

### HTTPS Certificates

Includes Caddy with self-signed certs (browser warning expected).

For custom certs:
1. Place certs in `certs/` directory
2. Update Caddyfile: `tls /path/to/cert.pem /path/to/key.pem`
3. `docker compose restart caddy`

### Ports

| Port | Protocol | Description |
|------|----------|-------------|
| 3443 | HTTPS | Main access (Caddy proxy) |
| 3080 | HTTP | Redirects to HTTPS |
| 3010 | HTTP | Direct web access |

## OAuth Setup

### Spotify
1. Start stack, set Base URL
2. Create app at developer.spotify.com/dashboard
3. Set redirect URI: `https://your-ip:3443/api/connections/{id}/spotify/callback`
4. Add connection in app with Client ID/Secret, authorize

### TIDAL
1. Create app at developer.tidal.com
2. Set redirect URI: `https://your-ip:3443/api/connections/{id}/tidal/callback`
3. Add connection with Client ID/Secret, authorize

## Application Features

### Review Queue
Preview, approve, or dismiss discovered artists before adding to Lidarr.

### Subscriptions
37+ automated sources across services, scheduled runs.

### Discover Page
Browse new music: Spotify releases/playlists, TIDAL mixes, Deezer charts, Last.fm.

### Search
Universal artist search across Lidarr and all connected services.

### Label Browsing
Click labels to browse artists.

### User Management
Multi-user with admin/user roles.

### SSO
- **Google**: Create OAuth client, set redirect `https://domain:3443/api/auth/sso/google/callback`
- **SAML**: ACS URL `https://domain:3443/api/auth/sso/saml/callback`, Entity ID `https://domain:3443`
- **LDAP/Plex**: Configure in settings

### Notifications
Discord/generic webhooks for events.

### Library Health
Dashboard, issue detection, duplicates, metadata enrichment, bulk refresh.

### Dashboard
Subscription status, activity feed, connection health, queue stats.

### Public Playlist Import
Import Spotify public playlists without OAuth.

### Connections
Configure APIs for Lidarr (required), Spotify, TIDAL, Last.fm, Plex/Tautulli, AI.

### Jobs
Monitor background jobs, progress via WebSocket, retry failures.

## PWA Installation

Open in Chrome/Edge/Safari, click Install.

## Architecture

### Frontend (apps/web)
- Next.js 14 App Router
- Tailwind CSS + dark mode
- Custom components
- React hooks + Context
- WebSocket for real-time

### Backend (apps/api)
- Express.js + TypeScript
- Prisma + MySQL
- Passport.js auth (local, Google, LDAP, SAML, Plex)
- BullMQ + Redis queue
- Socket.IO WebSocket

### Services
- Lidarr: Artist management
- Spotify/TIDAL/Deezer: Libraries, playlists
- Last.fm: Charts, metadata
- MusicBrainz: Metadata
- Plex/Jellyfin: Listening history

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `POST /api/auth/login` | Login |
| `GET /api/connections` | List connections |
| `GET /api/search/artist` | Search artists |
| `GET /api/subscriptions` | List subscriptions |
| `GET /api/imports` | List import sources |
| `GET /api/jobs` | List jobs |
| `GET /api/logs` | View logs |
| `GET /api/settings` | Get settings |

## Contributing

1. Branch from `dev`
2. Make changes with TypeScript
3. Run `npm run lint && npm run typecheck`
4. Submit PR

## License

GPLv3 - see LICENSE file