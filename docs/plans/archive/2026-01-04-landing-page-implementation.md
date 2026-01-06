# Mixarr Landing Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a single-page static landing site for Mixarr following the *arr family aesthetic.

**Architecture:** Pure HTML/CSS/JS with no build step. Single `index.html` file with embedded sections, external CSS for styling, minimal JS for carousel, tabs, lightbox, and copy buttons.

**Tech Stack:** HTML5, CSS3 (Flexbox/Grid), Vanilla JavaScript

**Design Reference:** [docs/plans/2026-01-04-landing-page-design.md](2026-01-04-landing-page-design.md)

---

## Task 1: Create folder structure and base HTML

**Files:**
- Create: `website/index.html`
- Create: `website/css/style.css`
- Create: `website/js/main.js`

**Step 1: Create directories**

```bash
mkdir -p website/css website/js website/img/services website/img/features website/img/gallery website/img/slider
```

**Step 2: Create base HTML with all section scaffolding**

Create `website/index.html` with:
- DOCTYPE and meta tags (viewport, charset, description)
- Link to style.css
- Empty sections: nav, hero, services, why, features, gallery, install, support, footer
- Script tag for main.js

**Step 3: Create empty CSS file**

Create `website/css/style.css` with CSS reset and CSS variables for colors.

**Step 4: Create empty JS file**

Create `website/js/main.js` with DOMContentLoaded wrapper.

**Step 5: Test in browser**

Open `website/index.html` in browser, verify page loads with section placeholders.

---

## Task 2: CSS variables and global styles

**Files:**
- Modify: `website/css/style.css`

**Step 1: Define color variables**

```css
:root {
  --bg-primary: #1a1a2e;
  --bg-secondary: #252540;
  --bg-card: #2d2d4a;
  --accent: #00d4aa;
  --accent-hover: #00f5c4;
  --text-primary: #ffffff;
  --text-secondary: #a0a0b0;
  --text-muted: #6b6b80;
  --border: #3d3d5c;
}
```

**Step 2: Add global styles**

- Box-sizing border-box
- Body: font-family, background, color
- Container class: max-width 1200px, centered
- Section padding
- Heading styles
- Link styles

**Step 3: Verify in browser**

Refresh page, verify background color and fonts apply.

---

## Task 3: Navigation bar

**Files:**
- Modify: `website/index.html` (nav section)
- Modify: `website/css/style.css`

**Step 1: Add nav HTML**

```html
<nav class="navbar">
  <div class="container nav-container">
    <a href="#home" class="logo">MIXARR</a>
    <ul class="nav-links">
      <li><a href="#home">Home</a></li>
      <li><a href="#features">Features</a></li>
      <li><a href="#install">Install</a></li>
      <li><a href="#support">Support</a></li>
    </ul>
    <a href="https://github.com/aquantumofdonuts/mixarr" class="nav-github" target="_blank">
      <svg><!-- GitHub icon --></svg>
    </a>
  </div>
</nav>
```

**Step 2: Add nav CSS**

- Sticky positioning
- Flexbox layout
- Logo styling
- Nav link hover effects
- Mobile hamburger menu (hidden by default)

**Step 3: Verify in browser**

Check nav is sticky, links work, hover effects visible.

---

## Task 4: Hero section (static first, carousel later)

**Files:**
- Modify: `website/index.html` (hero section)
- Modify: `website/css/style.css`

**Step 1: Add hero HTML**

```html
<section id="home" class="hero">
  <div class="container">
    <div class="hero-slider">
      <div class="slider-placeholder">
        <!-- Placeholder for carousel -->
        <div class="screenshot-placeholder">Screenshot goes here</div>
      </div>
      <div class="slider-dots">
        <span class="dot active"></span>
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      </div>
    </div>
    <h1>The missing piece for Lidarr</h1>
    <p class="hero-subtitle">Connect your music services, get AI-powered recommendations, and grow your collection on autopilot.</p>
    <div class="hero-cta">
      <a href="#features" class="btn btn-primary">See How It Works</a>
      <a href="https://github.com/aquantumofdonuts/mixarr" class="btn btn-secondary" target="_blank">View on GitHub</a>
    </div>
  </div>
</section>
```

**Step 2: Add hero CSS**

- Centered text layout
- Screenshot placeholder styling
- Slider dots styling
- Button styles (primary/secondary)
- Responsive adjustments

**Step 3: Verify in browser**

Check hero displays correctly, buttons styled, responsive.

---

## Task 5: Service logos strip

**Files:**
- Modify: `website/index.html` (services section)
- Modify: `website/css/style.css`
- Create: `website/img/services/.gitkeep` (placeholder for logos)

**Step 1: Add services HTML**

```html
<section class="services">
  <div class="container">
    <p class="services-title">Works with your favorite services</p>
    <div class="services-logos">
      <img src="img/services/spotify.svg" alt="Spotify" class="service-logo">
      <img src="img/services/tidal.svg" alt="TIDAL" class="service-logo">
      <img src="img/services/deezer.svg" alt="Deezer" class="service-logo">
      <img src="img/services/lastfm.svg" alt="Last.fm" class="service-logo">
      <img src="img/services/plex.svg" alt="Plex" class="service-logo">
      <img src="img/services/musicbrainz.svg" alt="MusicBrainz" class="service-logo">
      <img src="img/services/listenbrainz.svg" alt="ListenBrainz" class="service-logo">
      <img src="img/services/lidarr.svg" alt="Lidarr" class="service-logo">
    </div>
    <p class="services-ai">Plus AI recommendations via OpenAI, Anthropic, or Ollama</p>
  </div>
</section>
```

**Step 2: Add services CSS**

- Flexbox row with wrap
- Logo sizing (40-50px height)
- Grayscale filter, color on hover
- Centered text

**Step 3: Create placeholder .gitkeep**

```bash
touch website/img/services/.gitkeep
```

**Step 4: Verify in browser**

Check layout (broken images expected until logos added).

---

## Task 6: "Why Mixarr?" section

**Files:**
- Modify: `website/index.html` (why section)
- Modify: `website/css/style.css`

**Step 1: Add why HTML**

```html
<section class="why">
  <div class="container">
    <h2>Why Mixarr?</h2>
    <p>Lidarr is great at downloading music, but finding new artists is manual work. You're constantly switching between Spotify, Last.fm, and charts to find what's new.</p>
    <p>Mixarr connects all your music services in one place. Set up subscriptions to automatically discover artists from your playlists, recommendations, and charts—then review and add them to Lidarr with one click.</p>
  </div>
</section>
```

**Step 2: Add why CSS**

- Max-width for readability (~800px)
- Centered text
- Paragraph spacing

**Step 3: Verify in browser**

Check text readable and properly spaced.

---

## Task 7: Features section (4 cards)

**Files:**
- Modify: `website/index.html` (features section)
- Modify: `website/css/style.css`

**Step 1: Add features HTML**

```html
<section id="features" class="features">
  <div class="container">
    <h2>Features</h2>
    <div class="features-grid">
      <div class="feature-card">
        <div class="feature-img-placeholder">Screenshot</div>
        <h3>🎵 Multi-Service Integration</h3>
        <p>Connect Spotify, TIDAL, Deezer, Last.fm, Plex, MusicBrainz, and ListenBrainz. Pull from playlists, charts, and recommendations.</p>
      </div>
      <div class="feature-card">
        <div class="feature-img-placeholder">Screenshot</div>
        <h3>🤖 AI-Powered Discovery</h3>
        <p>Ask for artists in natural language. "Find artists like Radiohead but more electronic." Works with OpenAI, Anthropic, or local Ollama.</p>
      </div>
      <div class="feature-card">
        <div class="feature-img-placeholder">Screenshot</div>
        <h3>🔄 Subscription Automation</h3>
        <p>39 subscription types run on schedule. Discover Weekly, Release Radar, global charts—all feeding your review queue.</p>
      </div>
      <div class="feature-card">
        <div class="feature-img-placeholder">Screenshot</div>
        <h3>🛡️ Library Health</h3>
        <p>Find artists missing metadata, posters, or bios. Bulk enrich from Last.fm, Deezer, and Discogs. Detect duplicates.</p>
      </div>
    </div>
  </div>
</section>
```

**Step 2: Add features CSS**

- CSS Grid: 2 columns (1 on mobile)
- Card styling: background, padding, border-radius
- Image placeholder styling
- Hover effect: subtle lift/glow

**Step 3: Verify in browser**

Check grid layout, cards styled, responsive.

---

## Task 8: Screenshots gallery

**Files:**
- Modify: `website/index.html` (gallery section)
- Modify: `website/css/style.css`

**Step 1: Add gallery HTML**

```html
<section class="gallery">
  <div class="container">
    <h2>See It In Action</h2>
    <div class="gallery-grid">
      <div class="gallery-item" data-caption="Review Queue">
        <img src="img/gallery/review-queue.png" alt="Review Queue">
      </div>
      <div class="gallery-item" data-caption="Artist Details">
        <img src="img/gallery/artist-details.png" alt="Artist Details">
      </div>
      <div class="gallery-item" data-caption="Universal Search">
        <img src="img/gallery/search.png" alt="Universal Search">
      </div>
      <div class="gallery-item" data-caption="Dashboard">
        <img src="img/gallery/dashboard.png" alt="Dashboard">
      </div>
    </div>
    <p class="gallery-hint">Click any image to enlarge</p>
  </div>
</section>
```

**Step 2: Add gallery CSS**

- CSS Grid: 4 columns (2 on tablet, 1 on mobile)
- Thumbnail styling with border/shadow
- Hover effect: scale up, caption appears
- Placeholder styling for missing images

**Step 3: Create placeholder .gitkeep**

```bash
touch website/img/gallery/.gitkeep website/img/features/.gitkeep website/img/slider/.gitkeep
```

**Step 4: Verify in browser**

Check grid layout, hover effects work.

---

## Task 9: Install section with tabs

**Files:**
- Modify: `website/index.html` (install section)
- Modify: `website/css/style.css`

**Step 1: Add install HTML**

```html
<section id="install" class="install">
  <div class="container">
    <h2>Install</h2>
    <div class="install-tabs">
      <button class="tab-btn active" data-tab="compose">Docker Compose</button>
      <button class="tab-btn" data-tab="run">Docker Run</button>
      <button class="tab-btn" data-tab="unraid">Unraid</button>
    </div>
    <div class="tab-content active" id="tab-compose">
      <pre><code>git clone https://github.com/aquantumofdonuts/mixarr.git
cd mixarr
cp .env.example .env
docker compose up -d --build

# Access at https://your-ip:3443</code></pre>
      <button class="copy-btn" data-target="tab-compose">Copy to Clipboard</button>
    </div>
    <div class="tab-content" id="tab-run">
      <pre><code>docker run -d \
  --name mixarr \
  -p 3443:443 \
  -v ~/mixarr-data:/data \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e FRONTEND_URL="https://YOUR-IP:3443" \
  -e BASE_URL="https://YOUR-IP:3443" \
  ghcr.io/aquantumofdonuts/mixarr:latest</code></pre>
      <button class="copy-btn" data-target="tab-run">Copy to Clipboard</button>
    </div>
    <div class="tab-content" id="tab-unraid">
      <p>Available in Community Applications</p>
      <p>Search for "Mixarr" in the Apps tab</p>
    </div>
    <p class="install-requirements">Requirements: Docker, Docker Compose, Lidarr instance</p>
    <a href="https://github.com/aquantumofdonuts/mixarr#readme" class="btn btn-secondary" target="_blank">View Full Documentation</a>
  </div>
</section>
```

**Step 2: Add install CSS**

- Tab button styling (active state)
- Code block styling with dark background
- Copy button positioning
- Tab content show/hide

**Step 3: Verify in browser**

Check tabs visible (JS for switching comes later), code blocks styled.

---

## Task 10: Support section

**Files:**
- Modify: `website/index.html` (support section)
- Modify: `website/css/style.css`

**Step 1: Add support HTML**

```html
<section id="support" class="support">
  <div class="container">
    <h2>Support</h2>
    <div class="support-grid">
      <a href="https://github.com/aquantumofdonuts/mixarr/wiki" class="support-card" target="_blank">
        <span class="support-icon">📖</span>
        <h3>Wiki</h3>
        <p>Docs and guides on GitHub</p>
      </a>
      <a href="https://github.com/aquantumofdonuts/mixarr/issues" class="support-card" target="_blank">
        <span class="support-icon">🐛</span>
        <h3>GitHub Issues</h3>
        <p>Report bugs and feature requests</p>
      </a>
    </div>
  </div>
</section>
```

**Step 2: Add support CSS**

- Grid: 2-3 columns centered
- Card styling matching feature cards
- Icon sizing
- Hover effects

**Step 3: Verify in browser**

Check cards display, links work.

---

## Task 11: Footer

**Files:**
- Modify: `website/index.html` (footer)
- Modify: `website/css/style.css`

**Step 1: Add footer HTML**

```html
<footer class="footer">
  <div class="container">
    <p>© 2026 Mixarr. Open source under <a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank">GPLv3 License</a>.</p>
    <div class="footer-links">
      <a href="https://github.com/aquantumofdonuts/mixarr" target="_blank">GitHub</a>
      <span>·</span>
      <a href="https://github.com/aquantumofdonuts/mixarr/releases" target="_blank">Releases</a>
      <span>·</span>
      <a href="https://github.com/aquantumofdonuts/mixarr/issues" target="_blank">Issues</a>
    </div>
  </div>
</footer>
```

**Step 2: Add footer CSS**

- Centered text
- Muted colors
- Link styling
- Padding/margin

**Step 3: Verify in browser**

Check footer displays at bottom.

---

## Task 12: JavaScript - Tab switching

**Files:**
- Modify: `website/js/main.js`

**Step 1: Add tab switching logic**

```javascript
document.addEventListener('DOMContentLoaded', () => {
  // Tab switching
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      
      // Remove active from all
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      // Add active to clicked
      btn.classList.add('active');
      document.getElementById(`tab-${tabId}`).classList.add('active');
    });
  });
});
```

**Step 2: Verify in browser**

Click tabs, verify content switches.

---

## Task 13: JavaScript - Copy to clipboard

**Files:**
- Modify: `website/js/main.js`

**Step 1: Add copy button logic**

```javascript
// Copy to clipboard
const copyBtns = document.querySelectorAll('.copy-btn');

copyBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.target;
    const code = document.querySelector(`#${targetId} code`).textContent;
    
    navigator.clipboard.writeText(code).then(() => {
      const originalText = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    });
  });
});
```

**Step 2: Verify in browser**

Click copy button, paste somewhere to verify.

---

## Task 14: JavaScript - Lightbox for gallery

**Files:**
- Modify: `website/index.html` (add lightbox HTML)
- Modify: `website/css/style.css`
- Modify: `website/js/main.js`

**Step 1: Add lightbox HTML (before closing body)**

```html
<div class="lightbox" id="lightbox">
  <button class="lightbox-close">&times;</button>
  <button class="lightbox-prev">&#10094;</button>
  <button class="lightbox-next">&#10095;</button>
  <img src="" alt="" class="lightbox-img">
  <p class="lightbox-caption"></p>
</div>
```

**Step 2: Add lightbox CSS**

- Fixed overlay covering viewport
- Centered image with max dimensions
- Close/prev/next button positioning
- Hidden by default, shown with .active class

**Step 3: Add lightbox JS**

```javascript
// Lightbox
const lightbox = document.getElementById('lightbox');
const lightboxImg = lightbox.querySelector('.lightbox-img');
const lightboxCaption = lightbox.querySelector('.lightbox-caption');
const galleryItems = document.querySelectorAll('.gallery-item');
let currentIndex = 0;

galleryItems.forEach((item, index) => {
  item.addEventListener('click', () => {
    currentIndex = index;
    openLightbox(item);
  });
});

function openLightbox(item) {
  const img = item.querySelector('img');
  lightboxImg.src = img.src;
  lightboxCaption.textContent = item.dataset.caption || '';
  lightbox.classList.add('active');
}

lightbox.querySelector('.lightbox-close').addEventListener('click', () => {
  lightbox.classList.remove('active');
});

lightbox.querySelector('.lightbox-prev').addEventListener('click', () => {
  currentIndex = (currentIndex - 1 + galleryItems.length) % galleryItems.length;
  openLightbox(galleryItems[currentIndex]);
});

lightbox.querySelector('.lightbox-next').addEventListener('click', () => {
  currentIndex = (currentIndex + 1) % galleryItems.length;
  openLightbox(galleryItems[currentIndex]);
});

// Close on background click
lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) {
    lightbox.classList.remove('active');
  }
});
```

**Step 4: Verify in browser**

Click gallery image, verify lightbox opens, navigation works.

---

## Task 15: JavaScript - Hero carousel

**Files:**
- Modify: `website/js/main.js`
- Modify: `website/css/style.css`

**Step 1: Update hero HTML for carousel (if not done)**

Ensure hero has multiple slides and dots.

**Step 2: Add carousel CSS**

- Slides hidden by default, active slide visible
- Fade transition
- Dot active state

**Step 3: Add carousel JS**

```javascript
// Hero carousel
const slides = document.querySelectorAll('.hero-slide');
const dots = document.querySelectorAll('.slider-dots .dot');
let slideIndex = 0;
let slideInterval;

function showSlide(index) {
  slides.forEach(s => s.classList.remove('active'));
  dots.forEach(d => d.classList.remove('active'));
  
  slideIndex = (index + slides.length) % slides.length;
  slides[slideIndex].classList.add('active');
  dots[slideIndex].classList.add('active');
}

function nextSlide() {
  showSlide(slideIndex + 1);
}

function startCarousel() {
  slideInterval = setInterval(nextSlide, 5000);
}

dots.forEach((dot, index) => {
  dot.addEventListener('click', () => {
    clearInterval(slideInterval);
    showSlide(index);
    startCarousel();
  });
});

if (slides.length > 0) {
  showSlide(0);
  startCarousel();
}
```

**Step 4: Verify in browser**

Check slides auto-rotate, dots clickable.

---

## Task 16: Responsive design

**Files:**
- Modify: `website/css/style.css`

**Step 1: Add mobile breakpoint (max-width: 768px)**

- Stack nav links vertically or hamburger menu
- Hero text smaller
- Features grid 1 column
- Gallery grid 2 columns then 1
- Install tabs stack

**Step 2: Add tablet breakpoint (max-width: 1024px)**

- Features grid stays 2 columns
- Gallery 2 columns
- Adjust padding

**Step 3: Test in browser**

Resize window, verify layout adapts.

---

## Task 17: GitHub Pages setup

**Files:**
- Create: `website/CNAME` (for custom domain)
- Modify: GitHub repo settings

**Step 1: Create CNAME file**

```
mixarr.audio
```

(Only if domain is registered)

**Step 2: Configure GitHub Pages**

In repo Settings > Pages:
- Source: Deploy from branch
- Branch: main (or prod)
- Folder: /website

**Step 3: Verify deployment**

After push, check https://aquantumofdonuts.github.io/mixarr or custom domain.

---

## Task 18: Add placeholder images

**Files:**
- Create: `website/img/` placeholder images

**Step 1: Create simple placeholder SVGs**

Create placeholder images for testing layout before real screenshots.

**Step 2: Update image src attributes if needed**

Point to placeholder paths.

**Step 3: Document screenshot requirements**

List exact screenshots needed for user to capture.

---

## Summary: Assets User Must Provide

Before site is complete, user needs to provide:

1. **Logo** - `img/logo.svg` (optional: `img/logo-white.svg`)
2. **Hero screenshots** (4) - `img/slider/`
   - dashboard.png
   - subscriptions.png
   - ai-search.png
   - review-queue.png
3. **Feature screenshots** (4) - `img/features/`
   - multi-service.png
   - ai-discovery.png
   - subscriptions.png
   - library-health.png
4. **Gallery screenshots** (4-6) - `img/gallery/`
   - review-queue.png
   - artist-details.png
   - search.png
   - dashboard.png
5. **Service logos** (8) - `img/services/`
   - spotify.svg, tidal.svg, deezer.svg, lastfm.svg, plex.svg, musicbrainz.svg, listenbrainz.svg, lidarr.svg
6. **Favicon** - `favicon.ico`
