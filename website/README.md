# GitHub Pages website

`index.html` is the static project website. Pages deploys changes under `website/` only after a push to `prod` (or a manual workflow dispatch). Updating `dev` does not publish the site.

The gallery shows the 3.0.0 catalog with fictional demonstration data. Docker Compose builds from `prod`; Docker Run uses the stable `:latest` image. Images are published separately by the version-tag workflow. Release preparation on `dev` does not publish a website or image.

To refresh screenshots, build and start the web app locally, then run from the repository root:

```bash
(cd apps/web && npx eslint src --ext .ts,.tsx --no-cache)
npm run build --workspace=@mixarr/web -- --no-lint
npm run start --workspace=@mixarr/web -- --hostname 127.0.0.1 --port 3027
# In another terminal:
E2E_BASE_URL=http://127.0.0.1:3027 npx playwright test --config website/playwright.config.ts
```

The capture suite reuses the strict catalog browser fixtures, blocks external requests, and checks loaded data, images, and browser errors before writing PNGs. It uses fictional artists, identities, credits, and records; it never signs in to a provider or writes to Lidarr. `screenshots.json` records the source commit, viewport, theme, and captured routes. The dashboard image remains for the repository README.

The commands run ESLint without its cache because the current dependency override causes Next’s cached lint command to fail with `flatCache.load is not a function`.

Copy sources: `packages/shared-types/src/subscription.ts` (56 registered types), the app routes and artist/Constellation components (catalog behavior), and the root README/Compose files (deployment). Provider compatibility is separate from UI presentation; known issues remain in `docs/ISSUES.md`, including TIDAL subscriptions. C137 provider verification remains deferred.

Serve this directory locally to check the static page, for example `python3 -m http.server 3028 --directory website`. Check the gallery/lightbox, carousel, installation tabs, image loading, and mobile navigation before committing.

## Refresh verification — October 10, 2026

| Requested result | Implementation and browser evidence |
| --- | --- |
| Replace the M before captures | Sidebar uses the existing Mixarr icon; light/dark logo loading and collapse/expand passed. |
| Reflect current capabilities | Copy follows the source registry and implemented catalog surfaces; dev preview, stable images, and provider limitations are distinguished. |
| Capture and update images | Playwright regenerated ten PNGs, including the README dashboard image. Nine gallery views load at their original aspect ratio; carousel, lightbox, and install tabs passed. |
| Work only on dev | Logo and website changes stay on dev; prod and the Pages deployment workflow are unchanged. |

Completion audit and changed-file quality review passed. The production web build (with uncached lint run separately), capture-script TypeScript, and 11 existing Chromium navigation checks passed. Desktop and mobile static-page checks found no browser errors or horizontal overflow. No live provider verification or Pages publication is claimed.
