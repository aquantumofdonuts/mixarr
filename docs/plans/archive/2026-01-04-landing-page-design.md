# Mixarr Landing Page Design

**Date:** 2026-01-04  
**Status:** Approved  
**Domain:** mixarr.audio (or similar)

## Overview

A single-page static landing site for Mixarr, following the *arr family aesthetic (lidarr.audio, sonarr.tv, radarr.video) but with slightly more polish. Hosted via GitHub Pages from the `/website` folder in the main repo.

## Design Decisions

| Decision | Choice |
|----------|--------|
| **Style** | Hybrid: *arr layout + polished copy |
| **Primary CTA** | Screenshots/demo first, install after |
| **Features to highlight** | Multi-service, AI discovery, subscriptions, library health |
| **Extras** | Service logos strip, "Why Mixarr?" section, screenshots gallery |
| **Implementation** | Static HTML in `/website` folder, GitHub Pages |
| **License** | GPLv3 |

## Page Structure

### 1. Navigation (sticky, dark)
```
[Logo] MIXARR     HOME   FEATURES   INSTALL   SUPPORT   [GitHub Icon]
```

### 2. Hero Section
- **Screenshot carousel** (4 slides, auto-rotate 5s)
  - Dashboard
  - Subscriptions page  
  - AI Search interface
  - Review Queue
- **Tagline:** "The missing piece for Lidarr"
- **One-liner:** "Connect your music services, get AI-powered recommendations, and grow your collection on autopilot."
- **CTAs:** 
  - Primary: "See How It Works" → scrolls to Features
  - Secondary: "View on GitHub" → external

### 3. Service Logos Strip
```
Works with your favorite services

[Spotify] [TIDAL] [Deezer] [Last.fm] [Plex] [MusicBrainz] [ListenBrainz] [Lidarr]

Plus AI recommendations via OpenAI, Anthropic, or Ollama
```
- Logos: ~40-50px height, grayscale (color on hover)

### 4. "Why Mixarr?" Section
```
Why Mixarr?

Lidarr is great at downloading music, but finding new artists is manual work. 
You're constantly switching between Spotify, Last.fm, and charts to find what's new.

Mixarr connects all your music services in one place. Set up subscriptions to 
automatically discover artists from your playlists, recommendations, and charts—
then review and add them to Lidarr with one click.
```

### 5. Features Section (2x2 grid)

| Feature | Description | Screenshot |
|---------|-------------|------------|
| **🎵 Multi-Service Integration** | Connect Spotify, TIDAL, Deezer, Last.fm, Plex, MusicBrainz, and ListenBrainz. Pull from playlists, charts, and recommendations. | Connections or subscriptions page |
| **🤖 AI-Powered Discovery** | Ask for artists in natural language. "Find artists like Radiohead but more electronic." Works with OpenAI, Anthropic, or local Ollama. | AI search interface |
| **🔄 Subscription Automation** | 39 subscription types run on schedule. Discover Weekly, Release Radar, global charts—all feeding your review queue. | Subscription list or modal |
| **🛡️ Library Health** | Find artists missing metadata, posters, or bios. Bulk enrich from Last.fm, Deezer, and Discogs. Detect duplicates. | Library health dashboard |

- Dark card background (`#252540`)
- Screenshot at top, icon + title + description below
- Subtle hover effect

### 6. Screenshots Gallery
- 4-6 thumbnails in horizontal row/grid
- Click to open lightbox
- Images:
  - Review Queue
  - Artist Details
  - Universal Search
  - Dashboard
  - Subscription Modal
  - Settings/Connections

### 7. Install Section (tabbed)

**Tabs:** Docker Compose | Docker Run | Unraid

**Docker Compose (default):**
```bash
git clone https://github.com/aquantumofdonuts/mixarr.git
cd mixarr
cp .env.example .env
docker compose up -d --build

# Access at https://your-ip:3443
```

**Docker Run:**
```bash
docker run -d \
  --name mixarr \
  -p 3443:443 \
  -v ~/mixarr-data:/data \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e FRONTEND_URL="https://YOUR-IP:3443" \
  -e BASE_URL="https://YOUR-IP:3443" \
  ghcr.io/aquantumofdonuts/mixarr:latest
```

**Unraid:**
```
Available in Community Applications
Search for "Mixarr" in the Apps tab
```

- Syntax highlighting
- Copy to clipboard button
- Requirements note: Docker, Docker Compose, Lidarr instance

### 8. Support Section
Three cards:
- **📖 Wiki** — Docs and guides on GitHub
- **💬 Discord** — (optional) Join the community chat
- **🐛 GitHub Issues** — Report bugs and requests

### 9. Footer
```
© 2026 Mixarr. Open source under GPLv3 License.

GitHub  ·  Releases  ·  Issues
```

## Color Scheme

| Element | Color |
|---------|-------|
| Background | `#1a1a2e` (dark navy) |
| Card background | `#252540` |
| Accent | TBD - teal (`#00d4aa`) or amber (`#f59e0b`) to differentiate from other *arrs |
| Text | White / light gray |
| Code blocks | Darker with syntax highlighting |

## File Structure

```
/website/
├── index.html
├── css/
│   └── style.css
├── js/
│   └── main.js          # Carousel, tabs, lightbox, copy buttons
├── img/
│   ├── logo.svg
│   ├── logo-white.svg
│   ├── services/        # Service logos (grayscale)
│   │   ├── spotify.svg
│   │   ├── tidal.svg
│   │   ├── deezer.svg
│   │   ├── lastfm.svg
│   │   ├── plex.svg
│   │   ├── musicbrainz.svg
│   │   ├── listenbrainz.svg
│   │   └── lidarr.svg
│   ├── features/        # 4 feature screenshots
│   ├── gallery/         # 6 gallery screenshots
│   └── slider/          # 4 hero carousel images
└── CNAME                # Custom domain
```

## Assets Checklist

- [ ] Logo (SVG, white variant for dark nav)
- [ ] 4 hero carousel screenshots
- [ ] 4 feature screenshots
- [ ] 6 gallery screenshots
- [ ] 8 service logos (grayscale SVG)
- [ ] Favicon

## Technical Notes

- **No build step** — Pure HTML/CSS/JS
- **No dependencies** — Custom carousel, tabs, lightbox
- **Responsive** — Mobile-first, breakpoints at 768px and 1024px
- **GitHub Pages** — Deploy from `/website` folder or `gh-pages` branch
- **Custom domain** — CNAME file for mixarr.audio

## Next Steps

1. Register domain (mixarr.audio or alternative)
2. Capture screenshots from running Mixarr instance
3. Create/obtain logo
4. Build HTML/CSS/JS
5. Configure GitHub Pages
6. Point domain to GitHub Pages
